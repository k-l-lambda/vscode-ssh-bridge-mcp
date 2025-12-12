# SSH Bridge MCP

VS Code extension for MCP (Model Context Protocol) integration with Remote SSH support.

## Features

- **Notification Sounds** - Play notification sounds locally when triggered from remote
- **Remote SSH Support** - Works seamlessly with VS Code Remote SSH
- **SSE Transport** - Connects to MCP servers via Server-Sent Events

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Local Machine (Client)                       │
│  ┌──────────────────┐  ┌─────────────────────────────────────┐ │
│  │   VS Code UI     │  │  UI Extension (extensionKind: ui)   │ │
│  │                  │  │  - Audio playback                   │ │
│  │                  │  │  - System notifications             │ │
│  └──────────────────┘  └─────────────────────────────────────┘ │
│           │                          │                           │
│           └──────────────────────────┼───────────────────────────┤
│                    SSH Connection    │   Port Forwarding         │
└──────────────────────────────────────│───────────────────────────┘
                                       │
┌──────────────────────────────────────│───────────────────────────┐
│                     Remote Server    │                           │
│  ┌───────────────────────────────────▼─────────────────────────┐│
│  │  Workspace Extension (extensionKind: workspace)              ││
│  │  - MCP Client (SSE transport)                                ││
│  │  - Receives tool calls from AI agents                        ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

## Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to launch extension development host

## Usage

Commands:
- `SSH Bridge: Play Notification Sound` - Test notification sound
- `SSH Bridge: Test MCP Connection` - Test MCP server connection

## Development

```bash
npm install
npm run watch
```

## License

MIT
