# Architecture

Wishlisto is one Node.js process with one SQLite database. It is deliberately small: no separate frontend build, no message queue, no external services.

## Components

| Part | Technology | Where |
| --- | --- | --- |
| HTTP server and routing | [Hono](https://hono.dev) | `src/app.ts`, `src/routes/` |
| Pages | server-rendered JSX (`hono/jsx`), no client framework | `src/views/` |
| Browser code | two small same-origin ES modules and one stylesheet | `src/public/` |
| Database | SQLite via `better-sqlite3`, WAL mode | `src/db/` |
| Images | `sharp`: decode, downscale, re-encode to WebP, strip metadata | `src/lib/images.ts` |
| Avatars | DiceBear Identicon, rendered on the server and sanitised | `src/lib/avatar.ts` |
| Passwords | Argon2id (`@node-rs/argon2`) | `src/lib/password.ts` |
| Validation | Zod, at every boundary | `src/lib/validation.ts` |
| Link previews | SSRF-hardened fetch of title and description | `src/lib/preview.ts` |
| Translations | JSON catalogues, one per language | `src/i18n/` |

## Request flow

1. The security middleware sets the response headers, including a strict content security policy with no inline scripts or styles.
2. The session middleware reads the session cookie and loads the user from the database. Sessions are stored hashed.
3. The CSRF middleware checks a token on every state-changing request, and the `Origin` / `Sec-Fetch-Site` headers.
4. The locale middleware picks the language: account setting, then cookie, then the browser's `Accept-Language`.
5. The password-change middleware sends a user with a temporary password to the settings page until they pick their own.
6. The route checks ownership or group membership on the server before it reads or changes anything.
7. The page is rendered as HTML. There is no client-side data fetching.

## Data model

- **Users and sessions:** accounts, password hashes, recovery-code hashes, sessions, and the admin flag.
- **Lists and wishes:** lists owned by a user; wishes (items) with integer prices in minor units, priority, links, and optional images.
- **Sharing:** groups with a single invite token; `list_groups` joins lists to groups; each list may have one public token.
- **Claims:** at most one claim per wish, with a visibility setting that controls what the list owner sees.
- **Settings:** instance-wide values such as the signup switch and the campaign bar.
- **Uploads:** metadata for each stored image; the files live in `DATA_DIR/uploads`.

Migrations are numbered and applied in order at startup. Each one is recorded in the `_migrations` table and runs once.

## Where things are checked

Authorisation is checked in the route, against the database, for every object: a list, a wish, an image, a group. The UI hiding a button is never the only check. Public list pages and public images are scoped to the token in the URL, so a token for one list cannot read another list's images.

## Operating assumptions

- **One process.** Rate limits and sessions are stored in SQLite, so running several replicas against the same file is not supported.
- **Local storage.** Images are files on disk. Back up `DATA_DIR` (see [Backups](backups.md)).
- **No outbound requests** except link previews, which can be switched off with `LINK_PREVIEW_ENABLED=false`.

## Tests

The tests start the real Hono application against a temporary database and send requests with `app.request`. No browser or network is needed. Run `npm test`.
