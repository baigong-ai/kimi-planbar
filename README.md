# kimi-planbar

[中文](README_CN.md)

Plan-quota display for [Kimi Code](https://www.kimi.com/code/) CLI: a **TUI statusline** plus a **web-UI quota badge**, so Kimi For Coding users can always see how much of their plan is left.

> This project is based on [cc-planbar](https://github.com/baigong-ai/cc-planbar) (a quota statusline for Claude Code). The provider detection, quota-endpoint logic, color thresholds, and caching design are adapted from it; kimi-planbar ports the idea to Kimi Code's own extension points.

Shows: **context window usage % + plan quota** (5-hour window / weekly limit, with reset times), color-coded by usage: green <60%, yellow 60–84%, red ≥85%.

TUI statusline:

```
k3-256k | Ctx 24.0% | Kimi 5h 15% (rst 03:44) · week 69% (rst 07/31 05:44) | ~/code/proj | main
```

Web UI: a floating badge in the top-right corner — `5h 15% (rst 03:44) · week 69% (rst 07/31 05:44)`, click to refresh.

## Why

Kimi Code has no built-in persistent quota display: the TUI only shows quota on demand via `/usage`, and the web UI (opened with `/web` or `kimi web`) doesn't call the quota endpoint at all. kimi-planbar fills both gaps.

## Files

| file | what it is | install to |
|---|---|---|
| `quota-status.py` | TUI statusline command (zero dependencies, stdlib only) | `~/.kimi-code/scripts/quota-status.py` |
| `kimi-web-quota.user.js` | Tampermonkey userscript for the web UI | install via the Tampermonkey browser extension |

## Part 1: TUI statusline

Kimi Code's `[status_line].command` (in `tui.toml`) replaces the first footer line with a custom command's output. The catch: runs are **capped at 300ms**, so a synchronous network call is not an option. `quota-status.py` therefore renders from a local cache only, and spawns a detached background refresher (network fetch + atomic cache replace) whenever the cache is stale. The footer is never slowed down by the network; on errors the last good value stays visible.

### Install

```bash
mkdir -p ~/.kimi-code/scripts
cp quota-status.py ~/.kimi-code/scripts/
chmod +x ~/.kimi-code/scripts/quota-status.py
```

Then add to `~/.kimi-code/tui.toml`:

```toml
[status_line]
command = "~/.kimi-code/scripts/quota-status.py"
```

Run `/reload-tui` in the TUI (or restart Kimi Code) to apply.

### How it gets credentials

No configuration needed. The refresher reads, in order:

1. the OAuth access token at `~/.kimi-code/credentials/kimi-code.json` (kept fresh by the running CLI), then
2. a plain `api_key` from the Kimi provider in `~/.kimi-code/config.toml`

and calls `GET https://api.kimi.com/coding/v1/usages` with it.

### Details

- Cache: `~/.kimi-code/scripts/quota-cache`, TTL 5 minutes; failed refreshes retry after 30s
- The last stdin snapshot Kimi Code passed in is kept at `~/.kimi-code/scripts/last-stdin.json` for debugging
- Monthly quota: shown automatically as `month X%` when the `totalQuota` field is populated
- To change color thresholds: edit the `col()` function in `quota-status.py`

## Part 2: Web-UI quota badge

The web UI served by `kimi web` exposes `GET /api/v1/oauth/usage` (same data as TUI `/usage`) but never renders it. `kimi-web-quota.user.js` is a Tampermonkey userscript that injects a floating quota badge into the page.

### How it works

- Reads the bearer token the web UI itself stored in `localStorage` (`kimi-web.server-credential`)
- Calls the same-origin `/api/v1/oauth/usage` every 60s
- Renders a pill badge at the top-right; green/yellow/red by the same thresholds; click to refresh immediately
- Does nothing on pages without the credential, so other local sites are unaffected

### Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Open `kimi-web-quota.user.js` in the browser (drag the file into a browser window) — Tampermonkey will offer to install it; or create a new script in the Tampermonkey dashboard and paste the file content
3. Open the Kimi Code web UI (`/web` in the TUI, or `kimi web`) — the badge appears in the top-right corner

### Caveats

- The script relies on two web-UI internals: the `kimi-web.server-credential` localStorage key and the `/api/v1/oauth/usage` endpoint. If a future Kimi Code version changes either, the badge shows `quota ?` — updating the script should fix it
- Badge position: edit `top:8px; right:12px` in the script if it overlaps other UI
- Kimi Code binds to 127.0.0.1 by default; the userscript matches `http://127.0.0.1/*` and `http://localhost/*`, any port

## Scope

- Kimi For Coding plans only (the `api.kimi.com/coding` provider). For Claude Code with Kimi/GLM providers, see [cc-planbar](https://github.com/baigong-ai/cc-planbar)
- The statusline script requires Python 3 (stdlib only; 3.11+ recommended for the most tolerant ISO timestamp parsing)

## Acknowledgments

- [cc-planbar](https://github.com/baigong-ai/cc-planbar) — the project this is based on: quota endpoints, provider logic, color scheme, and caching design
- [Kimi Code](https://www.kimi.com/code/) — `[status_line].command` extension point and the local server's `/api/v1/oauth/usage` endpoint

## License

MIT
