# Setup and configuration

## Local development

```bash
pnpm install
pnpm db:migrate:local
pnpm dev          # http://localhost:8787
```

Secrets for `wrangler dev` (such as the [sign-in](sign-in.md) settings) go in `.dev.vars`.

## Deploy

```bash
pnpm exec wrangler d1 create haste-db   # copy the database_id into wrangler.toml
pnpm db:migrate:remote
pnpm run deploy   # "pnpm deploy" is a built-in pnpm command
```

The instance is live at `https://planck-bin.YOUR-SUBDOMAIN.workers.dev`.

When upgrading, apply new migrations (`pnpm db:migrate:remote`) before deploying the worker: the
code reads columns that older databases do not have yet.

## Settings

Edit the `[vars]` in `wrangler.toml`:

| Variable                | Default       | Description                                                    |
| ----------------------- | ------------- | -------------------------------------------------------------- |
| `MAX_PASTE_SIZE`        | 400000        | Max paste size in bytes                                        |
| `KEY_LENGTH`            | 10            | Length of paste IDs                                            |
| `KEY_STRATEGY`          | pronounceable | Paste ID format: `pronounceable`, URL-safe `random`, or `uuid` |
| `DEFAULT_EXPIRE_DAYS`   | 30            | Days until expiration when the client picks no lifetime        |
| `MAX_EXPIRE_DAYS`       | 0             | Cap on any lifetime, including permanent; 0 = no cap           |
| `BROWSER_CACHE_MAX_AGE` | 0             | Browser cache for API reads, seconds, capped at paste expiry   |
| `SERVER_RENDER`         | false         | Render paste pages on the worker (see below)                   |
| `COUNT_VIEWS`           | false         | Count paste views in D1 (costs one database write per read)    |
| `MAX_STORAGE_MB`        | 0             | Refuse new pastes (`507`) once the database is this big; 0 off |

`KEY_LENGTH` applies to `pronounceable` and `random` IDs. Random IDs carry six bits of entropy per
character; UUID IDs use `crypto.randomUUID()` and ignore `KEY_LENGTH`.

Numeric settings are clamped to safe ranges: `MAX_PASTE_SIZE` 1 to 1,900,000 (under D1's 2 MB row
limit), `KEY_LENGTH` 6 to 48, `DEFAULT_EXPIRE_DAYS` and `MAX_EXPIRE_DAYS` 0 to 36,500, and
`BROWSER_CACHE_MAX_AGE` 0 to one year. A value that is not a plain integer falls back to the default.

Expired pastes are deleted by a nightly cron. They return `404` before that.

## Rate limits

Creation and read limits are the two `ratelimits` bindings in `wrangler.toml`.

## Storage cap

`MAX_STORAGE_MB` is a coarse safety valve, not a quota:

- It compares the D1 database file size (`meta.size_after`), not the space live rows use. Space
  freed by deleting expired pastes only counts once the file shrinks. Production D1 reclaims it,
  but a local `wrangler dev` database may not, so the budget can stay "full" after cleanup.
- It is global. One client at the creation rate limit (30/min of up to `MAX_PASTE_SIZE` each,
  roughly 12 MB/min at the default) can fill a small budget in minutes. Then every user gets
  `507` until the cleanup cron deletes enough expired pastes, which with the default 30-day
  expiry can take weeks. Size the budget well above the expected churn, or pair it with a
  shorter `DEFAULT_EXPIRE_DAYS`. Permanent pastes never free space; set `MAX_EXPIRE_DAYS` on a
  public instance to keep every paste expiring.
- `507` is a WebDAV status, so generic haste clients show it as an unknown error.

## Server rendering

With `SERVER_RENDER` on, a paste URL (`/key` or `/key.ext`) comes back with the paste already in
the page: the text is visible at first paint and the client skips the `/documents` fetch. The
worker does not highlight; the URL extension still picks the language in the browser. A paste
that does not exist gets a `404` page the client recognizes, so it shows "not found" without a
second lookup. Any other failure (rate limit, storage error, a paste over 128 KB) serves the plain
page, the same as with the flag off.
