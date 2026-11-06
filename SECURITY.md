# Security policy

Wishlisto handles accounts and private wishlists, so security reports are welcome and taken seriously.

## Supported versions

Only the latest release and the latest commit on the default branch are supported. There are no backports or long-term support branches yet.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Until a dedicated security contact is published with the repository, report privately to the maintainer who operates the instance you found the issue on, or use the repository host's private vulnerability reporting feature (for example GitHub "Report a vulnerability" under the Security tab).

Please include:

- affected version or commit,
- a short description and impact,
- reproduction steps or a proof of concept,
- whether the issue is already public,
- any suggested fix.

You can expect an acknowledgement as soon as reasonably possible. This is a small volunteer project, so no formal SLA is offered. Please give a reasonable window for a fix before public disclosure.

## Scope

In scope:

- authentication, sessions, CSRF, and rate limiting,
- authorization between users (lists, items, uploads, media),
- the upload pipeline and image serving,
- SQL injection, XSS, CSP, and header issues,
- SSRF and outbound request handling (link previews),
- secrets in logs or responses,
- the Docker image and deployment examples.

Out of scope:

- denial of service through very large volumes of legitimate traffic,
- issues that require an already-compromised host, database, or reverse proxy,
- missing hardening headers on static error pages served by an upstream proxy,
- the absence of features listed as unimplemented in the README (PWA).

## Implemented controls

- **Passwords:** Argon2id (`@node-rs/argon2`), 19 MiB memory, t=2, p=1. Length-only policy, 8–128 characters. Hashes are never logged.
- **Sessions:** random 32-byte tokens, only the SHA-256 hash is stored. Cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS. 30-day sliding expiry, revoked on logout, password change, and account deletion.
- **CSRF:** session-bound double-submit token, plus `Origin`/`Host` and `Sec-Fetch-Site` checks where the browser sends them. Anonymous forms use a separate `HttpOnly` cookie token.
- **Authorization:** every list, item, upload, and media route checks ownership. Cross-user access returns 404 or 403 without leaking existence.
- **Rate limiting:** persistent sliding-window counters and exponential cooldown per IP and per username for login, signup, and recovery. The limiter assumes a single app replica.
- **Usernames:** Unicode NFKC normalization, case-insensitive uniqueness, and a partial UTS#39-style confusable skeleton. This is heuristic, not a complete confusable table.
- **Admin:** exactly one admin, enforced by a partial unique index. The admin account cannot be deleted while it is the last admin. `ADMIN_USERNAME`/`ADMIN_PASSWORD` only apply when the instance has zero users.
- **Uploads:** JPEG/PNG/WebP/GIF magic bytes only, SVG rejected. Images are decoded, downscaled, re-encoded to WebP, and stripped of metadata by sharp. Served same-origin through an authenticated route with `nosniff` and a sandboxed CSP.
- **Avatars:** generated locally with DiceBear's Identicon style, seeded by username. The generated SVG is sanitized and served with `default-src 'none'; sandbox`.
- **Groups and sharing:** every group and list action checks membership or ownership on the server. Only list owners can share, unshare, or enable public links. Group members get read-only access.
- **Public links:** tokens are 24 random bytes (base64url). Public pages are `noindex`, hide the owner's username, and serve only the token's own list media; other media returns 404.
- **Admin:** admin routes require the admin flag. Admins cannot reset another admin's or their own password. Temporary passwords force a change on next login, and the target's sessions are revoked. Admins have no route to view lists, wishes, or claims.
- **CSP:** `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; …`. No inline scripts or styles, no CDN, no external fonts, no analytics.
- **Database:** SQLite with foreign keys on and parameterized statements. The schema is applied by versioned TypeScript migrations at boot.
- **Logs:** JSON logs with redaction of secret-like keys. Passwords, tokens, recovery codes, and cookies are not logged.
- **Errors:** unexpected failures return a generic 500 and log server-side detail; stack traces are not sent to clients.
- **Link previews:** the only outbound request. It runs only when a user asks to add a wish from a link. It refuses non-public addresses (checked on every resolved address and pinned at connect time to defeat DNS rebinding), non-default ports, credentials and non-http(s) schemes, re-validates redirects, caps response size and time, and reads only title and description tags. Disable it with `LINK_PREVIEW_ENABLED=false`.
- **Claims:** the list owner sees nothing for a surprise claim, only that the wish is claimed for a "claimed" claim, and the claimer's name only for a "visible" claim. Only the claimer may change or release their claim, and claimer identity is never shown to anyone except the owner, and only when the claimer chose "visible".

## Operator responsibilities

- Run behind HTTPS. Set a correct `BASE_URL`, and `COOKIE_SECURE=true` in production.
- Set `TRUST_PROXY=true` only when a trusted reverse proxy sets `X-Forwarded-For`. Otherwise clients can spoof their IP for rate limiting.
- Keep the host, Node.js, Docker, and dependencies patched. Run `npm audit --omit=dev` regularly.
- Back up `DATA_DIR` before upgrades. Migrations are not reversible.
- Run exactly one app replica per SQLite database.
- Treat `DATA_DIR`, the database, and uploads as sensitive: they contain private lists and password hashes.
- There is no email recovery and no 2FA. Store the one-time recovery code safely. An admin reset is the only other way back in.

## Dependency and disclosure policy

- Production dependencies are audited with `npm audit --omit=dev` in continuous integration and before each release.
- Security-relevant dependency upgrades are preferred over patches that fork upstream code.
- Please do not include real user data, credentials, or live tokens in a report. Use synthetic reproductions.
