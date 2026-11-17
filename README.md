```
 _   _           _
| | | | __ _ ___| |_ ___
| |_| |/ _` / __| __/ _ \
|  _  | (_| \__ \ ||  __/
|_| |_|\__,_|___/\__\___|

Cloudflare Workers Edition
```

> Original [haste-server](https://github.com/seejohnrun/haste-server) by John Crepezzi, modernized for Cloudflare's edge network.

A pastebin that runs on Cloudflare Workers. [Demo](https://haste.sigman78.workers.dev/)

## Why this fork

The original runs on Node.js + Redis. This version drops both: Workers replace the server, D1 (SQLite at the edge) replaces Redis. No cold starts, global distribution, fits in the free tier for personal use.

Rewritten in TypeScript with Vite, no jQuery.

## Quick start

```bash
pnpm install
pnpm db:migrate:local
pnpm dev          # http://localhost:8787
```

## Deploy

```bash
pnpm exec wrangler d1 create haste-db   # copy the database_id into wrangler.toml
pnpm db:migrate:remote
pnpm run deploy   # "pnpm deploy" is a built-in pnpm command
```

Your instance will be live at `https://haste.YOUR-SUBDOMAIN.workers.dev`.

## Config

Edit `wrangler.toml` vars:

| Variable                | Default       | Description                                                    |
| ----------------------- | ------------- | -------------------------------------------------------------- |
| `MAX_PASTE_SIZE`        | 400000        | Max paste size in bytes                                        |
| `KEY_LENGTH`            | 10            | Length of paste IDs                                            |
| `KEY_STRATEGY`          | pronounceable | Paste ID format: `pronounceable`, URL-safe `random`, or `uuid` |
| `DEFAULT_EXPIRE_DAYS`   | 30            | Days until expiration                                          |
| `BROWSER_CACHE_MAX_AGE` | 0             | Browser cache for API reads, seconds, capped at paste expiry   |
| `SERVER_RENDER`         | false         | Render paste pages on the worker (see below)                   |

`KEY_LENGTH` applies to `pronounceable` and `random` IDs. Random IDs carry six bits of
entropy per character; UUID IDs use `crypto.randomUUID()` and ignore `KEY_LENGTH`.
Creation and read limits are configured by the two `ratelimits` bindings in `wrangler.toml`.

With `SERVER_RENDER` on, a paste URL (`/key` or `/key.ext`) comes back with the paste already in
the page: the text is visible at first paint and the client skips the `/documents` fetch. The
worker does not highlight; the URL extension still picks the language in the browser. Any
failure (missing paste, rate limit, storage error) serves the plain page, which is exactly the
client-rendered path you get with the flag off.

## API

```bash
curl -X POST https://your-worker.dev/documents -H "Content-Type: text/plain" -d "code here"
curl https://your-worker.dev/documents/KEY
curl https://your-worker.dev/raw/KEY
```

- `POST /documents` takes `text/plain` or JSON `{"content": "..."}` and returns `201 {"key"}`;
  `413` when over `MAX_PASTE_SIZE`.
- `GET /documents/KEY` returns `{"key", "content", "createdAt", "expiresAt"}` (ISO 8601, `null`
  for none) with an `ETag`; `If-None-Match` gets `304`.
- `GET /raw/KEY` returns the text as `text/plain`.
- Built-in pages such as `about` work on both and carry `"frozen": true`.
- Other methods on these routes return `405` with an `Allow` header.

## Command palette

Press **Ctrl+/** (or click the h-bar pill in the top-right corner) to open the command
palette. Type to filter commands, then press Enter.

| Query   | Does                                                |
| ------- | --------------------------------------------------- |
| `save`  | Fuzzy-filter commands (save, new, copy link, ...)   |
| `:42`   | Go to line 42                                       |
| `?text` | Find text in the paste; Enter / Shift+Enter to step |

It also switches the highlighting language and lists recent pastes kept in this browser.

## Shortcuts

| Action            | Windows / Linux     | Mac                 |
| ----------------- | ------------------- | ------------------- |
| Command palette   | Ctrl+/              | Ctrl+/              |
| Save              | Ctrl+S / Ctrl+Enter | Cmd+S / Cmd+Enter   |
| New paste         | Alt+Shift+P         | Opt+Shift+P         |
| Duplicate & edit  | Alt+Shift+D         | Opt+Shift+D         |
| Copy link         | Alt+Shift+C         | Opt+Shift+C         |
| View raw          | Alt+Shift+R         | Opt+Shift+R         |
| Find in paste     | Alt+Shift+F         | Opt+Shift+F         |
| Go to line        | Alt+Shift+G         | Opt+Shift+G         |
| Switch language   | Alt+Shift+L         | Opt+Shift+L         |
| Recent pastes     | Alt+Shift+H         | Opt+Shift+H         |
| Zoom in/out/reset | Alt+Shift+= / - / 0 | Opt+Shift+= / - / 0 |
| Share on X        | Alt+Shift+X         | Opt+Shift+X         |

Alt+Shift (Opt+Shift on Mac) is the same physical chord everywhere and is left alone by
browsers, except Chrome's Alt+Shift+I/A/N/T, which are not used. Keys match the physical key,
so they work on any layout, and a key only does something while its command is available.

## Niceties

- **Draft autosave** — unsaved text is kept in localStorage and restored on your next visit
- **Copy link** — Alt+Shift+C (or the palette) copies the paste URL to the clipboard
- **Raw view** — open the plain-text version of any paste in a new tab
- **Nightly cleanup** — a cron trigger purges expired pastes automatically

## Tests

```bash
pnpm test          # unit tests (jest)
pnpm test:e2e      # browser tests (playwright)
pnpm test:api      # API integration tests (needs `pnpm dev` running)
```

## License

MIT. Original Haste by [John Crepezzi](https://github.com/seejohnrun).
