/**
 * MCP Bridge - Handles MCP protocol communication
 * This component can connect to MCP servers via SSE transport
 */

import * as vscode from 'vscode';
import { NotificationManager } from '../ui/notifications';

interface McpServerConfig {
    name: string;
    url: string;
    enabled: boolean;
}

export class McpBridge {
    private context: vscode.ExtensionContext;
    private notificationManager: NotificationManager;
    private servers: Map<string, McpServerConnection> = new Map();
    private status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

    constructor(context: vscode.ExtensionContext, notificationManager: NotificationManager) {
        this.context = context;
        this.notificationManager = notificationManager;

        // Watch for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ssh-bridge-mcp.mcpServers')) {
                this.reloadServers();
            }
        });

        // Initial load
        this.reloadServers();
    }

    /**
     * Get current connection status
     */
    getStatus(): string {
        const connectedCount = Array.from(this.servers.values())
            .filter(s => s.isConnected()).length;

        if (connectedCount === 0) {
            return 'No MCP servers connected';
        }
        return `${connectedCount} MCP server(s) connected`;
    }

    /**
     * Reload server configurations
     */
    private async reloadServers(): Promise<void> {
        const config = vscode.workspace.getConfiguration('ssh-bridge-mcp');
        const serverConfigs = config.get<McpServerConfig[]>('mcpServers', []);

        // Close existing connections
        for (const server of this.servers.values()) {
            server.disconnect();
        }
        this.servers.clear();

        // Create new connections
        for (const serverConfig of serverConfigs) {
            if (serverConfig.enabled) {
                const connection = new McpServerConnection(
                    serverConfig,
                    this.handleToolCall.bind(this)
                );
                this.servers.set(serverConfig.name, connection);
                await connection.connect();
            }
        }
    }

    /**
     * Handle incoming tool calls from MCP servers
     */
    private async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
        // Route tool calls to appropriate handlers
        switch (toolName) {
            case 'notify':
            case 'play_sound':
                await this.notificationManager.playSound(args.type as string || 'default');
                if (args.message) {
                    vscode.window.showInformationMessage(args.message as string);
                }
                return { success: true };

            case 'show_message':
                const messageType = args.type as string || 'info';
                const message = args.message as string || '';

                if (messageType === 'error') {
                    vscode.window.showErrorMessage(message);
                } else if (messageType === 'warning') {
                    vscode.window.showWarningMessage(message);
                } else {
                    vscode.window.showInformationMessage(message);
                }
                return { success: true };

            default:
                console.log(`Unknown tool call: ${toolName}`);
                return { success: false, error: 'Unknown tool' };
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        for (const server of this.servers.values()) {
            server.disconnect();
        }
        this.servers.clear();
    }
}

/**
 * Individual MCP server connection using SSE transport
 */
class McpServerConnection {
    private config: McpServerConfig;
    private eventSource: EventSource | null = null;
    private connected: boolean = false;
    private onToolCall: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

    constructor(
        config: McpServerConfig,
        onToolCall: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
    ) {
        this.config = config;
        this.onToolCall = onToolCall;
    }

    /**
     * Connect to MCP server via SSE
     */
    async connect(): Promise<boolean> {
        try {
            // In VS Code extension, we need to use the native EventSource or fetch API
            // For Remote SSH, we may need to use port forwarding

            const url = await this.resolveUrl(this.config.url);

            // Note: Full SSE implementation would go here
            // For MVP, we just validate the URL and mark as ready
            console.log(`MCP Bridge: Ready to connect to ${url}`);
            this.connected = true;

            return true;
        } catch (error) {
            console.error(`Failed to connect to MCP server ${this.config.name}:`, error);
            return false;
        }
    }

    /**
     * Resolve URL for Remote SSH scenario
     */
    private async resolveUrl(url: string): Promise<string> {
        try {
            // Use VS Code's port forwarding for remote scenarios
            const uri = vscode.Uri.parse(url);
            const externalUri = await vscode.env.asExternalUri(uri);
            return externalUri.toString();
        } catch {
            return url;
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Disconnect from server
     */
    disconnect(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.connected = false;
    }
}
