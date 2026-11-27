# HTTP API

Compatible with haste-server, so [haste-client](https://github.com/seejohnrun/haste-client) works.

```bash
curl -X POST https://your-worker.dev/documents -H "Content-Type: text/plain" -d "code here"
curl https://your-worker.dev/documents/KEY
curl https://your-worker.dev/raw/KEY
curl --data-binary @secret.txt "https://your-worker.dev/documents?expires=3d&burn=1"
```

## Create

`POST /documents` takes `text/plain` or JSON `{"content": "..."}` and returns
`201 {"key", "expiresAt"}`; `413` when over `MAX_PASTE_SIZE`, `507` when the database has reached
`MAX_STORAGE_MB` (see [configuration](configuration.md)). Optional query parameters:

- `expires=3d|1w|1mo|6mo|never`: lifetime (default `DEFAULT_EXPIRE_DAYS`, capped by
  `MAX_EXPIRE_DAYS`). Other values return `400`.
- `burn=1`: burn after reading. The response then carries `"burn": true`.

## Read

- `GET /documents/KEY` returns `{"key", "content", "createdAt", "expiresAt"}` (ISO 8601, `null`
  for none) with an `ETag`; `If-None-Match` gets `304`.
- `GET /raw/KEY` returns the text as `text/plain`.
- Expired pastes return `404` on both, even before the cleanup cron removes them.
- Built-in pages such as `about` work on both and carry `"frozen": true`.
- Other methods on these routes return `405` with an `Allow` header.

## Burn after reading

A burn paste is deleted by its first `GET` on `/documents/KEY` or `/raw/KEY` (one atomic
`DELETE ... RETURNING`, so two readers never both get it). That response has `"burn": true` and
`Cache-Control: no-store`; later reads are `404`. `HEAD` and `GET /documents/KEY?peek=1` do not
consume it: the latter returns `{"key", "burnPending": true}` without content.

The page URL (`/KEY`) never reads it either: the page asks "Open and burn" first, and only that
answer reads it, so link previews and prefetchers cannot burn it. If that read fails, the paste is
left intact.

## Protected pastes

A protected paste is created with a JSON body `{"content", "lock": {"salt", "token"}}`: `content`
is already encrypted, `salt` (16 bytes) and `token` (32 bytes) are base64url. The response carries
`"locked": true`. The server stores the ciphertext, the salt and SHA-256 of the token.

- `GET /documents/KEY` returns `{"key", "locked": true, "salt"}` (plus `"burn": true` for a burn
  paste) without content. `GET /raw/KEY` returns `403`. The page URL embeds only that marker.
- `POST /documents/KEY/unlock` with `{"token"}` returns the stored document (still encrypted) for
  the right token: `403 {"message", "attemptsLeft"}` for a wrong one, `410` for the tenth wrong
  one, which deletes the paste. Attempts are counted before they are checked, so concurrent
  guesses cannot exceed the cap; a right token is not counted. A protected burn paste is deleted
  by its unlock, not by `GET`. Unlocks spend a read rate-limit token.

The web client derives a key from the passphrase with PBKDF2-SHA256 (600,000 iterations, random
salt) and splits it with HKDF into an AES-256-GCM content key and the unlock token. A stolen
database still needs an offline PBKDF2 search per guess. The server also serves the page's
JavaScript, so this protects against database leaks and passive operators, not against a modified
deployment.

## Signed-in routes

With [sign-in](sign-in.md) configured, these need the session cookie (sent by the browser after
signing in):

- `POST /documents?private=1` saves a private paste (`401` signed out, `400` with `burn=1`).
  Pastes saved while signed in carry `"mine": true` (and `"private": true`) on later reads by their
  owner.
- `GET /documents` lists your pastes, newest first:
  `{"items": [{"key", "createdAt", "expiresAt", "size", "preview"}], "next"}`, 50 per page. Pass
  `next` back as `?before=` for the next page. Burn and protected pastes have no `preview`.
- `DELETE /documents/KEY` deletes your own paste: `204`, or `404` if it is not yours.
- `/auth/login?return=/path` starts sign-in, `/auth/callback` finishes it, `POST /auth/logout`
  signs out, and `GET /auth/me` returns `{"enabled", "user": {"name"} | null}`.
