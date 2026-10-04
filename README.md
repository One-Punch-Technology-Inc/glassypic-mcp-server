# @glassypic/mcp-server

[![AgentHub 已收录：glassypic](https://myagenthub.cn/badge/io.github.onepunchtechnology/glassypic)](https://myagenthub.cn/p/io.github.onepunchtechnology/glassypic)
[![npm version](https://img.shields.io/npm/v/@glassypic/mcp-server.svg)](https://www.npmjs.com/package/@glassypic/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-brightgreen.svg)](https://modelcontextprotocol.io)

MCP server for [GlassyPic](https://glassypic.com). One tool that turns raw images into production-ready assets: upscaling, resizing and cropping, compression, file format conversion, and SEO filename and alt text generation. Describe the outcome you want in natural language.

## Quick Start

Add to your MCP client config:

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

No signup required. Works out of the box with 20 free daily credits.

> **Windows users:** If the server doesn't appear after editing a JSON config, your client likely can't resolve `npx` from PATH (a common, silent failure). Wrap the command with `cmd /c`:
>
> ```json
> {
>   "mcpServers": {
>     "glassypic": {
>       "command": "cmd",
>       "args": ["/c", "npx", "-y", "@glassypic/mcp-server@latest"]
>     }
>   }
> }
> ```
>
> This applies to the hand-edited JSON configs below (Claude Desktop, Cursor, Windsurf, Cline). The CLI commands (Claude Code, Gemini CLI, Codex CLI) are unaffected.

### Client-Specific Setup

<details>
<summary><strong>Claude Desktop</strong></summary>

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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
</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add glassypic -- npx -y @glassypic/mcp-server@latest
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json` in your project root:

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
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Edit `~/.codeium/windsurf/mcp_config.json`:

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
</details>

<details>
<summary><strong>Smithery</strong></summary>
Install via Smithery: [![smithery badge](https://smithery.ai/badge/glassypic/mcp-server)](https://smithery.ai/servers/glassypic/mcp-server)
</details>

<details>
<summary><strong>Cline</strong></summary>

Open Cline settings → MCP Servers → Add, then paste:

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
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

```bash
gemini mcp add --transport stdio glassypic npx -y @glassypic/mcp-server@latest
```

Or edit `~/.gemini/settings.json` (global) or `.gemini/settings.json` in your project root:

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

Verify it's running inside Gemini CLI with `/mcp list`.
</details>

<details>
<summary><strong>OpenAI Codex CLI</strong></summary>

```bash
codex mcp add glassypic -- npx -y @glassypic/mcp-server@latest
```

Or edit `~/.codex/config.toml` manually:

```toml
[mcp_servers.glassypic]
command = "npx"
args = ["-y", "@glassypic/mcp-server@latest"]
```
</details>

## Tool: `optimize_image`

One tool that turns a supplied image into a production-ready asset through a fixed server-side pipeline (typically 60-80% size reduction), with optional resize, upscale, format conversion, and SEO metadata generation. Inputs include JPEG, PNG, WebP, AVIF, GIF, SVG, ICO, HEIC, TIFF, and BMP. Outputs are JPEG, PNG, WebP, AVIF, GIF, SVG, and ICO. Accepts absolute local file paths or remote URLs.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `input` | string | Yes | — | Absolute local file path or remote URL |
| `output_path` | string | No | auto | File path or directory (ending in `/`). If omitted: saves next to the original, using the SEO slug when one is generated, otherwise a `.polished` suffix |
| `output_format` | string | No | original | `jpg`, `png`, `webp`, `avif`, `gif`, `svg`, `ico`, or `original` |
| `output_width_px` | int | No | — | Target width in pixels |
| `output_height_px` | int | No | — | Target height in pixels |
| `output_upscale_factor` | int | No | — | AI upscale factor: `2` (2×) or `4` (4×) |
| `output_resize_behavior` | string | No | pad | `pad` (white padding) or `crop` (smart crop). Only used when both width and height are set |
| `output_seo_tag_gen` | bool | No | true | Generate SEO metadata and rename file to SEO slug. Costs 1 extra credit |
| `output_file_size_limit` | int | No | — | Target maximum output file size in bytes. Server attempts to meet this via additional compression. Not guaranteed |
| `gif_frame_limit` | int | No | 100 | Max frames to process for animated GIFs (1–100). Reduces credit cost by sampling fewer frames |
| `confirm_gif_cost` | bool | No | — | Set to `true` to proceed after reviewing the animated GIF cost warning. Required for animated GIFs |

### Resize Behavior

| Dimensions provided | Behavior | `output_resize_behavior` |
|---|---|---|
| Width only | Proportional scale | N/A |
| Height only | Proportional scale | N/A |
| Width + Height | Exact dimensions, white padding | `pad` (default) |
| Width + Height | Exact dimensions, smart crop | `crop` |

### Examples

**Basic compression** — just compress, keep format and dimensions:

```json
{ "input": "/Users/me/photos/hero.png" }
```

**Convert to WebP:**

```json
{ "input": "/Users/me/hero.png", "output_format": "webp" }
```

**Resize proportionally** — set one dimension, the other scales:

```json
{ "input": "/Users/me/hero.png", "output_width_px": 1200 }
```

**Exact dimensions with padding** — white bars fill the gap:

```json
{ "input": "/Users/me/hero.png", "output_width_px": 1080, "output_height_px": 1080 }
```

**Exact dimensions with smart crop:**

```json
{ "input": "/Users/me/hero.png", "output_width_px": 1080, "output_height_px": 1080, "output_resize_behavior": "crop" }
```

**AI upscale 4x:**

```json
{ "input": "/Users/me/icon.png", "output_upscale_factor": 4 }
```

**From URL, save to directory:**

```json
{ "input": "https://example.com/photo.jpg", "output_path": "/Users/me/assets/" }
```

**Skip SEO to save 1 credit:**

```json
{ "input": "/Users/me/hero.png", "output_seo_tag_gen": false }
```

### Output

Returns a text summary and structured metadata:

```
Optimized: /Users/me/photos/modern-office-workspace.webp
Size: 142.3 KB
Compression: 73%
Format: webp
Dimensions: 1920x1080
Alt text: Modern office workspace with laptop and coffee cup on wooden desk
```

**Structured output fields:**

```json
{
  "output_path": "/Users/me/photos/modern-office-workspace.webp",
  "output_size_bytes": 145715,
  "output_width_px": 1920,
  "output_height_px": 1080,
  "output_format": "webp",
  "compression_ratio": 0.27,
  "seo_alt_text": "Modern office workspace with laptop and coffee cup on wooden desk",
  "seo_keywords": ["office", "workspace", "laptop", "desk", "modern"],
  "seo_filename": "modern-office-workspace"
}
```

## Supported Formats

| Format | Input | Output | Notes |
|--------|-------|--------|-------|
| JPG | Yes | Yes | |
| PNG | Yes | Yes | |
| WebP | Yes | Yes | |
| AVIF | Yes | Yes | |
| GIF | Yes | Yes | Animated GIFs preserved when output is GIF |
| SVG | Yes | Yes | SVG→SVG optimized via SVGO; raster↔SVG conversion supported |
| ICO | Yes | Yes | Smart rebuild: generates 16, 24, 32, 48, 256px favicon set |
| HEIC/HEIF | Yes* | No | Auto-converted to JPG at upload |
| TIFF | Yes* | No | Auto-converted to JPG at upload |
| BMP | Yes* | No | Auto-converted to JPG at upload |

GlassyPic supports high-quality conversion between any input and output format combination.
Converting an animated GIF to a non-GIF format (JPG, PNG, WebP, AVIF) preserves only the first frame.
Converting an animated GIF to a GIF format supports upscaling/resizing while preserving the animation and quality. You may also reduce animated GIF file size by decreasing the number of output frames.

Max upload file size: 50 MB.

### SVG & ICO Examples

```
# Optimize an SVG file (keeps as vector)
Optimize logo.svg and keep it as SVG

# Convert SVG to raster
Convert icon.svg to a 512x512 PNG

# Trace raster to vector SVG
Convert my logo.png to a vector SVG

# Generate favicon set from any image
Convert logo.png to an ICO favicon

# Generate single-size ICO
Convert logo.png to a 32x32 ICO

# Extract largest icon from ICO
Convert favicon.ico to PNG
```

## How It Works

```
Local file or URL
  → Upload to GlassyPic API
    → Optional AI upscale (explicit, or automatic when a resize target exceeds the source by more than 1.2×)
    → Optional resize
    → Compression
    → Optional SEO metadata
  → Download optimized file
    → Save with the SEO filename slug, or a `.polished` suffix when SEO is off or returns no slug
```

All processing happens server-side via the [GlassyPic API](https://api.glassypic.com). The MCP server is a thin client that orchestrates the pipeline.

## Credits

| | Guest | Free | Pro | Max |
|---|---|---|---|---|
| Credits/day or month | 20/day | 30/day | 3,300/month | 12,000/month |
| Images/day (default settings) | ~5 | ~7 | ~825 | ~3,000 |
| Cost per image | 4 credits (compress + SEO tags, defaults) | same | same | same |
| Signup required | No | Free signup | Paid | Paid |

Session data is stored locally at `~/.glassypic/session.json` and persists across invocations. 

### Automatic upscaling

When a resize target exceeds the source image by more than 1.2×, GlassyPic
automatically runs an AI upscale before resizing, so enlargements ship sharp
instead of blurred. This happens without `output_upscale_factor` being set and
**adds 2 credits**.

A resize-only call therefore costs the same as a full pipeline when the source is
smaller than the target:

| Call | Credits |
|---|---|
| Compress only, no SEO tags | 3 |
| Compress + SEO tags (defaults) | 4 |
| Resize down + SEO tags | 5 |
| Resize up past 1.2× + SEO tags | 7 |
| Compress + resize + explicit upscale + tags | 7 |
| SVG or ICO output | 1 (flat, overrides the above) |

Animated GIFs are billed per frame — see the `confirm_gif_cost` parameter.

## Account & Credits

Log in to unlock more credits and share them across the web app and MCP server:

```
Use the login tool to sign in.
Use the status tool to check your current credits.
Use the upgrade tool to open the pricing page.
Use the logout tool to sign out.
```

### login

Opens a browser window to complete login (Google, Facebook, or email/magic link). After approval, your account is linked and credits are shared with the web app.

```
Login complete: user@example.com (Pro tier, 3,150 of 3,300 credits remaining)
```

### status

Check your current account status and credits before batch processing:

```
Logged in as user@example.com (Pro tier)
Credits: 3,150 of 3,300 remaining
Resets: 03/01/2026, 12:00 AM PST
```

### logout

Revokes the session and reverts to guest mode (20 credits/day).

### upgrade

Opens [glassypic.com/pricing](https://glassypic.com/pricing) in your browser.

## Tips for AI Agents

Paste this into your `CLAUDE.md` or system prompt to help agents use the tool effectively:

```
## GlassyPic MCP

Tools: optimize_image, login, logout, status, upgrade

- Use status to check credits before batch processing
- Credits: 3 to compress (always), +1 if width/height is set, +2 to upscale, +1 for SEO tags (default). A full pipeline is 7 credits. SVG/ICO output is a flat 1 credit.
- Resizing up past 1.2x the source triggers an automatic AI upscale (+2 credits) even without output_upscale_factor set — a resize-only call on a small image can cost 7, not 5.
- Guest: 20 credits/day. Free account: 30/day. Pro: 3,300/month.
- Always use absolute file paths, not relative.
- Set only width OR height for proportional resize. Set both for exact dimensions.
- When both dimensions are set, use output_resize_behavior: "crop" for photos, "pad" for logos/icons.
- output_seo_tag_gen (default true) renames the file to an SEO slug and generates alt text + keywords.
- Set output_seo_tag_gen: false to save 1 credit when SEO metadata is not needed.
- GIF is supported for both input and output; animated GIFs stay animated when output_format is "gif".
- Converting an animated GIF to jpg/png/webp/avif preserves only the first frame.
- HEIC, TIFF, BMP inputs are auto-converted to JPG.
- For batch processing, call optimize_image once per file.
- If credits run out, use login to sign in or upgrade to open pricing.
```

## Troubleshooting

**Server not appearing in tool list:**
- Restart your MCP client after editing the config
- Ensure Node.js >= 18 is installed: `node --version`
- Try running directly: `npx -y @glassypic/mcp-server@latest` (should start without errors)
- **On Windows:** if the server silently never loads, wrap the command with `cmd /c` (`"command": "cmd"`, `"args": ["/c", "npx", "-y", "@glassypic/mcp-server@latest"]`) — see the Windows note under [Quick Start](#quick-start)

**"Insufficient credits" error:**
- Use the `status` tool to check remaining credits
- Use the `login` tool to sign in for more credits (free accounts get 30/day)
- Use the `upgrade` tool to open the pricing page and compare plans
- Disable SEO tags (`output_seo_tag_gen: false`) to save 1 credit; note that resizing up past 1.2× the source still adds an automatic 2-credit upscale regardless

**Login browser window doesn't open:**
- Open this URL manually: `https://glassypic.com/mcp/authorize` and enter the code shown in the terminal
- Ensure a browser is installed and accessible

**Session token issues:**
- Session data is stored at `~/.glassypic/session.json`
- Delete this file to reset and start fresh
- Use `logout` then `login` to re-authenticate

**File not found:**
- Use absolute paths for local files
- For URLs, ensure the image is publicly accessible

**Timeout errors:**
- Large images or AI upscaling can take 30-60 seconds
- The server has a 60-second timeout per job

## Privacy Policy

Full policy: **https://glassypic.com/privacy/**

**What is transmitted.** Images you optimize are uploaded to the GlassyPic API
(`https://api.glassypic.com`) for processing, along with your authentication
token. Images are retained according to your account tier and then deleted —
both the original upload and the processed version. See the policy for the
retention schedule.

When you pass a remote URL to the tool, the GlassyPic API fetches it server-side; the URL itself is sent to GlassyPic, and the request to the image host originates from GlassyPic's servers rather than from your machine.

**What is stored locally.** When you use the `login` tool, your access token and
account email are written to `~/.glassypic/session.json` with file mode `0600`
(owner read/write only). If you optimize an image *without* logging in, the
first upload mints a guest session token, which is written to that same file
so subsequent calls stay attached to the same guest session's credits — no
account, email, or personal information is attached to it. Running the
`logout` tool removes the file's token. See also
[Account & Credits](#account--credits) and [Troubleshooting](#troubleshooting).

**What is not collected.** When run as a local connector, this server sends no
telemetry and makes no network call other than to the GlassyPic API. (The
remote HTTP transport additionally calls Supabase for authentication.)

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GLASSYPIC_API_URL` | `https://api.glassypic.com` | API endpoint. Development and self-hosting only — most users never set it. |
| `TINIFY_API_URL` | — | Pre-rename alias for the above. Retained for existing deployments; `GLASSYPIC_API_URL` wins when both are set. |

The value must be an `https` URL. Plain `http` is accepted only for `localhost`
and `127.0.0.1`, because your images and `Bearer` token are sent to this host. An
invalid value produces a clear error naming the variable rather than a silent
request to the wrong endpoint.

## Requirements

- Node.js >= 18
- An MCP-compatible client (Claude Desktop, Claude Code, Cursor, Windsurf, Cline, OpenAI Codex CLI, Gemini CLI, etc.)

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md). Do not file a public issue for an unfixed security report.

## License

MIT - see [LICENSE](LICENSE).
