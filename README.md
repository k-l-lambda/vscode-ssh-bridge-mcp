# SSH Bridge MCP

VS Code extension that provides an MCP (Model Context Protocol) server for Claude Code, enabling notification sounds and messages to be triggered locally when working via Remote SSH.

## Features

- **MCP SSE Server** - Built-in MCP server using SSE transport (port 9847)
- **Notification Sounds** - Play system sounds locally when triggered from remote Claude Code
- **VS Code Messages** - Show info/warning/error notifications in VS Code
- **Remote SSH Support** - Works seamlessly with VS Code Remote SSH via SSH reverse tunnel

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Local Windows/macOS/Linux (VS Code)                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ssh-bridge-mcp Extension                                   │ │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │ │
│  │  │ HTTP Server  │◄───│ MCP Protocol │    │ Notification │ │ │
│  │  │ :9847 (SSE)  │    │ Handler      │───▶│ Manager      │ │ │
│  │  └──────┬───────┘    └──────────────┘    └──────────────┘ │ │
│  └─────────│──────────────────────────────────────────────────┘ │
│            │ SSH Reverse Tunnel (-R 9847:127.0.0.1:9847)        │
└────────────│────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│  Remote Linux Server                                             │
│  ┌──────────────┐                                               │
│  │ Claude Code  │──▶ http://127.0.0.1:9847/sse                  │
│  │ (MCP Client) │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

### From VSIX (Recommended)

1. Download or build the `.vsix` file
2. In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Select the `ssh-bridge-mcp-x.x.x.vsix` file
4. Restart VS Code

### From Source

```bash
git clone https://github.com/k-l-lambda/vscode-ssh-bridge-mcp.git
cd vscode-ssh-bridge-mcp
npm install
npm run compile
vsce package
```

## Setup for Remote SSH

### 1. Configure SSH Reverse Tunnel

Add `RemoteForward` to your local `~/.ssh/config`:

```
Host your-remote-server
  HostName x.x.x.x
  User your-user
  RemoteForward 9847 127.0.0.1:9847
```

### 2. Reconnect VS Code Remote SSH

Disconnect and reconnect to the remote server for the tunnel to take effect.

### 3. Verify Tunnel (on remote server)

```bash
curl http://127.0.0.1:9847/health
# Should return: {"status":"ok","port":9847}
```

### 4. Add MCP to Claude Code (on remote server)

```bash
claude mcp add ssh-bridge -s user --transport sse http://127.0.0.1:9847/sse
```

### 5. Restart Claude Code

```bash
claude
# or restart your existing Claude Code session
```

## MCP Tools

The extension provides these tools for Claude Code:

### `play_notification`

Play a notification sound on your local machine.

```
Parameters:
- type: "default" | "success" | "error" | "warning" (optional, default: "default")
- message: string (optional) - Also show a VS Code notification
```

**Example usage in Claude Code:**
> "Play a notification sound to let me know the build is done"

### `show_message`

Show a notification message in VS Code.

```
Parameters:
- message: string (required) - The message to display
- type: "info" | "warning" | "error" (optional, default: "info")
```

**Example usage in Claude Code:**
> "Show me a warning message that says 'Tests are failing'"

### `play_attention`

Play an attention-grabbing sound (multiple beeps) to alert the user.

```
Parameters: none
```

**Example usage in Claude Code:**
> "Play an attention sound, I need user input"

## VS Code Commands

- `SSH Bridge: Play Notification Sound` - Test the notification sound
- `SSH Bridge: Test MCP Connection` - Show server status and port
- `SSH Bridge: Show Setup Instructions` - Open setup guide in a webview

## Troubleshooting

### MCP connection fails on remote

1. **Check if the extension is running locally:**
   ```bash
   # On your local machine
   curl http://127.0.0.1:9847/health
   ```

2. **Check SSH tunnel:**
   ```bash
   # On remote server
   curl http://127.0.0.1:9847/health
   ```
   If this fails but local works, the SSH tunnel is not configured.

3. **Re-add RemoteForward and reconnect:**
   - Edit `~/.ssh/config` on your local machine
   - Disconnect VS Code Remote SSH
   - Reconnect to establish the tunnel

### No sound plays

- **Windows**: Ensure system sounds are not muted
- **macOS**: Check System Preferences → Sound
- **Linux**: Install `libcanberra-gtk3-module` or ensure PulseAudio is running

### Port 9847 already in use

The extension will automatically try the next port (9848, 9849, etc.). Check the actual port with:
- VS Code command: `SSH Bridge: Test MCP Connection`
- Or check the Output panel: `SSH Bridge MCP`

## Development

```bash
npm install
npm run watch   # Watch mode for development
npm run compile # One-time compile
vsce package    # Build VSIX
```

## License

MIT
