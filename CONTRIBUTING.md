# Contributing to Wishlisto

Thanks for wanting to help. Wishlisto is a small, opinionated project: cute on the surface, strict underneath. Please keep changes small and focused.

## Before you start

- Read the [README](README.md) and the [documentation](docs/architecture.md). The app is a single Node.js process with server-rendered pages; see the architecture notes before changing the structure.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- For anything larger than a bug fix or documentation change, open an issue first and describe the problem, the proposed behavior, and the tests you plan to add.
- Security issues must **not** be reported in a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 22.18 or newer.

```bash
npm ci
cp .env.example .env
```

For local HTTP, set these in `.env`:

```dotenv
NODE_ENV=development
BASE_URL=http://localhost:8099
COOKIE_SECURE=false
TRUST_PROXY=false
DATA_DIR=./data
PUBLIC_DIR=./src/public
```

Then:

```bash
npm run dev
npm test
npm run typecheck
npm run build
npm run audit
```

`npm run dev` loads `.env` automatically. On first visit `/setup` creates the admin account.

## Project conventions

- **TypeScript everywhere.** No `any` unless there is a documented reason. Prefer explicit types at module boundaries and Zod for anything user-supplied.
- **Server-rendered JSX.** Routes and views that render JSX use `.tsx`. Plain logic stays in `.ts` under `src/lib`.
- **No inline scripts or styles.** The CSP is strict; add behavior to the small same-origin ES modules in `src/public` and styles to `src/public/app.css`.
- **No external assets.** No CDNs, web fonts, analytics, or remote images. Avatars and icons are generated or bundled locally.
- **All user input goes through Zod.** Keep validation in `src/lib/validation.ts` unless it is very route-specific.
- **Parameterized SQL only.** Never interpolate user input into a query string. Migrations are append-only; add a new numbered migration instead of editing an applied one.
- **Authorization on every object route.** Check ownership before reading or mutating, and return 404/403 without leaking whether the object exists.
- **Prices are integers.** Store minor units plus an ISO currency code; never store floats.
- **Strings are translatable.** Add new UI copy to `src/i18n/en.json`, `de.json` and `tr.json` with the same keys; the test suite checks key parity.
- **Friendly, short copy.** The product tone is warm and calm, not corporate.
- **Accessibility is not optional.** Use semantic elements, visible focus, labels, and reduced-motion-friendly animation.

## Tests

Every behavioral change needs a test. The suite uses `node:test` and Hono's `app.request`, so no browser or running server is needed.

- Put HTTP integration tests in `test/*.test.ts` and use the helpers in `test/helpers.ts` (temporary database, cookie/CSRF client, factories).
- Use a unique `x-forwarded-for` per simulated client so rate limits do not interfere.
- Cover the negative case: unauthorized access, invalid input, CSRF failure, rejected upload type, and last-admin protection.
- Run the full suite before opening a pull request:

```bash
npm test
npm run typecheck
npm run build
```

All three must pass. Please also run `npm audit --omit=dev` if you changed dependencies.

## Database changes

- Add a new migration in `src/db/migrations.ts`. Do not modify a migration that may already have run.
- Migrations must be safe to run on an existing database and are applied automatically at boot.
- Mention the schema change and any backup implications in the pull request.

## Commits and pull requests

- Keep commits scoped and describe **why**, not just what.
- A pull request should include: what changed, why, how it was tested, and anything still unverified.
- Do not claim a feature works if you have not run it. Say what you tested and what you did not.
- Update the README when behavior, configuration, or deployment changes.
- Do not commit `.env`, `data/`, uploads, database files, or secrets. `.gitignore` already covers the usual cases; check `git status` before committing.

## Licensing

By contributing you agree that your contribution is licensed under the MIT License in [LICENSE](LICENSE).
