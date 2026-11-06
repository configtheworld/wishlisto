# Deployment

This guide covers running Wishlisto with Docker Compose on a home server, a VPS, or a Proxmox VM or container. For HTTPS and the public address, see [Reverse proxies](reverse-proxy.md).

## Requirements

- Docker Engine and Docker Compose v2.24 or newer (for the `!reset` override used by the Traefik example). Node.js is not needed on the host.
- A volume or folder for the data. Wishlisto stores its SQLite database and uploaded images there.
- Modest hardware is enough for a small instance. Memory and CPU use have not been measured yet.

## Option A: build from source

```bash
git clone https://github.com/OWNER/REPO.git wishlisto
cd wishlisto
cp .env.example .env        # then edit it, see docs/configuration.md
docker compose up -d --build
docker compose logs -f      # wait for the server to start, then Ctrl+C
```

By default the app listens on `127.0.0.1:8099`. Open http://127.0.0.1:8099 on the same machine to finish setup.

## Option B: use a published image

Each push to the main branch and each version tag is built for `linux/amd64` and `linux/arm64` and published to GitHub Container Registry. Set the image in `.env`:

```dotenv
WISHLISTO_IMAGE=ghcr.io/OWNER/REPO:latest
```

Then:

```bash
docker compose pull
docker compose up -d
```

Use a version tag such as `ghcr.io/OWNER/REPO:0.1.0` to pin a release. `:main` follows the latest commit and is meant for testing.

## First start

Visit the site. If there are no users yet, you are sent to `/setup` to create the admin account. Alternatively, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` before the first start; the admin account is then created on boot. Those two variables are ignored once any user exists.

After the admin account is created, a recovery code is shown once. Store it somewhere safe. Recovery codes are the only way back into an account without the admin.

## Data and permissions

All persistent data lives in `DATA_DIR` (`/data` in the container):

| Path | Contents |
| --- | --- |
| `wishlisto.db` (+ `-wal`, `-shm`) | accounts, lists, wishes, claims, settings, sessions |
| `uploads/` | re-encoded WebP images for wishes |

The container runs as the unprivileged `node` user (uid 1000). The named volume `wishlisto-data` is created with the right owner automatically. If you switch to a bind mount, make the folder writable by uid 1000:

```bash
mkdir -p ./wishlisto-data && sudo chown -R 1000:1000 ./wishlisto-data
```

## Updating

1. Back up first (see [Backups](backups.md)).
2. Update the code or the image tag:
   - source: `git pull && docker compose up -d --build`
   - published image: `docker compose pull && docker compose up -d`
3. Database migrations run automatically on boot and are recorded in the database, so each runs once. Some rebuild tables, so always back up before upgrading.

To roll back, check out the previous commit or image tag and start it again with the same data volume. Do not roll back past a migration without restoring a backup taken before the upgrade.

## Health

`GET /healthz` returns `{"status":"ok", ...}` when the database answers. The container has a health check that calls it every 30 seconds.

## Proxmox

Wishlisto runs well on Proxmox. Two common layouts:

- **A Docker VM (recommended).** Create a small Debian or Ubuntu VM, install Docker, and follow Option A or B above. A VM needs no special settings.
- **An unprivileged LXC with Docker.** Enable *Nesting* and *keyctl* in the container's options. The Docker daemon needs both. Use the named volume so the data ownership works without extra steps.

Start with a small allocation and raise it if the app feels slow. Put Wishlisto behind a reverse proxy for HTTPS (see [Reverse proxies](reverse-proxy.md)).

These steps follow standard Docker practice. They have not been tested on Proxmox by the maintainers; if something differs on your setup, please open an issue.

## Stopping and removing

```bash
docker compose down          # stops the app; the data volume is kept
docker compose down -v       # also deletes the data volume. Irreversible.
```
