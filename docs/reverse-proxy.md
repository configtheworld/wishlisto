# Reverse proxies

Run Wishlisto on your own HTTPS address with a reverse proxy. The examples are in `deploy/`:

- `deploy/traefik/` — Traefik with Let's Encrypt, using the external `edge` network
- `deploy/caddy/` — Caddy, which fetches certificates automatically
- `deploy/nginx/` — nginx with certbot certificates

Replace `wishlist.example.com` with your own domain in whichever file you use.

## What the proxy must do

1. **Terminate HTTPS** and forward plain HTTP to the container on port 8099.
2. **Forward the client's address.** Send `X-Forwarded-For` or `X-Real-IP`. Rate limits use it.
3. **Allow uploads up to a little more than `MAX_UPLOAD_MB`.** Multipart forms add overhead. The default of 8 MB needs about 12 MB at the proxy.
4. **Keep the public address consistent.** `BASE_URL` must match the address users type, including `https://`.

In `.env` set:

```dotenv
BASE_URL=https://wishlist.example.com
COOKIE_SECURE=true
TRUST_PROXY=true
```

`TRUST_PROXY=true` makes the app believe the forwarded client address. Set it **only** when the app is reachable exclusively through your proxy. If the port is open to the internet, anyone can fake their address and bypass rate limits.

## Traefik

1. Create the shared network once: `docker network create edge`. Traefik must be on it too.
2. Load `deploy/traefik/wishlisto.yml` in Traefik's file provider.
3. Start Wishlisto with the override file, which joins `edge` and removes the host port:

   ```bash
   docker compose -f docker-compose.yml -f deploy/traefik/compose.override.yml up -d
   ```

The router terminates TLS with the `letsencrypt` resolver, and redirects plain HTTP to HTTPS. The example uses no authentication middleware, because Wishlisto has its own sign-in.

## Caddy

Add the site block from `deploy/caddy/Caddyfile` to your Caddyfile and reload:

```bash
caddy reload --config /etc/caddy/Caddyfile
```

Caddy obtains and renews the certificate. The example limits request bodies to 12 MB.

## nginx

1. Copy `deploy/nginx/wishlisto.conf` to `/etc/nginx/sites-available/` and enable it.
2. Obtain a certificate, for example with certbot: `certbot certonly --webroot -w /var/www/certbot -d wishlist.example.com`.
3. Test and reload: `nginx -t && systemctl reload nginx`.

The example redirects HTTP to HTTPS, sets `client_max_body_size 12m`, and passes the forwarding headers.

## Checking the setup

- `https://wishlist.example.com/healthz` returns `{"status":"ok", ...}`.
- Sign in, then open the browser's developer tools and confirm the session cookie is marked `Secure` and `HttpOnly`.
- Upload an image larger than 8 MB and confirm you get a friendly error, not a broken page.
- Make a wrong sign-in several times and confirm the message asks you to wait, which shows the client address is being used.
