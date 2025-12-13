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

$p = Get-Process -Name "Code" | Select-Object -First 1
if ($p) {
    Write-Host "Handle: $($p.MainWindowHandle)"
    $result = [WindowFlash]::Flash($p.MainWindowHandle, 10)
    Write-Host "Flash result: $result"
} else {
    Write-Host "VS Code not found"
}
