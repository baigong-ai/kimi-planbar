# kimi-planbar

[中文](README_CN.md)

Plan-quota display for [Kimi Code](https://www.kimi.com/code/) CLI: a **TUI statusline** plus a **web-UI quota badge**, so Kimi For Coding users can always see how much of their plan is left.

> This project is based on [cc-planbar](https://github.com/baigong-ai/cc-planbar) (a quota statusline for Claude Code). The provider detection, quota-endpoint logic, color thresholds, and caching design are adapted from it; kimi-planbar ports the idea to Kimi Code's own extension points.

Shows: **permission mode (manual/auto/yolo) + model + thinking effort + plan quota** (5-hour window / weekly limit, with reset times). The mode is color-coded by risk (manual green / auto yellow / yolo red); quota is color-coded by usage: green <60%, yellow 60–84%, red ≥85%.

TUI statusline:

```
auto | K3-256k | high | 5h 15% (rst 03:44) · week 69% (rst 07/31 05:44) | ~/code/proj | main
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

**Windows note:** `~` is not expanded and `.py` files aren't directly executable there — use an absolute path with an explicit `python` prefix:

```toml
[status_line]
command = "python C:/Users/<you>/.kimi-code/scripts/quota-status.py"
```

### How it gets credentials

No configuration needed. The refresher reads, in order:

1. the OAuth access token at `~/.kimi-code/credentials/kimi-code.json` (kept fresh by the running CLI), then
2. a plain `api_key` from the Kimi provider in `~/.kimi-code/config.toml`

and calls `GET https://api.kimi.com/coding/v1/usages` with it.

### Details

- Segments, left to right: permission mode (snapshot `permissionMode`, reflects in-session switches live) → model → thinking effort → quota → cwd → git branch (snapshot `gitBranch`)
- The thinking effort is not in the stdin snapshot; the script reads it from `~/.kimi-code/config.toml` `[thinking]`: `effort`, falling back to the current model's `default_effort`; shows `off` when `enabled = false`. Note this reflects the config file — transient in-session changes that aren't written back won't show
- Cache: `~/.kimi-code/scripts/quota-cache`, TTL 5 minutes; failed refreshes retry after 30s
- To debug the snapshot schema: set `QUOTA_DEBUG=1` and the script writes the last stdin snapshot to `~/.kimi-code/scripts/last-stdin.json` (off by default, to avoid a disk write per second)
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
- Badge position: the badge auto-anchors just left of the chat header's right-side button cluster (git/PR pills, or the Files button added by UI patches), recomputed live as those buttons appear/disappear; on pages without a chat header it falls back to the top-right corner. To force a different spot, edit `placeBadge()` in the script
- Kimi Code binds to 127.0.0.1 by default; the userscript matches `http://127.0.0.1/*` and `http://localhost/*`, any port

## Known upstream issue: Kimi Code rewrites `tui.toml`

Not something kimi-planbar can fix, but it directly affects the statusline — flagged here for awareness (reported by [@shawn-0106t](https://github.com/shawn-0106t) in issue #1, 100% reproducible on Kimi Code 0.31.1):

**Symptom**: switching themes via `/theme`, or the first launch after a Kimi Code upgrade, rewrites `tui.toml` to the default template, silently dropping the `[status_line]` config. The tricky part: the current window keeps rendering from the in-memory config, so the loss only surfaces on the next `/reload-tui` or restart — hard to attribute.

**What to do**:

1. Don't use `/theme` to change themes — edit `theme = "..."` in `tui.toml` manually, then `/reload-tui`
2. After every Kimi Code upgrade, check that `[status_line]` is still in `tui.toml`
3. If it's gone, restore it with one command, then `/reload-tui`:

```bash
printf '\n[status_line]\ncommand = "~/.kimi-code/scripts/quota-status.py"\n' >> ~/.kimi-code/tui.toml
```

On Windows, use the Windows command form from the install section instead. The userscript badge is unaffected — it doesn't read `tui.toml`.

## Changelog

### v1.1.5

- **Userscript**: the badge no longer covers the chat header's own buttons. It used to sit at a hardcoded `top:8px; right:12px` with z-index 99999 — exactly where the header's right-side cluster renders (git/PR pills on the stock UI; the Files panel button on patched UIs such as kimi-web-files), painting over those buttons and making them unclickable. The badge now measures the header's right-side cluster and anchors itself just left of it, recomputed live (MutationObserver + resize, rAF-throttled) as buttons appear/disappear, and vertically centered within the header. Pages without a chat header keep the original top-right corner fallback

### v1.1.4

- **Userscript**: adapted to Kimi Code v0.32 — v0.32 enforces bearer auth on every REST route (including `/api/v1/oauth/usage`), accepting only the server token printed at startup as a `#token=` URL; credentials stored by v0.31 are rejected with 401 and the badge showed `quota ?`. Fix: credentials are now read from both localStorage and sessionStorage, `expiresAt` is respected (expired = absent), and a 401/403 retries with the credential from the other store
- **If the badge shows `quota ?` after upgrading to v0.32**: re-open the web UI once via `/web` (or log in again on the auth page) — the frontend stores the new server credential in browser storage and the badge recovers

### v1.1.3

- **Userscript**: fixed light-mode contrast — the palette was hardcoded for dark pages (translucent black pill + light text), so on light pages the pill rendered mid-grey and the light text washed out (~1.9:1 contrast). The badge now picks a light/dark palette from the computed body background luminance on every refresh (4.7–14:1 for meaningful text in light mode), following theme toggles live

### v1.1.2

Four robustness hardening items, again suggested by [@shawn-0106t](https://github.com/shawn-0106t) in issue #1:

- **TUI script**: the 5-hour window is no longer assumed to be `limits[0]` — it's matched by `window.duration=300 + timeUnit=TIME_UNIT_MINUTE` (falling back to the first window only when no match), so reordering or additional windows won't show wrong data
- **TUI script**: the `last-stdin.json` debug snapshot is no longer written on every render (the statusline renders once per second — that was a disk write per second); opt in with `QUOTA_DEBUG=1` when debugging
- **Userscript**: API data now renders via DOM nodes + `textContent` instead of `innerHTML` string building — injection-proof by construction
- **Userscript**: the bearer token is re-read from `localStorage` before every refresh, so credential rotation no longer requires a page reload

### v1.1.1

Windows fixes, from a tested report by [@shawn-0106t](https://github.com/shawn-0106t) (issue #1):

- **Fixed**: render path blowing the 300ms cap — Python startup alone is slow on Windows, and the top-level `urllib.request` / `subprocess` imports pushed a full render past the cap; both imports are now deferred into the background-refresh path, bringing renders down to 150–210ms
- **Fixed**: `UnicodeEncodeError` — the snapshot's `cwd` can contain lone surrogates (a CLI-side encoding bug for non-ASCII paths), crashing `print()` on every render; stdout is now reconfigured to UTF-8 with `errors='replace'` before rendering (also fixes the `·` separator being garbled by Windows' locale codepage pipes)
- **Docs**: Windows install note — the command needs an absolute path with an explicit `python` prefix (`~` isn't expanded, `.py` isn't executable)
- The snapshot-schema part of the report (`contextUsage` / `gitBranch`) was already fixed in v1.1.0 and is not re-merged

### v1.1.0

Why: v1.0.0 was written against an assumed stdin-snapshot schema. Installed on a real setup, the fields didn't match — `model` is a plain string, the git branch arrives as `gitBranch`, and context usage as `contextUsage` (a 0–1 fraction) — so the Ctx and branch segments silently vanished. While fixing the schema, the statusline was redesigned into a more practical layout based on real use.

What changed:

- **Fixed**: field parsing adapted to the real snapshot schema (`gitBranch`, string `model`)
- **Added**: permission-mode segment, pinned to the front, from the snapshot `permissionMode` — `manual` green / `auto` yellow / `yolo` red; in-session mode switches show up live
- **Added**: thinking-effort segment. The snapshot doesn't carry it, so the script reads `~/.kimi-code/config.toml` `[thinking]` instead (`effort`, falling back to the current model's `default_effort`; `off` when `enabled = false`)
- **Removed**: the Ctx percentage segment (to keep the line short); the `Kimi` prefix on the quota segment

New layout: `auto | K3-256k | high | 5h 15% (rst 03:44) · week 69% (rst 07/31 05:44) | ~/code/proj | main`

### v1.0.0

Initial release: TUI statusline (cache + background refresh) and the web-UI Tampermonkey badge.

## Scope

- Kimi For Coding plans only (the `api.kimi.com/coding` provider). For Claude Code with Kimi/GLM providers, see [cc-planbar](https://github.com/baigong-ai/cc-planbar)
- The statusline script requires Python 3 (stdlib only; 3.11+ recommended for the most tolerant ISO timestamp parsing)

## Acknowledgments

- [cc-planbar](https://github.com/baigong-ai/cc-planbar) — the project this is based on: quota endpoints, provider logic, color scheme, and caching design
- [Kimi Code](https://www.kimi.com/code/) — `[status_line].command` extension point and the local server's `/api/v1/oauth/usage` endpoint
- [@shawn-0106t](https://github.com/shawn-0106t) — tested Windows report and fixes (v1.1.1) and four robustness suggestions (v1.1.2)

## License

MIT
