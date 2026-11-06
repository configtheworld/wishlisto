# Troubleshooting

Start with the logs. Wishlisto writes one JSON line per event:

```bash
docker compose logs -f wishlisto
```

Set `LOG_LEVEL=debug` temporarily for more detail. Passwords and tokens are never logged.

## The server does not start

- **"Invalid configuration: …"**: a variable in `.env` is wrong. The message names it. Compare with [Configuration](configuration.md).
- **"Invalid site config at …"**: `site.json` does not validate. The message gives the path, for example `landing.title.en`. The usual causes are a missing English text or a colour without `#`.
- **"ADMIN_USERNAME and ADMIN_PASSWORD must be set together"**: set both or neither.
- **Permission errors on `/data`** (`EACCES`): the data folder must be writable by uid 1000. See [Deployment](deployment.md#data-and-permissions).
- **Port already in use**: change the host port in `docker-compose.yml`, or stop the other service.

## I cannot sign in

- **Wrong password, repeated attempts**: the app waits before it accepts more tries from the same address. The message says how long. Waiting is enough.
- **The browser never keeps the login**: `COOKIE_SECURE=true` requires HTTPS. If you are testing over plain `http://`, set `COOKIE_SECURE=false` and `BASE_URL=http://…`. Browsers refuse secure cookies on plain HTTP.
- **Signed out after a password change**: this is expected. Changing a password signs out every other session.
- **Forgot the password and have no recovery code**: an admin can reset it from **Admin**, which sets a temporary password that must be changed at the next sign-in. If you are the only admin and have lost the password, restore a backup (see [Backups](backups.md)). There is no command-line reset yet.

## Sign-up is closed

Admins open or close signups in **Admin**. `OPEN_SIGNUP` only sets the initial value on the first start; it does not override the admin setting afterwards.

## Images do not upload

- **"That image is too large"**: the limit is `MAX_UPLOAD_MB`. Raise it, and make sure your reverse proxy allows a slightly bigger body (see [Reverse proxies](reverse-proxy.md)).
- **Upload fails before the message appears**: the proxy is rejecting the body. Check its body-size setting.
- **"Only JPEG, PNG, WebP and GIF images are allowed"**: SVG and other formats are rejected on purpose. Convert the image first.

## Link previews show nothing

This is intentional in several cases. Previews read only the page title and description, use only `http` and `https` on ports 80 and 443, and refuse addresses on private networks and loopback. Some sites block automated requests, and some pages have no title tags. You can still type the details in by hand. Set `LINK_PREVIEW_ENABLED=false` to turn the feature off completely.

## The campaign bar does not appear

It appears only on the home and lists pages, only when it is switched on, and only when the text is not empty. Check **Admin → Campaign bar**.

## Avatars look wrong after a change

`AVATAR_STYLE` applies to every avatar on the next page load. Browsers may keep old images for up to a day; a hard refresh shows the new style.

## Healthcheck is unhealthy

Run `docker compose exec wishlisto node -e "fetch('http://127.0.0.1:8099/healthz').then(r=>r.text()).then(console.log)"`. If that fails, the server is not listening, so read the logs. If it succeeds but Docker still reports unhealthy, check that `PORT` in `.env` is `8099`, the port the health check uses.

## Still stuck?

Open an issue with the version or commit, what you did, and the relevant log lines. Remove passwords, tokens, usernames and domain names before you paste them.
