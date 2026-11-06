# Backups and restore

Everything Wishlisto stores lives in one folder: `DATA_DIR`, which is the `/data` volume in the container. Back up that folder and you have backed up the instance.

## What to back up

- `wishlisto.db`, together with `wishlisto.db-wal` and `wishlisto.db-shm` if they exist.
- `uploads/`, the images for wishes.

Wishlisto uses SQLite in WAL mode. Copying only `wishlisto.db` while the app is running can produce an inconsistent copy, so use one of the two methods below.

## Method 1: stop, copy, start (simplest)

A few seconds of downtime, and the copy is always consistent:

```bash
docker compose stop wishlisto
docker run --rm -v wishlisto-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/wishlisto-$(date +%F).tar.gz -C /data .
docker compose start wishlisto
```

Keep the archive somewhere other than the server, for example on a second disk or another machine.

## Method 2: online snapshot

No downtime. Use SQLite's backup API from inside the container, which is safe while the app runs:

```bash
docker compose exec wishlisto node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/data/wishlisto.db', { readonly: true });
  db.backup('/data/backup.db').then(() => { db.close(); console.log('ok'); });
"
docker compose cp wishlisto:/data/backup.db ./wishlisto-backup.db
```

Copy the `uploads/` folder as well, for example with `docker compose cp wishlisto:/data/uploads ./uploads-backup`. Finally remove the temporary copy from the volume: `docker compose exec wishlisto rm /data/backup.db`.

## Restore

1. Stop the app: `docker compose stop wishlisto`.
2. Replace the contents of the data volume with the backup, or restore into an empty volume.
3. Start the app: `docker compose start wishlisto`.

Restoring an older backup returns the instance to that point in time. Users who signed in after the backup need to sign in again, and wishes and claims made since then are lost.

## Test your backups

A backup you have never restored is a guess. Restore one into a second copy of the project on another port once in a while and check that you can sign in and see your lists.
