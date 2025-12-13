/**
 * Notification Manager - Handles audio playback on local machine
 * This runs on the UI side (local) even when connected to Remote SSH
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class NotificationManager {
    private context: vscode.ExtensionContext;
    private isPlaying: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Play notification sound
     * Works on Windows, macOS, and Linux
     */
    async playSound(type: string = 'default'): Promise<boolean> {
        if (this.isPlaying) {
            return false;
        }

        this.isPlaying = true;

        try {
            const platform = process.platform;

            if (platform === 'win32') {
                return await this.playWindowsSound(type);
            } else if (platform === 'darwin') {
                return await this.playMacSound(type);
            } else {
                return await this.playLinuxSound(type);
            }
        } catch (error) {
            console.error('Failed to play sound:', error);
            // Fallback to beep
            return await this.playBeep();
        } finally {
            this.isPlaying = false;
        }
    }

    /**
     * Windows: Use PowerShell with SystemSounds
     */
    private async playWindowsSound(type: string): Promise<boolean> {
        try {
            // Map type to Windows system sound
            const soundMap: Record<string, string> = {
                'default': 'Asterisk',
                'success': 'Asterisk',
                'error': 'Hand',
                'warning': 'Exclamation'
            };

            const soundName = soundMap[type] || 'Asterisk';

            // Use .NET SystemSounds for reliable playback
            const cmd = `powershell -Command "[System.Media.SystemSounds]::${soundName}.Play()"`;

            await execAsync(cmd);
            return true;
        } catch (error) {
            console.error('Windows sound failed:', error);
            // Fallback to console beep
            try {
                await execAsync('powershell -Command "[console]::beep(800, 200)"');
                return true;
            } catch {
                return false;
            }
        }
    }

    /**
     * macOS: Use afplay with system sounds
     */
    private async playMacSound(type: string): Promise<boolean> {
        try {
            // macOS system sounds
            const soundMap: Record<string, string> = {
                'default': '/System/Library/Sounds/Glass.aiff',
                'success': '/System/Library/Sounds/Glass.aiff',
                'error': '/System/Library/Sounds/Basso.aiff',
                'warning': '/System/Library/Sounds/Sosumi.aiff'
            };

            const soundFile = soundMap[type] || soundMap['default'];
            await execAsync(`afplay "${soundFile}"`);
            return true;
        } catch {
            // Fallback to osascript beep
            try {
                await execAsync('osascript -e "beep"');
                return true;
            } catch {
                return false;
            }
        }
    }

    /**
     * Linux: Use paplay or aplay with freedesktop sounds
     */
    private async playLinuxSound(type: string): Promise<boolean> {
        try {
            // Try freedesktop sound theme
            const soundMap: Record<string, string> = {
                'default': 'message',
                'success': 'complete',
                'error': 'dialog-error',
                'warning': 'dialog-warning'
            };

            const soundName = soundMap[type] || 'message';

            // Try canberra-gtk-play first (most compatible)
            try {
                await execAsync(`canberra-gtk-play -i ${soundName}`);
                return true;
            } catch {
                // Fallback to paplay with common paths
                const paths = [
                    `/usr/share/sounds/freedesktop/stereo/${soundName}.oga`,
                    `/usr/share/sounds/gnome/default/alerts/drip.ogg`,
                    `/usr/share/sounds/ubuntu/stereo/message.ogg`
                ];

                for (const soundPath of paths) {
                    try {
                        await execAsync(`paplay "${soundPath}" || aplay "${soundPath}"`);
                        return true;
                    } catch {
                        continue;
                    }
                }
            }

            // Final fallback: terminal bell
            await execAsync('echo -e "\\a"');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Play system beep (fallback)
     */
    async playBeep(): Promise<boolean> {
        try {
            const platform = process.platform;

            if (platform === 'win32') {
                await execAsync('powershell -Command "[console]::beep(800, 200)"');
            } else if (platform === 'darwin') {
                await execAsync('osascript -e "beep"');
            } else {
                await execAsync('echo -e "\\a"');
            }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Play multiple beeps for attention
     */
    async playAttention(): Promise<boolean> {
        try {
            const platform = process.platform;

            if (platform === 'win32') {
                await execAsync('powershell -Command "[console]::beep(800, 150); Start-Sleep -Milliseconds 100; [console]::beep(1000, 150)"');
            } else if (platform === 'darwin') {
                await execAsync('osascript -e "beep 2"');
            } else {
                await execAsync('echo -e "\\a\\a"');
            }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Flash the VS Code window taskbar button (Windows only)
     * Uses Windows FlashWindowEx API via PowerShell
     */
    async flashWindow(count: number = 5): Promise<boolean> {
        try {
            const platform = process.platform;

            if (platform === 'win32') {
                // PowerShell script to flash the window using FlashWindowEx API
                const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WindowFlash {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    [StructLayout(LayoutKind.Sequential)]
    public struct FLASHWINFO {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    public const uint FLASHW_ALL = 3;
    public const uint FLASHW_TIMERNOFG = 12;

    public static bool Flash(IntPtr handle, uint count) {
        FLASHWINFO fi = new FLASHWINFO();
        fi.cbSize = (uint)Marshal.SizeOf(fi);
        fi.hwnd = handle;
        fi.dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG;
        fi.uCount = count;
        fi.dwTimeout = 0;
        return FlashWindowEx(ref fi);
    }
}
"@

# Find VS Code window
$vsCodeProcess = Get-Process -Name "Code" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($vsCodeProcess) {
    [WindowFlash]::Flash($vsCodeProcess.MainWindowHandle, ${count})
}
`;
                await execAsync(`powershell -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
                    windowsHide: true
                });
                return true;
            } else {
                // On other platforms, just play attention sound
                return await this.playAttention();
            }
        } catch (error) {
            console.error('Flash window failed:', error);
            return false;
        }
    }
}
