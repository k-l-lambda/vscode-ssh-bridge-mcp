/**
 * SSH Bridge MCP - VS Code Extension
 * Main entry point
 */

import * as vscode from 'vscode';
import { NotificationManager } from './ui/notifications';
import { McpSseServer } from './server/mcpSseServer';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as http from 'http';

let notificationManager: NotificationManager;
let mcpServer: McpSseServer | null = null;
let ttsServerProcess: ChildProcess | null = null;

const TTS_PORT = 19849;  // Use a unique port to avoid conflicts

export async function activate(context: vscode.ExtensionContext) {
    console.log('SSH Bridge MCP is now active');

    // Detect if running in remote or local
    const isRemote = vscode.env.remoteName !== undefined;
    console.log(`Running in ${isRemote ? 'remote' : 'local'} mode`);

    // Initialize notification manager (runs on UI side - local)
    notificationManager = new NotificationManager(context);

    // Only start MCP server in local mode
    // In remote mode, use the local VS Code's server via SSH port forwarding (9847)
    if (!isRemote) {
        // Initialize and start MCP SSE server
        mcpServer = new McpSseServer(notificationManager);
        try {
            const port = await mcpServer.start();
            // Show connection info
            const configCmd = `claude mcp add ssh-bridge -s user --transport sse http://127.0.0.1:${port}/sse`;
            console.log(`MCP Server ready. Add to Claude Code with:
${configCmd}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start MCP server: ${error}`);
        }
        // Start TTS server in background (only in local mode)
        startTtsServer();
    } else {
        console.log('Running in remote mode - SSE server not started. Use local VS Code server via port forwarding (9847).');
    }

    // Register commands
    const playNotificationCmd = vscode.commands.registerCommand(
        'ssh-bridge-mcp.playNotification',
        async () => {
            await notificationManager.playSound('default');
            vscode.window.showInformationMessage('Notification sound played!');
        }
    );

    const testConnectionCmd = vscode.commands.registerCommand(
        'ssh-bridge-mcp.testConnection',
        async () => {
            const port = mcpServer ? mcpServer.getPort() : 9847;
            vscode.window.showInformationMessage(
                `MCP Server running on port ${port}. ` +
                `Add to Claude Code: claude mcp add ssh-bridge -s user --transport sse http://127.0.0.1:${port}/sse`
            );
        }
    );

    const showSetupCmd = vscode.commands.registerCommand(
        'ssh-bridge-mcp.showSetup',
        async () => {
            const port = mcpServer ? mcpServer.getPort() : 9847;
            const panel = vscode.window.createWebviewPanel(
                'mcpSetup',
                'SSH Bridge MCP Setup',
                vscode.ViewColumn.One,
                {}
            );

            panel.webview.html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: var(--vscode-font-family); padding: 20px; }
                        code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; }
                        pre { background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 5px; overflow-x: auto; }
                        .success { color: #4caf50; }
                    </style>
                </head>
                <body>
                    <h1>SSH Bridge MCP Setup</h1>
                    <p class="success">✓ MCP Server is running on port <strong>${port}</strong></p>

                    <h2>Add to Claude Code</h2>
                    <p>Run this command in your terminal:</p>
                    <pre>claude mcp add ssh-bridge -s user --transport sse http://127.0.0.1:${port}/sse</pre>

                    <h2>Available Tools</h2>
                    <ul>
                        <li><code>play_notification</code> - Play notification sound</li>
                        <li><code>show_message</code> - Show VS Code notification</li>
                        <li><code>play_attention</code> - Play attention sound</li>
                    </ul>

                    <h2>Test</h2>
                    <p>After adding, restart Claude Code and ask it to "play a notification sound".</p>
                </body>
                </html>
            `;
        }
    );

    // Register command for remote-to-local notification
    const remoteNotifyCmd = vscode.commands.registerCommand(
        'ssh-bridge-mcp.remoteNotify',
        async (data: { sound?: string; message?: string }) => {
            if (data.sound) {
                await notificationManager.playSound(data.sound);
            }
            if (data.message) {
                vscode.window.showInformationMessage(data.message);
            }
        }
    );

    context.subscriptions.push(
        playNotificationCmd,
        testConnectionCmd,
        showSetupCmd,
        remoteNotifyCmd
    );

}

/**
 * Check if TTS server is running
 */
async function isTtsServerRunning(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: TTS_PORT,
            path: '/health',
            method: 'GET',
            timeout: 1000
        }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

/**
 * Start the Kokoro TTS server
 */
async function startTtsServer(): Promise<void> {
    // Check if already running
    if (await isTtsServerRunning()) {
        console.log('[TTS] Server already running');
        return;
    }

    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    const kokoroPath = path.join(userProfile, 'work', 'kokoro-test');
    const pythonPath = path.join(kokoroPath, 'env', 'Scripts', 'python.exe');
    const serverScript = path.join(kokoroPath, 'kokoro_server.py');

    console.log(`[TTS] Starting server: ${pythonPath} ${serverScript} ${TTS_PORT}`);

    try {
        ttsServerProcess = spawn(pythonPath, [serverScript, TTS_PORT.toString()], {
            cwd: kokoroPath,
            env: {
                ...process.env,
                HF_HUB_OFFLINE: '1'  // Use cached models only
            },
            detached: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        ttsServerProcess.stdout?.on('data', (data) => {
            console.log(`[TTS] ${data.toString().trim()}`);
        });

        ttsServerProcess.stderr?.on('data', (data) => {
            console.error(`[TTS Error] ${data.toString().trim()}`);
        });

        ttsServerProcess.on('error', (err) => {
            console.error(`[TTS] Failed to start: ${err.message}`);
            ttsServerProcess = null;
        });

        ttsServerProcess.on('exit', (code) => {
            console.log(`[TTS] Server exited with code ${code}`);
            ttsServerProcess = null;
        });

        // Wait a moment for server to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (await isTtsServerRunning()) {
            console.log('[TTS] Server started successfully');
        } else {
            console.warn('[TTS] Server may not have started properly');
        }

    } catch (error) {
        console.error(`[TTS] Error starting server: ${error}`);
    }
}

/**
 * Stop the TTS server
 */
function stopTtsServer(): void {
    if (ttsServerProcess) {
        console.log('[TTS] Stopping server...');
        ttsServerProcess.kill();
        ttsServerProcess = null;
    }
}

export function deactivate() {
    stopTtsServer();
    if (mcpServer) {
        mcpServer.stop();
    }
}
