# Changelog

All notable changes to the SSH Bridge MCP extension will be documented in this file.

## [0.1.0] - 2025-01-13

### Added

- **MCP SSE Server** - Built-in MCP server using SSE transport (port 9847)
- **Notification Tools**
  - `play_notification` - Play system sounds (default/success/error/warning)
  - `show_message` - Show VS Code notifications
  - `play_attention` - Attention sound with taskbar flash (Windows)
- **Browser Automation** (Puppeteer)
  - `browser_navigate` - Navigate to URL
  - `browser_screenshot` - Take screenshots with optional SCP transfer
  - `browser_click` - Click elements
  - `browser_fill` - Fill input fields
  - `browser_select` - Select dropdown options
  - `browser_hover` - Hover over elements
  - `browser_evaluate` - Execute JavaScript
  - `browser_console` - Get console logs
  - `browser_list_pages` - List all open pages
  - `browser_switch_page` - Switch between pages
- **TTS Integration** - Text-to-speech via Kokoro TTS server
- **Remote SSH Support** - Works via SSH reverse tunnel
- **Extension Logo** - Custom designed icon
