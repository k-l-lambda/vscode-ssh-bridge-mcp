/**
 * SSH Bridge MCP - VS Code Extension
 * Main entry point
 */

import * as vscode from 'vscode';
import { NotificationManager } from './ui/notifications';
import { McpBridge } from './workspace/mcpBridge';

let notificationManager: NotificationManager;
let mcpBridge: McpBridge;

export function activate(context: vscode.ExtensionContext) {
    console.log('SSH Bridge MCP is now active');

    // Detect if running in remote or local
    const isRemote = vscode.env.remoteName !== undefined;
    console.log(`Running in ${isRemote ? 'remote' : 'local'} mode`);

    // Initialize notification manager (runs on UI side - local)
    notificationManager = new NotificationManager(context);

    // Initialize MCP bridge (can run on workspace side - remote)
    mcpBridge = new McpBridge(context, notificationManager);

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
            const status = mcpBridge.getStatus();
            vscode.window.showInformationMessage(`MCP Bridge Status: ${status}`);
        }
    );

    // Register command for remote-to-local notification
    const remoteNotifyCmd = vscode.commands.registerCommand(
        'ssh-bridge-mcp.remoteNotify',
        async (data: { sound?: string; message?: string }) => {
            // This command can be called from workspace extension
            // and will execute on UI extension (local machine)
            if (data.sound) {
                await notificationManager.playSound(data.sound);
            }
            if (data.message) {
                vscode.window.showInformationMessage(data.message);
            }
        }
    );

    context.subscriptions.push(playNotificationCmd, testConnectionCmd, remoteNotifyCmd);
}

export function deactivate() {
    if (mcpBridge) {
        mcpBridge.dispose();
    }
}
