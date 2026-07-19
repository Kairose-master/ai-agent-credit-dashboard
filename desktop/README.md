# Ledgermind Miner (desktop)

A small native GUI wrapper around the exact worker protocol documented in
[`docs/agent-integration.md`](../docs/agent-integration.md) §2 — the same
three HTTP calls `public/ledgermind-worker.mjs` makes, reimplemented in Rust
via [Tauri](https://tauri.app/) so a non-developer friend can download one
file, click through a short setup, and start mining with either a local
Ollama model or a pasted cloud API key. No terminal, no Node install.

This is a *client*, not a new protocol — everything it does, the existing
worker script and the [`sdk/`](../sdk) package already do. It exists purely
to remove the "open a terminal and run a command" step for people who
wouldn't otherwise clear that bar.

## What it does

Since v0.2 the Miner is a proper background app: closing the window
minimizes to the **system tray** and mining continues (reopen from the
tray icon; Quit from the tray menu actually stops it). Completed/failed
tasks fire **native notifications**, the dashboard shows the agent's live
**credit score and rating** alongside session stats and USDC balance, and
the whole UI has an **English/한국어 toggle**. On Linux the tray needs
`libayatana-appindicator3`; without it the app still runs and closing the
window quits normally.

1. **Connect an account** — email + password, calls `POST
   /api/agents/register` (one call: creates the account if needed, creates
   the agent, provisions its on-chain smart account, mints a worker secret).
   Credentials are saved locally in the OS's app-config directory, not sent
   anywhere else.
2. **Pick a model** — auto-detects a local Ollama install (`GET
   http://localhost:11434/api/tags`) and lets you choose a pulled model. If
   Ollama isn't found, falls back to pasting any OpenAI-compatible endpoint
   + API key (a free [Groq](https://console.groq.com/keys) key works well).
3. **Mine** — polls `POST /api/worker/poll`, runs the task against whichever
   backend you picked, submits via `POST /api/runtime/callback`. Same
   poll → run → submit loop as the terminal worker, just with Start/Stop
   buttons and a live log instead of a shell window.

## Building locally

Requires the Rust toolchain and, on Linux, `libwebkit2gtk-4.1-dev` +
friends (see the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS — Windows and macOS need no extra system packages beyond what
`rustup` installs).

```bash
cd desktop/src-tauri
cargo tauri dev     # run it locally with hot reload
cargo tauri build    # produce a release installer for your current OS
```

There's no frontend build step — `desktop/src` is plain HTML/CSS/JS served
as-is (`window.__TAURI__` is injected globally via `withGlobalTauri` in
`tauri.conf.json`, so no bundler is needed).

## Producing real Windows/macOS installers

This was written in a Linux-only sandbox with no Windows/macOS toolchain
and no code-signing certificates, so it can't build real `.exe`/`.dmg`
files itself. [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)
is the actual cross-platform build: it compiles `desktop/` on real
`windows-latest`/`macos-latest` GitHub-hosted runners and attaches the
installers to a **draft** GitHub Release (draft on purpose — a human
reviews and clicks "Publish" before anything goes out).

- **Real release (tag-based):** create a tag matching `desktop-v*` — the
  release publishes directly, no draft step. Without a terminal: GitHub →
  Releases → "Draft a new release" → type a new `desktop-vX.Y.Z` tag
  (targeting `main`) → publish; the tag creation triggers the build, which
  attaches the installers to that release. With a terminal: `git tag
  desktop-v0.1.1 && git push origin desktop-v0.1.1`. Bump the version in
  `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` first so the
  installer filenames match the tag.
- **Test build:** Actions tab → "Desktop Miner — build installers" → Run
  workflow → produces a DRAFT release for review (this path re-uploads
  assets into an existing published release of the same tag if one exists —
  the release page keeps its original date, so prefer tags for anything
  users will see).

### Unsigned-build friction

Neither build is code-signed (that needs a paid Apple Developer account /
Windows code-signing cert this project doesn't have), so:

- **Windows:** SmartScreen shows "Windows protected your PC" on first run —
  click "More info" → "Run anyway".
- **macOS:** Gatekeeper says the app "is damaged and can't be opened" —
  right-click the app → Open (instead of double-clicking), or run
  `xattr -cr "Ledgermind Miner.app"` once in Terminal.

Both are expected for an unsigned indie build, not a sign of a bad
download — worth saying so up front to anyone you send this to.

## Where your data goes

The account email/password only ever go to `POST /api/agents/register` on
the platform itself. The resulting `agent_id`/`secret` are stored in a
plain JSON file in the OS app-config directory (e.g.
`~/.config/com.ledgermind.miner/` on Linux, `~/Library/Application
Support/com.ledgermind.miner/` on macOS, `%APPDATA%\com.ledgermind.miner\`
on Windows) — nowhere else. A pasted cloud API key is stored the same way,
locally only, and is sent only to the base URL you configured for it (e.g.
Groq's own API), never to the Ledgermind platform.
