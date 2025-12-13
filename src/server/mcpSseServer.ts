/**
 * MCP SSE Server - Provides MCP protocol over SSE for Claude Code
 * This allows the VS Code extension to be used as an MCP server
 */

import * as http from 'http';
import * as vscode from 'vscode';
import * as path from 'path';
import { NotificationManager } from '../ui/notifications';

// Puppeteer types - lazy loaded
let puppeteer: typeof import('puppeteer') | null = null;
let browser: import('puppeteer').Browser | null = null;
let page: import('puppeteer').Page | null = null;

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
    },
    {
        name: 'speak',
        description: 'Speak text aloud using Kokoro TTS. Supports English and Chinese with auto language detection.',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Text to speak'
                },
                voice: {
                    type: 'string',
                    enum: ['default', 'female', 'male'],
                    description: 'Voice type',
                    default: 'default'
                },
                lang: {
                    type: 'string',
                    enum: ['en', 'zh', 'auto'],
                    description: 'Language (auto-detected if not specified)',
                    default: 'auto'
                }
            },
            required: ['text']
        }
    },
    // Puppeteer tools for browser automation
    {
        name: 'browser_navigate',
        description: 'Navigate the browser to a URL',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'URL to navigate to'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current page or a specific element',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name for the screenshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector for element to screenshot (optional)'
                },
                width: {
                    type: 'number',
                    description: 'Width in pixels (default: 800)'
                },
                height: {
                    type: 'number',
                    description: 'Height in pixels (default: 600)'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'browser_click',
        description: 'Click an element on the page',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector for element to click'
                }
            },
            required: ['selector']
        }
    },
    {
        name: 'browser_fill',
        description: 'Fill out an input field',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector for input field'
                },
                value: {
                    type: 'string',
                    description: 'Value to fill'
                }
            },
            required: ['selector', 'value']
        }
    },
    {
        name: 'browser_evaluate',
        description: 'Execute JavaScript in the browser console',
        inputSchema: {
            type: 'object',
            properties: {
                script: {
                    type: 'string',
                    description: 'JavaScript code to execute'
                }
            },
            required: ['script']
        }
    },
    {
        name: 'browser_select',
        description: 'Select an option from a dropdown',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector for select element'
                },
                value: {
                    type: 'string',
                    description: 'Value to select'
                }
            },
            required: ['selector', 'value']
        }
    },
    {
        name: 'browser_hover',
        description: 'Hover over an element on the page',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector for element to hover'
                }
            },
            required: ['selector']
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

                case 'speak':
                    result = await this.handleSpeak(args);
                    break;

                // Browser automation tools
                case 'browser_navigate':
                    result = await this.handleBrowserNavigate(args);
                    break;

                case 'browser_screenshot':
                    result = await this.handleBrowserScreenshot(args);
                    break;

                case 'browser_click':
                    result = await this.handleBrowserClick(args);
                    break;

                case 'browser_fill':
                    result = await this.handleBrowserFill(args);
                    break;

                case 'browser_evaluate':
                    result = await this.handleBrowserEvaluate(args);
                    break;

                case 'browser_select':
                    result = await this.handleBrowserSelect(args);
                    break;

                case 'browser_hover':
                    result = await this.handleBrowserHover(args);
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

    /**
     * Handle speak tool - calls Kokoro TTS server
     */
    private async handleSpeak(args: Record<string, unknown>): Promise<{ success: boolean; duration_ms?: number; error?: string }> {
        const text = args.text as string;
        const voice = args.voice as string || 'default';
        const lang = args.lang as string || 'auto';

        if (!text) {
            return { success: false, error: 'No text provided' };
        }

        const ttsPort = 19849;
        const ttsUrl = `http://127.0.0.1:${ttsPort}/speak_and_play`;

        try {
            // Check if TTS server is running
            const healthCheck = await this.httpRequest(`http://127.0.0.1:${ttsPort}/health`, 'GET');
            if (!healthCheck.ok) {
                // Try to start the TTS server
                this.log('TTS server not running, attempting to start...');
                await this.startTtsServer();
                // Wait a bit for it to start
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // Send TTS request
            const requestBody: Record<string, string> = { text };
            if (voice && voice !== 'default') {
                requestBody.voice = voice;
            }
            if (lang && lang !== 'auto') {
                requestBody.lang = lang;
            }
            this.log(`TTS request: ${JSON.stringify(requestBody)}`);
            const response = await this.httpRequest(ttsUrl, 'POST', requestBody);

            if (response.ok) {
                const data = JSON.parse(response.body);
                return { success: true, duration_ms: data.duration_ms };
            } else {
                return { success: false, error: `TTS failed: ${response.body}` };
            }
        } catch (error) {
            this.log(`TTS error: ${error}`);
            return { success: false, error: `TTS error: ${error}` };
        }
    }

    /**
     * Start the Kokoro TTS server
     */
    private async startTtsServer(): Promise<void> {
        const { exec } = require('child_process');
        const path = require('path');

        // Path to kokoro server
        const kokoroPath = path.join(process.env.USERPROFILE || '', 'work', 'kokoro-test');
        const pythonPath = path.join(kokoroPath, 'env', 'Scripts', 'python.exe');
        const serverScript = path.join(kokoroPath, 'kokoro_server.py');

        this.log(`Starting TTS server: ${pythonPath} ${serverScript}`);

        exec(`"${pythonPath}" "${serverScript}"`, {
            cwd: kokoroPath,
            windowsHide: true
        }, (error: Error | null) => {
            if (error) {
                this.log(`TTS server error: ${error.message}`);
            }
        });
    }

    /**
     * Simple HTTP request helper
     */
    private httpRequest(url: string, method: string, body?: unknown): Promise<{ ok: boolean; body: string }> {
        return new Promise((resolve) => {
            const urlObj = new URL(url);
            const bodyStr = body ? JSON.stringify(body) : undefined;
            const options: http.RequestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname,
                method,
                timeout: 60000  // 60 second timeout for TTS generation
            };

            if (bodyStr) {
                options.headers = {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr)
                };
            }

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    resolve({ ok: res.statusCode === 200, body: data });
                });
            });

            req.on('error', (e) => {
                resolve({ ok: false, body: e.message });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ ok: false, body: 'Request timeout' });
            });

            if (bodyStr) {
                req.write(bodyStr);
            }
            req.end();
        });
    }

    // ==================== Browser Automation Methods ====================

    /**
     * Ensure browser is initialized
     */
    private async ensureBrowser(): Promise<import('puppeteer').Page> {
        if (!puppeteer) {
            try {
                puppeteer = require('puppeteer');
            } catch (e) {
                throw new Error('Puppeteer not installed. Run: npm install puppeteer');
            }
        }

        if (!browser || !browser.isConnected()) {
            this.log('Launching browser...');
            browser = await puppeteer!.launch({
                headless: false,  // Show browser window
                defaultViewport: { width: 1280, height: 800 },
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const pages = await browser.pages();
            page = pages[0] || await browser.newPage();
            this.log('Browser launched');
        }

        if (!page || page.isClosed()) {
            page = await browser.newPage();
        }

        return page;
    }

    /**
     * Handle browser_navigate tool
     */
    private async handleBrowserNavigate(args: Record<string, unknown>): Promise<{ success: boolean; url?: string; title?: string; error?: string }> {
        const url = args.url as string;
        if (!url) {
            return { success: false, error: 'No URL provided' };
        }

        try {
            const p = await this.ensureBrowser();
            await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            const title = await p.title();
            this.log(`Navigated to: ${url}`);
            return { success: true, url, title };
        } catch (error) {
            return { success: false, error: `Navigation failed: ${error}` };
        }
    }

    /**
     * Handle browser_screenshot tool
     */
    private async handleBrowserScreenshot(args: Record<string, unknown>): Promise<{ success: boolean; path?: string; error?: string }> {
        const name = args.name as string || 'screenshot';
        const selector = args.selector as string | undefined;
        const width = args.width as number || 800;
        const height = args.height as number || 600;

        try {
            const p = await this.ensureBrowser();
            await p.setViewport({ width, height });

            const screenshotDir = path.join(process.env.USERPROFILE || '', 'Pictures', 'Screenshots');
            const screenshotPath = path.join(screenshotDir, `${name}-${Date.now()}.png`);

            // Ensure directory exists
            const fs = require('fs');
            if (!fs.existsSync(screenshotDir)) {
                fs.mkdirSync(screenshotDir, { recursive: true });
            }

            if (selector) {
                const element = await p.$(selector);
                if (element) {
                    await element.screenshot({ path: screenshotPath });
                } else {
                    return { success: false, error: `Element not found: ${selector}` };
                }
            } else {
                await p.screenshot({ path: screenshotPath, fullPage: false });
            }

            this.log(`Screenshot saved: ${screenshotPath}`);
            return { success: true, path: screenshotPath };
        } catch (error) {
            return { success: false, error: `Screenshot failed: ${error}` };
        }
    }

    /**
     * Handle browser_click tool
     */
    private async handleBrowserClick(args: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
        const selector = args.selector as string;
        if (!selector) {
            return { success: false, error: 'No selector provided' };
        }

        try {
            const p = await this.ensureBrowser();
            await p.click(selector);
            this.log(`Clicked: ${selector}`);
            return { success: true };
        } catch (error) {
            return { success: false, error: `Click failed: ${error}` };
        }
    }

    /**
     * Handle browser_fill tool
     */
    private async handleBrowserFill(args: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
        const selector = args.selector as string;
        const value = args.value as string;
        if (!selector || value === undefined) {
            return { success: false, error: 'Selector and value required' };
        }

        try {
            const p = await this.ensureBrowser();
            // Clear existing value first
            await p.click(selector, { clickCount: 3 });
            await p.type(selector, value);
            this.log(`Filled ${selector} with value`);
            return { success: true };
        } catch (error) {
            return { success: false, error: `Fill failed: ${error}` };
        }
    }

    /**
     * Handle browser_evaluate tool
     */
    private async handleBrowserEvaluate(args: Record<string, unknown>): Promise<{ success: boolean; result?: unknown; error?: string }> {
        const script = args.script as string;
        if (!script) {
            return { success: false, error: 'No script provided' };
        }

        try {
            const p = await this.ensureBrowser();
            const result = await p.evaluate(script);
            this.log(`Evaluated script`);
            return { success: true, result };
        } catch (error) {
            return { success: false, error: `Evaluate failed: ${error}` };
        }
    }

    /**
     * Handle browser_select tool
     */
    private async handleBrowserSelect(args: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
        const selector = args.selector as string;
        const value = args.value as string;
        if (!selector || !value) {
            return { success: false, error: 'Selector and value required' };
        }

        try {
            const p = await this.ensureBrowser();
            await p.select(selector, value);
            this.log(`Selected ${value} in ${selector}`);
            return { success: true };
        } catch (error) {
            return { success: false, error: `Select failed: ${error}` };
        }
    }

    /**
     * Handle browser_hover tool
     */
    private async handleBrowserHover(args: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
        const selector = args.selector as string;
        if (!selector) {
            return { success: false, error: 'No selector provided' };
        }

        try {
            const p = await this.ensureBrowser();
            await p.hover(selector);
            this.log(`Hovered: ${selector}`);
            return { success: true };
        } catch (error) {
            return { success: false, error: `Hover failed: ${error}` };
        }
    }
}
