/**
 * MCP SSE Server - Provides MCP protocol over SSE for Claude Code
 * This allows the VS Code extension to be used as an MCP server
 */

import * as http from 'http';
import * as vscode from 'vscode';
import { NotificationManager } from '../ui/notifications';

interface McpRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
}

interface McpResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: unknown;
    error?: { code: number; message: string };
}

interface McpNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

// Tool definitions for MCP
const TOOLS = [
    {
        name: 'play_notification',
        description: 'Play a notification sound on the local machine. Use this to alert the user.',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['default', 'success', 'error', 'warning'],
                    description: 'Type of notification sound',
                    default: 'default'
                },
                message: {
                    type: 'string',
                    description: 'Optional message to show in VS Code notification'
                }
            }
        }
    },
    {
        name: 'show_message',
        description: 'Show a message notification in VS Code',
        inputSchema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'Message to display'
                },
                type: {
                    type: 'string',
                    enum: ['info', 'warning', 'error'],
                    description: 'Message type',
                    default: 'info'
                }
            },
            required: ['message']
        }
    },
    {
        name: 'play_attention',
        description: 'Play attention-grabbing sound (multiple beeps) to get user attention',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
];

export class McpSseServer {
    private server: http.Server | null = null;
    private notificationManager: NotificationManager;
    private sseClients: Set<http.ServerResponse> = new Set();
    private port: number = 9847;
    private outputChannel: vscode.OutputChannel;

    constructor(notificationManager: NotificationManager) {
        this.notificationManager = notificationManager;
        this.outputChannel = vscode.window.createOutputChannel('SSH Bridge MCP');
    }

    /**
     * Start the MCP SSE server
     */
    async start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    // Try next port
                    this.port++;
                    this.server?.listen(this.port);
                } else {
                    reject(err);
                }
            });

            this.server.listen(this.port, '127.0.0.1', () => {
                this.log(`MCP SSE Server started on port ${this.port}`);
                vscode.window.showInformationMessage(`SSH Bridge MCP server running on port ${this.port}`);
                resolve(this.port);
            });
        });
    }

    /**
     * Stop the server
     */
    stop(): void {
        // Close all SSE connections
        for (const client of this.sseClients) {
            client.end();
        }
        this.sseClients.clear();

        if (this.server) {
            this.server.close();
            this.server = null;
            this.log('MCP SSE Server stopped');
        }
    }

    /**
     * Get the server port
     */
    getPort(): number {
        return this.port;
    }

    /**
     * Handle incoming HTTP requests
     */
    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = req.url || '/';
        const urlPath = url.split('?')[0];  // Remove query string
        this.log(`${req.method} ${url}`);

        if (urlPath === '/sse' && req.method === 'GET') {
            this.handleSseConnection(req, res);
        } else if (urlPath === '/message' && req.method === 'POST') {
            this.handleMessage(req, res);
        } else if (urlPath === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', port: this.port }));
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    }

    /**
     * Handle SSE connection
     */
    private handleSseConnection(req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Add to clients
        this.sseClients.add(res);
        this.log(`SSE client connected (total: ${this.sseClients.size})`);

        // Send endpoint event (MCP SSE protocol)
        const sessionId = `session-${Date.now()}`;
        this.sendSseEvent(res, 'endpoint', `/message?sessionId=${sessionId}`);

        // Handle client disconnect
        req.on('close', () => {
            this.sseClients.delete(res);
            this.log(`SSE client disconnected (total: ${this.sseClients.size})`);
        });

        // Keep-alive ping every 30 seconds
        const pingInterval = setInterval(() => {
            if (this.sseClients.has(res)) {
                res.write(': ping\n\n');
            } else {
                clearInterval(pingInterval);
            }
        }, 30000);
    }

    /**
     * Handle MCP JSON-RPC messages
     */
    private async handleMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        let body = '';
        req.on('data', chunk => { body += chunk; });

        req.on('end', async () => {
            try {
                const message: McpRequest = JSON.parse(body);
                this.log(`Received: ${message.method}`);

                const response = await this.processMessage(message);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));

                // Also broadcast response via SSE
                this.broadcastSse('message', response);

            } catch (error) {
                this.log(`Error: ${error}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' }
                }));
            }
        });
    }

    /**
     * Process MCP message and return response
     */
    private async processMessage(message: McpRequest): Promise<McpResponse> {
        const { id, method, params } = message;

        switch (method) {
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: 'ssh-bridge-mcp',
                            version: '0.1.0'
                        }
                    }
                };

            case 'notifications/initialized':
                return { jsonrpc: '2.0', id, result: {} };

            case 'tools/list':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: { tools: TOOLS }
                };

            case 'tools/call':
                return await this.handleToolCall(id, params as { name: string; arguments?: Record<string, unknown> });

            case 'ping':
                return { jsonrpc: '2.0', id, result: {} };

            default:
                return {
                    jsonrpc: '2.0',
                    id,
                    error: { code: -32601, message: `Method not found: ${method}` }
                };
        }
    }

    /**
     * Handle tool calls
     */
    private async handleToolCall(
        id: number | string,
        params: { name: string; arguments?: Record<string, unknown> }
    ): Promise<McpResponse> {
        const { name, arguments: args = {} } = params;
        this.log(`Tool call: ${name} ${JSON.stringify(args)}`);

        try {
            let result: unknown;

            switch (name) {
                case 'play_notification':
                    await this.notificationManager.playSound(args.type as string || 'default');
                    if (args.message) {
                        vscode.window.showInformationMessage(args.message as string);
                    }
                    result = { success: true };
                    break;

                case 'show_message':
                    const msgType = args.type as string || 'info';
                    const msg = args.message as string || '';
                    if (msgType === 'error') {
                        vscode.window.showErrorMessage(msg);
                    } else if (msgType === 'warning') {
                        vscode.window.showWarningMessage(msg);
                    } else {
                        vscode.window.showInformationMessage(msg);
                    }
                    result = { success: true };
                    break;

                case 'play_attention':
                    await this.notificationManager.playAttention();
                    result = { success: true };
                    break;

                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: { code: -32602, message: `Unknown tool: ${name}` }
                    };
            }

            return {
                jsonrpc: '2.0',
                id,
                result: {
                    content: [{ type: 'text', text: JSON.stringify(result) }]
                }
            };
        } catch (error) {
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32000, message: `Tool error: ${error}` }
            };
        }
    }

    /**
     * Send SSE event to a client
     */
    private sendSseEvent(res: http.ServerResponse, event: string, data: unknown): void {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        res.write(`event: ${event}\n`);
        res.write(`data: ${dataStr}\n\n`);
    }

    /**
     * Broadcast SSE event to all clients
     */
    private broadcastSse(event: string, data: unknown): void {
        for (const client of this.sseClients) {
            this.sendSseEvent(client, event, data);
        }
    }

    /**
     * Log message to output channel
     */
    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }
}
