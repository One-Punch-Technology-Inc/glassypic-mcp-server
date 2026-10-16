# Installing @glassypic/mcp-server

## Quick Setup

Add the following to your MCP client configuration:

```json
{
  "mcpServers": {
    "glassypic": {
      "command": "npx",
      "args": ["-y", "@glassypic/mcp-server@latest"]
    }
  }
}
```

No API key or signup required. Works out of the box with 20 free daily credits.

## Configuration File Locations

| Client | Config Path |
|--------|------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| Claude Code | `~/.claude/settings.json` or run `claude mcp add glassypic -- npx @glassypic/mcp-server` |
| Cline | MCP settings in Cline UI (Settings → MCP Servers → Add) |
| Cursor | `.cursor/mcp.json` in your project root |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| OpenAI Codex CLI | `codex mcp add glassypic -- npx -y @glassypic/mcp-server@latest` or `~/.codex/config.toml` |
| Gemini CLI | `gemini mcp add --transport stdio glassypic npx -y @glassypic/mcp-server@latest` or `~/.gemini/settings.json` |

### OpenAI Codex CLI

```bash
codex mcp add glassypic -- npx -y @glassypic/mcp-server@latest
```

Or add manually to `~/.codex/config.toml`:

```toml
[mcp_servers.glassypic]
command = "npx"
args = ["-y", "@glassypic/mcp-server@latest"]
```

### Gemini CLI

```bash
gemini mcp add --transport stdio glassypic npx -y @glassypic/mcp-server@latest
```

Or add manually to `~/.gemini/settings.json` (global) or `.gemini/settings.json` in your project root:

```json
{
  "mcpServers": {
    "glassypic": {
      "command": "npx",
      "args": ["-y", "@glassypic/mcp-server@latest"]
    }
  }
}
```

Verify the server is connected with `/mcp list` inside Gemini CLI.

## Verification

After adding the configuration, restart your MCP client and verify the server is working by asking your AI assistant:

> "Optimize this image: /path/to/your/photo.jpg"

The `optimize_image` tool should appear in the available tools list.

## What It Does

The server exposes an `optimize_image` tool plus four account management tools.

`optimize_image`:
- **Compresses** images using smart lossy compression (typically 60-80% size reduction)
- **Generates SEO metadata** (alt text, keywords, filename) using AI
- **Converts formats** (JPG, PNG, WebP, AVIF, GIF, SVG, ICO)
- **Resizes** to specific dimensions
- **Upscales** using AI (2x or 4x)
- **Animated GIFs** supported (processed frame-by-frame)
- Accepts **local files** or **remote URLs**
- Saves next to the original using the SEO filename when one is generated, otherwise a `.polished` suffix

## Credits

Credits: 3 to compress (always), +1 if width or height is set, +2 to upscale, +1 for SEO tags (on by default). A full pipeline is 7 credits. Upscale is charged whether you request it or the server adds it automatically — it does so whenever a resize target exceeds the source by more than 1.2x, so a resize-only call on a small image also costs 7, not 5. SVG or ICO output is a flat 1 credit, overriding everything above.
Animated GIFs: per-frame cost × number of frames processed (up to gif_frame_limit, default 100).
Allowances vary by plan; use the `status` tool for your live balance.
Need more? Use the `upgrade` tool or visit https://glassypic.com/pricing

## Account Management

Four additional tools are available for account management:

| Tool | Description |
|------|-------------|
| `login` | Log in via browser (Google, Facebook, or email). Shared credits with web app. |
| `logout` | Log out and revert to guest session. |
| `status` | Check login state, tier, credits remaining, and reset time. |
| `upgrade` | Open the pricing page in the browser to review or change the account's plan. |

Recommended usage: call `status` before batch processing to verify sufficient credits.
