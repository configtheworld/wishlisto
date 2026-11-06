# Configuration

Wishlisto is configured with environment variables, read from `.env` (Docker Compose) or from the process environment. Invalid values stop the server at startup with a message that names the variable.

Copy `.env.example` to `.env` to start. Anything you leave out uses the default below.

## Core

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set `production` on a server. |
| `PORT` | `8099` | Port the server listens on. |
| `HOST` | `0.0.0.0` | Address to bind to. |
| `BASE_URL` | `http://localhost:8099` | The public address users type in. Used for links and for the cookie defaults. Include `https://` on a server. |
| `DATA_DIR` | `./data` | Folder for the database and uploads. In Docker the container uses `/data`, which is pinned in `docker-compose.yml`. |
| `PUBLIC_DIR` | `./src/public` | Static files (stylesheet, scripts, icons). Set to `dist/public` for the built app. |
| `SITE_CONFIG` | `site.json` | Path to the branding and landing-page file. See [Customisation](customization.md). |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`. |

## Accounts and sessions

| Variable | Default | Description |
| --- | --- | --- |
| `OPEN_SIGNUP` | `true` | Whether new people can create accounts when the database is first created. After that, the admin's signup switch in **Admin** decides. |
| `ADMIN_USERNAME` | empty | With `ADMIN_PASSWORD`, creates the admin account on boot if no users exist yet. Set both or neither. |
| `ADMIN_PASSWORD` | empty | Password for the account above. At least 8 characters. Remove it from `.env` after the first start if you like. |
| `SESSION_TTL_DAYS` | `30` | How long a login lasts without use, from 1 to 365 days. |

Setting `ADMIN_USERNAME` and `ADMIN_PASSWORD` is optional: without them, the first visit goes to `/setup`.

## Security and networking

| Variable | Default | Description |
| --- | --- | --- |
| `COOKIE_SECURE` | derived from `BASE_URL` | Mark the session cookie `Secure`, and send the `Strict-Transport-Security` header. Defaults to `true` when `BASE_URL` starts with `https://`. Set `false` only for plain HTTP on your local network. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` and `X-Real-IP` for rate limiting. Set `true` only when a reverse proxy you control sits in front of the app. See [Reverse proxies](reverse-proxy.md). |
| `MAX_UPLOAD_MB` | `8` | Largest accepted image, from 1 to 25 MB. Your reverse proxy's body limit must be a little larger. |
| `LINK_PREVIEW_ENABLED` | `true` | When adding a wish from a link, read the page's title and description. Set `false` to make the server send no outbound requests at all. |

## Appearance

| Variable | Default | Description |
| --- | --- | --- |
| `AVATAR_STYLE` | `initials` | The DiceBear style used for every user's avatar. One of the 31 ids listed in `src/lib/avatar-ids.ts`, for example `initials`, `adventurer` or `thumbs`. Settings shows the chosen style's licence and attribution. |

Colours, the app name, and the landing page are set in `site.json`, not here. See [Customisation](customization.md).

## Docker Compose only

| Variable | Default | Description |
| --- | --- | --- |
| `WISHLISTO_IMAGE` | `wishlisto:local` | Image to run. Set it to a published image to skip building. See [Deployment](deployment.md). |

The compose file pins `NODE_ENV`, `HOST`, `PORT`, `DATA_DIR` and `PUBLIC_DIR` for the container, so the local values in `.env` do not leak into it.

## Example for a public server

```dotenv
NODE_ENV=production
BASE_URL=https://wishlist.example.com
COOKIE_SECURE=true
TRUST_PROXY=true
OPEN_SIGNUP=false
MAX_UPLOAD_MB=8
LINK_PREVIEW_ENABLED=true
AVATAR_STYLE=initials
```

Set `OPEN_SIGNUP=false` to keep signups closed from the first start. The admin can open them later from the **Admin** page.
