/**
 * SSH Bridge MCP - VS Code Extension
 * Main entry point
 */

import * as vscode from 'vscode';
import { NotificationManager } from './ui/notifications';
import { McpSseServer } from './server/mcpSseServer';

let notificationManager: NotificationManager;
let mcpServer: McpSseServer;

export async function activate(context: vscode.ExtensionContext) {
    console.log('SSH Bridge MCP is now active');

    // Detect if running in remote or local
    const isRemote = vscode.env.remoteName !== undefined;
    console.log(`Running in ${isRemote ? 'remote' : 'local'} mode`);

    // Initialize notification manager (runs on UI side - local)
    notificationManager = new NotificationManager(context);

    // Initialize and start MCP SSE server
    mcpServer = new McpSseServer(notificationManager);

    try {
        const port = await mcpServer.start();

        // Show connection info
        const configCmd = `claude mcp add ssh-bridge -s user --transport sse http://127.0.0.1:${port}/sse`;
        console.log(`MCP Server ready. Add to Claude Code with:\n${configCmd}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to start MCP server: ${error}`);
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
            const port = mcpServer.getPort();
            vscode.window.showInformationMessage(
                `MCP Server running on port ${port}. ` +
                `Add to Claude Code: claude mcp add ssh-bridge -s user --transport sse http://127.0.0.1:${port}/sse`
            );
        }
    );

    const showSetupCmd = vscode.commands.registerCommand(
        'ssh-bridge-mcp.showSetup',
        async () => {
            const port = mcpServer.getPort();
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

export function deactivate() {
    if (mcpServer) {
        mcpServer.stop();
    }
}
