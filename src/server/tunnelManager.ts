/**
 * SSH Tunnel Manager - Manages reverse SSH tunnels to remote hosts
 * Automatically creates and maintains tunnels for remote Claude Code instances
 */

import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';

export interface TunnelConfig {
    /** Remote host in format: user@host:port or user@host (default port 22) */
    host: string;
    /** Remote port to bind (default: 9847) */
    remotePort?: number;
    /** Local port to forward (default: 9847) */
    localPort?: number;
    /** SSH identity file path (optional) */
    identityFile?: string;
    /** Enable this tunnel (default: true) */
    enabled?: boolean;
}

interface TunnelState {
    config: TunnelConfig;
    process: ChildProcess | null;
    status: 'connecting' | 'connected' | 'disconnected' | 'error';
    lastError?: string;
    reconnectAttempts: number;
    reconnectTimer?: NodeJS.Timeout;
}

export class TunnelManager {
    private tunnels: Map<string, TunnelState> = new Map();
    private outputChannel: vscode.OutputChannel;
    private localPort: number;
    private maxReconnectAttempts = 10;
    private baseReconnectDelay = 3000; // 3 seconds

    constructor(localPort: number) {
        this.localPort = localPort;
        this.outputChannel = vscode.window.createOutputChannel('SSH Bridge Tunnels');
    }

    /**
     * Start tunnels from configuration
     */
    async startTunnels(configs: TunnelConfig[]): Promise<void> {
        for (const config of configs) {
            if (config.enabled !== false) {
                await this.startTunnel(config);
            }
        }
    }

    /**
     * Start a single tunnel
     */
    async startTunnel(config: TunnelConfig): Promise<void> {
        const key = this.getTunnelKey(config);

        // Stop existing tunnel if any
        this.stopTunnel(key);

        const state: TunnelState = {
            config,
            process: null,
            status: 'connecting',
            reconnectAttempts: 0
        };
        this.tunnels.set(key, state);

        this.log(`Starting tunnel to ${config.host}...`);
        await this.connect(state);
    }

    /**
     * Stop a tunnel by key
     */
    stopTunnel(key: string): void {
        const state = this.tunnels.get(key);
        if (state) {
            if (state.reconnectTimer) {
                clearTimeout(state.reconnectTimer);
            }
            if (state.process) {
                state.process.kill();
            }
            this.tunnels.delete(key);
            this.log(`Stopped tunnel: ${key}`);
        }
    }

    /**
     * Stop all tunnels
     */
    stopAll(): void {
        for (const key of this.tunnels.keys()) {
            this.stopTunnel(key);
        }
    }

    /**
     * Get tunnel status
     */
    getStatus(): Array<{ host: string; status: string; error?: string }> {
        const result: Array<{ host: string; status: string; error?: string }> = [];
        for (const [key, state] of this.tunnels) {
            result.push({
                host: key,
                status: state.status,
                error: state.lastError
            });
        }
        return result;
    }

    /**
     * Connect to remote host
     */
    private async connect(state: TunnelState): Promise<void> {
        const { config } = state;
        const remotePort = config.remotePort || 9847;
        const localPort = config.localPort || this.localPort;

        // Parse host: user@host:port or user@host
        let sshHost = config.host;
        let sshPort = '22';

        // Check for port in host string (user@host:port)
        const portMatch = config.host.match(/^(.+):(\d+)$/);
        if (portMatch) {
            sshHost = portMatch[1];
            sshPort = portMatch[2];
        }

        // Build SSH command
        const sshArgs = [
            '-o', 'TCPKeepAlive=yes',
            '-o', 'ServerAliveInterval=10',
            '-o', 'ServerAliveCountMax=3',
            '-o', 'ExitOnForwardFailure=yes',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'BatchMode=yes',  // Don't prompt for password
            '-N',  // No command
            '-R', `${remotePort}:localhost:${localPort}`,
            '-p', sshPort
        ];

        if (config.identityFile) {
            sshArgs.push('-i', config.identityFile);
        }

        sshArgs.push(sshHost);

        this.log(`SSH command: ssh ${sshArgs.join(' ')}`);

        try {
            const sshProcess = spawn('ssh', sshArgs, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            state.process = sshProcess;

            sshProcess.stdout?.on('data', (data) => {
                this.log(`[${config.host}] ${data.toString().trim()}`);
            });

            sshProcess.stderr?.on('data', (data) => {
                const msg = data.toString().trim();
                this.log(`[${config.host}] stderr: ${msg}`);

                // Check for common errors
                if (msg.includes('remote port forwarding failed')) {
                    state.lastError = 'Remote port already in use';
                } else if (msg.includes('Permission denied')) {
                    state.lastError = 'SSH authentication failed';
                } else if (msg.includes('Connection refused')) {
                    state.lastError = 'Connection refused';
                }
            });

            sshProcess.on('spawn', () => {
                this.log(`[${config.host}] SSH process started`);
                // Give it a moment to establish the tunnel
                setTimeout(() => {
                    if (state.process && !state.process.killed) {
                        state.status = 'connected';
                        state.reconnectAttempts = 0;
                        this.log(`[${config.host}] Tunnel connected`);
                        vscode.window.showInformationMessage(`SSH tunnel to ${config.host} connected`);
                    }
                }, 2000);
            });

            sshProcess.on('error', (err) => {
                this.log(`[${config.host}] SSH error: ${err.message}`);
                state.status = 'error';
                state.lastError = err.message;
                this.scheduleReconnect(state);
            });

            sshProcess.on('exit', (code, signal) => {
                this.log(`[${config.host}] SSH exited: code=${code}, signal=${signal}`);
                state.process = null;

                if (state.status === 'connected') {
                    state.status = 'disconnected';
                    vscode.window.showWarningMessage(`SSH tunnel to ${config.host} disconnected, reconnecting...`);
                }

                this.scheduleReconnect(state);
            });

        } catch (error) {
            this.log(`[${config.host}] Failed to start SSH: ${error}`);
            state.status = 'error';
            state.lastError = `${error}`;
            this.scheduleReconnect(state);
        }
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    private scheduleReconnect(state: TunnelState): void {
        if (state.reconnectAttempts >= this.maxReconnectAttempts) {
            this.log(`[${state.config.host}] Max reconnect attempts reached`);
            state.status = 'error';
            state.lastError = 'Max reconnect attempts reached';
            return;
        }

        state.reconnectAttempts++;
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(1.5, state.reconnectAttempts - 1),
            60000 // Max 1 minute
        );

        this.log(`[${state.config.host}] Reconnecting in ${delay / 1000}s (attempt ${state.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        state.reconnectTimer = setTimeout(() => {
            state.status = 'connecting';
            this.connect(state);
        }, delay);
    }

    /**
     * Get unique key for tunnel
     */
    private getTunnelKey(config: TunnelConfig): string {
        return `${config.host}:${config.remotePort || 9847}`;
    }

    /**
     * Log message
     */
    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
        console.log(`[TunnelManager] ${message}`);
    }

    /**
     * Show output channel
     */
    showOutput(): void {
        this.outputChannel.show();
    }
}
