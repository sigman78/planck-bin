# Sign-in

Optional sign-in through an OpenID Connect provider (Google, Pocket ID and others). Signed in, a
user gets a list of their own pastes, can delete them, and can save private pastes.

## Settings

Sign-in is off unless all four of `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and
`SESSION_SECRET` are set. Set them as secrets (`pnpm exec wrangler secret put NAME`), or in
`.dev.vars` for `wrangler dev`. If only some are set, sign-in stays off and the worker logs why.

| Variable              | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `OIDC_ISSUER`         | Provider issuer URL; must match its discovery document exactly             |
| `OIDC_CLIENT_ID`      | Client ID registered with the provider                                     |
| `OIDC_CLIENT_SECRET`  | Client secret (a confidential client)                                      |
| `SESSION_SECRET`      | At least 32 characters; signs the session cookie                           |
| `OIDC_ALLOWED_EMAILS` | Optional comma-separated list of emails allowed to sign in; unset = anyone |

Generate the session secret with `openssl rand -base64 32`. Changing it signs everyone out.

## Provider

Register `https://YOUR-HOST/auth/callback` as the redirect URI. The worker requests the
`openid profile email` scopes and uses the authorization code flow with PKCE. The client secret
goes in an HTTP Basic header (`client_secret_basic`), or in the request body when the provider's
discovery document lists only `client_secret_post`.

- Google: issuer `https://accounts.google.com`. In the Google Cloud console create an OAuth client
  of type "Web application" and add the redirect URI.
- Pocket ID (or another self-hosted provider): issuer is the provider's base URL, for example
  `https://id.example.com`. Create a client that is not public and add the redirect URI.

## Allowlist

With `OIDC_ALLOWED_EMAILS` set, only those addresses may sign in, and only when the provider
reports the email as verified. The list is checked again on every request, so removing an address
takes effect at once. Without it (unset or empty), any account at the provider may sign in. A
value that names no address, such as `,`, lets nobody in and logs a warning. A session records
whether its email was verified, so turning the allowlist on later does not let in a session whose
email was never verified.

## Sessions

A session lasts 30 days and is renewed while in use. It is a signed cookie; the server keeps no
session table. A user is identified by the issuer and the provider's subject ID, so switching
`OIDC_ISSUER` to another provider leaves pastes owned by the old accounts unreachable from the
list (they stay readable by link unless private).

## Owned and private pastes

Every paste saved while signed in is owned by that account. A private paste is a `404` for
everyone else, including signed-out visits by its owner. Private means access control on the
server, not encryption: combine it with a passphrase to keep the text from the database too. A
private paste cannot also be burn after reading. Deleting a public paste does not reach browsers
that cached it; they may keep it for up to `BROWSER_CACHE_MAX_AGE`.

In the command palette, signed-in users get **My pastes**, **Make private** (while editing),
**Delete paste** (on their own paste) and **Sign out**.
