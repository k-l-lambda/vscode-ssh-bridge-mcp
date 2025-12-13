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

Play an attention-grabbing sound and/or flash the taskbar button.

```
Parameters:
- sound: boolean (optional, default: true) - Play attention sound
- flash: boolean (optional, default: true) - Flash taskbar button (Windows only)
- flashCount: number (optional, default: 5) - Number of times to flash
```

**Example usage in Claude Code:**
> "Get my attention with sound and taskbar flash"

### `browser_navigate`

Navigate the browser to a URL.

```
Parameters:
- url: string (required) - URL to navigate to
```

### `browser_screenshot`

Take a screenshot of the current page or a specific element.

```
Parameters:
- name: string (required) - Name for the screenshot
- selector: string (optional) - CSS selector for element to screenshot
- width: number (optional, default: 800) - Width in pixels
- height: number (optional, default: 600) - Height in pixels
- remoteHost: string (optional) - SCP destination to transfer screenshot (e.g., "user@host:/path")
```

### `browser_click`

Click an element on the page.

```
Parameters:
- selector: string (required) - CSS selector for element to click
```

### `browser_fill`

Fill out an input field.

```
Parameters:
- selector: string (required) - CSS selector for input field
- value: string (required) - Value to fill
```

### `browser_select`

Select an option from a dropdown.

```
Parameters:
- selector: string (required) - CSS selector for select element
- value: string (required) - Value to select
```

### `browser_hover`

Hover over an element on the page.

```
Parameters:
- selector: string (required) - CSS selector for element to hover
```

### `browser_evaluate`

Execute JavaScript in the browser console.

```
Parameters:
- script: string (required) - JavaScript code to execute
```

### `browser_console`

Get browser console logs.

```
Parameters:
- filter: "all" | "error" | "warning" | "log" | "info" (optional, default: "all")
- clear: boolean (optional, default: false) - Clear logs after retrieving
```

### `browser_list_pages`

List all open browser pages/tabs.

```
Parameters: none

Returns:
- pages: Array of {index, url, title, isCurrent}
```

### `browser_switch_page`

Switch to a specific browser page by index.

```
Parameters:
- index: number (required) - Page index (0-based)
```

### `speak` (TTS)

Speak text aloud using Kokoro TTS (requires separate TTS server).

```
Parameters:
- text: string (required) - Text to speak
- voice: "default" | "female" | "male" (optional)
- lang: "en" | "zh" | "auto" (optional, default: "auto")
```

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
