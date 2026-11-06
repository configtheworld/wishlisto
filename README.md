# Wishlisto

A small, self-hosted wishlist app for the people you love. Keep private lists, share them with a group, or send a secret link. Friends can claim a gift so nobody buys it twice, and you decide whether you find out who.

## Features

- **Lists and wishes.** Price, currency, quantity, priority, notes, size, colour, a photo, and extra shop links. Paste a shop link and the title and description are filled in for you (when link previews are enabled).
- **Private by default.** Nothing is shared until you choose a group or a public link.
- **Groups.** One invite link per group. Share any of your lists with the group; members can see them and claim wishes.
- **Claims with control.** Claim a wish as a surprise, as "taken" without a name, or visibly. You can change or release the claim at any time.
- **Accounts without email.** A username, a password, and a one-time recovery code.
- **Your instance, your look.** Change the app name, text, colours and avatar style. See [Customisation](docs/customization.md).
- **Built for phones and desktops.** Responsive layout, dark mode, and English, German and Turkish.
- **Built to be self-hosted.** One container, one SQLite database, one data folder. No trackers, no CDNs, no external fonts.

## Quick start

You need Docker with Compose v2.24 or newer.

```bash
git clone https://github.com/OWNER/REPO.git wishlisto && cd wishlisto
cp .env.example .env
docker compose up -d --build
```

Open http://127.0.0.1:8099 and create the admin account. For a published image instead of building, see [Deployment](docs/deployment.md#option-b-use-a-published-image).

For a public server, put the app behind a reverse proxy with HTTPS. Examples for Traefik, Caddy and nginx are in [Reverse proxies](docs/reverse-proxy.md).

## Documentation

| Guide | Covers |
| --- | --- |
| [Deployment](docs/deployment.md) | Docker Compose, published images, updates, Proxmox |
| [Reverse proxies](docs/reverse-proxy.md) | HTTPS with Traefik, Caddy or nginx |
| [Configuration](docs/configuration.md) | every environment variable and its default |
| [Customisation](docs/customization.md) | app name, copy, colours, avatars, campaign bar, languages |
| [Backups](docs/backups.md) | what to back up, and how to restore it |
| [Troubleshooting](docs/troubleshooting.md) | start-up errors, sign-in, uploads, avatars |
| [Architecture](docs/architecture.md) | how the app is put together |

## Development

Requirements: Node.js 22.18 or newer.

```bash
npm ci
cp .env.example .env     # for local HTTP, see docs/configuration.md
npm run dev              # http://localhost:8099
```

| Command | What it does |
| --- | --- |
| `npm run dev` | start the server with reloading |
| `npm test` | run the test suite (no browser or network needed) |
| `npm run typecheck` | check the TypeScript types |
| `npm run build` | build `dist/` for production |
| `npm run audit` | check production dependencies for known vulnerabilities |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the coding conventions and the pull-request checklist.

## Security

Accounts and private wishlists are the point of the app, so security reports are taken seriously. Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md) for the process and the controls the app implements.

## Contributing

Bug reports, documentation fixes, translations and focused pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)

## Third-party software

Avatars are drawn with [DiceBear](https://www.dicebear.com). Each style has its own licence, and some styles require attribution. The style your instance uses, with its licence and credit, is shown in the Settings page of the app. Keep that credit in place.
