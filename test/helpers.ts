import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { loadConfig } from '../src/config.js';
import type { Config } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import type { DB } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import type { AppEnv } from '../src/types.js';
import { hashSessionToken, SESSION_COOKIE } from '../src/lib/session.js';
import { hashPassword } from '../src/lib/password.js';
import { validateUsername } from '../src/lib/username.js';
import { DEFAULT_AVATAR_STYLE } from '../src/lib/avatar-ids.js';
import { randomId } from '../src/lib/ids.js';

let ipCounter = 0;

export function nextTestIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 250) + 1}`;
}

export interface Harness {
  app: Hono<AppEnv>;
  config: Config;
  db: DB;
  dir: string;
  close: () => Promise<void>;
}

export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wishlisto-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    PUBLIC_DIR: path.resolve('src/public'),
    BASE_URL: 'http://localhost:8099',
    COOKIE_SECURE: 'false',
    TRUST_PROXY: 'true',
    SESSION_TTL_DAYS: '30',
    MAX_UPLOAD_MB: '1',
    LOG_LEVEL: 'error',
    LINK_PREVIEW_ENABLED: 'false',
    ...overrides,
  });
  const db = openDatabase(config);
  const app = createApp({ config, db, logger: createLogger('error') });
  return {
    app,
    config,
    db,
    dir,
    close: async () => {
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export class TestClient {
  readonly ip: string;
  private cookies = new Map<string, string>();

  constructor(
    readonly harness: Harness,
    ip = nextTestIp(),
  ) {
    this.ip = ip;
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  csrfToken(): string {
    const session = this.cookies.get(SESSION_COOKIE);
    if (session) {
      const row = this.harness.db
        .prepare('SELECT csrf_token FROM sessions WHERE id = ?')
        .get(hashSessionToken(session)) as { csrf_token: string } | undefined;
      if (row) return row.csrf_token;
    }
    return this.cookies.get('wishlisto_csrf') ?? '';
  }

  private storeCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /;\s*max-age=0\b/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('x-forwarded-for', this.ip);
    if (!headers.has('host')) headers.set('host', 'localhost');
    if (this.cookies.size > 0) {
      headers.set(
        'cookie',
        [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    const response = await this.harness.app.request(`http://localhost${pathname}`, { ...init, headers });
    this.storeCookies(response);
    return response;
  }

  get(pathname: string): Promise<Response> {
    return this.request(pathname);
  }

  /**
   * POST a form. `_csrf` is added automatically from the session/anonymous cookie
   * unless `csrf` is explicitly set (use null/'' to test a missing token).
   */
  post(
    pathname: string,
    fields: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {},
    options: { csrf?: string | null; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const token = options.csrf === undefined ? this.csrfToken() : options.csrf;
    const hasFile = Object.values(fields).some((value) =>
      Array.isArray(value) ? value.some((entry) => entry instanceof File) : value instanceof File,
    );
    const headers = new Headers(options.headers);
    headers.set('x-forwarded-for', this.ip);

    let body: BodyInit;
    if (hasFile) {
      const form = new FormData();
      if (token) form.set('_csrf', token);
      for (const [name, value] of Object.entries(fields)) {
        const values = Array.isArray(value) ? value : [value];
        for (const entry of values) form.append(name, entry);
      }
      body = form;
    } else {
      const form = new URLSearchParams();
      if (token) form.set('_csrf', token);
      for (const [name, value] of Object.entries(fields)) {
        const values = Array.isArray(value) ? value : [value];
        for (const entry of values) form.append(name, typeof entry === 'string' ? entry : entry.name);
      }
      headers.set('content-type', 'application/x-www-form-urlencoded');
      body = form.toString();
    }
    return this.request(pathname, { method: 'POST', body, headers });
  }

  async page(pathname: string): Promise<{ status: number; html: string; response: Response }> {
    const response = await this.get(pathname);
    return { status: response.status, html: await response.text(), response };
  }
}

export interface UserSeed {
  id: string;
  username: string;
  password: string;
  isAdmin?: boolean;
}

export async function createUser(
  harness: Harness,
  username: string,
  password = 'correct horse battery',
  isAdmin = false,
): Promise<UserSeed> {
  const validated = validateUsername(username);
  if (!validated.ok) throw new Error(`Invalid test username: ${username}`);
  const id = randomId();
  const now = Date.now();
  harness.db
    .prepare(
      `INSERT INTO users (id, username, username_ci, username_skel, password_hash, avatar_style, avatar_seed,
                          is_admin, is_disabled, locale, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'en', ?, ?)`,
    )
    .run(
      id,
      validated.username,
      validated.usernameCi,
      validated.usernameSkel,
      await hashPassword(password),
      DEFAULT_AVATAR_STYLE,
      validated.username,
      isAdmin ? 1 : 0,
      now,
      now,
    );
  return { id, username: validated.username, password, isAdmin };
}

/** Log in an existing user and return an authenticated client. */
export async function login(harness: Harness, user: UserSeed): Promise<TestClient> {
  const client = new TestClient(harness);
  await client.get('/login');
  const response = await client.post('/login', { username: user.username, password: user.password });
  if (response.status !== 303) throw new Error(`Login failed for ${user.username}: ${response.status}`);
  return client;
}

/** Complete first-run setup and return the admin client plus its one-time recovery code. */
export async function setupAdmin(
  harness: Harness,
  username = 'admin',
  password = 'correct horse battery',
): Promise<{ client: TestClient; recoveryCode: string; user: UserSeed }> {
  const client = new TestClient(harness);
  await client.get('/setup');
  const response = await client.post('/setup', { username, password, confirm: password });
  if (response.status !== 303) throw new Error(`Setup failed: ${response.status} ${await response.text()}`);
  const page = await client.page('/welcome/recovery?from=setup');
  const match = page.html.match(/[0-9A-Z]{5}(?:-[0-9A-Z]{5}){3}/);
  if (!match) throw new Error('Recovery code not shown after setup');
  const row = harness.db.prepare('SELECT id FROM users WHERE username_ci = ?').get(username.toLowerCase()) as {
    id: string;
  };
  return {
    client,
    recoveryCode: match[0],
    user: { id: row.id, username, password, isAdmin: true },
  };
}

export async function createList(
  client: TestClient,
  fields: { name: string; emoji?: string; color?: string; note?: string } = { name: 'Birthday' },
): Promise<string> {
  const response = await client.post('/lists', {
    name: fields.name,
    emoji: fields.emoji ?? '🎂',
    color: fields.color ?? '2',
    note: fields.note ?? '',
  });
  if (response.status !== 303) throw new Error(`List creation failed: ${response.status} ${await response.text()}`);
  const location = response.headers.get('location') ?? '';
  const match = location.match(/\/lists\/([a-f0-9]{32})/);
  if (!match) throw new Error(`Unexpected list redirect: ${location}`);
  return match[1] as string;
}

export interface ItemFields {
  title: string;
  url?: string;
  price?: string;
  currency?: string;
  quantity?: string;
  priority?: string;
  notes?: string;
  size?: string;
  color?: string;
  linkLabels?: string[];
  linkUrls?: string[];
  image?: File;
}

export async function createItem(client: TestClient, listId: string, fields: ItemFields): Promise<string> {
  const response = await client.post(`/lists/${listId}/items`, {
    title: fields.title,
    url: fields.url ?? '',
    price: fields.price ?? '',
    currency: fields.currency ?? 'EUR',
    quantity: fields.quantity ?? '1',
    priority: fields.priority ?? '1',
    notes: fields.notes ?? '',
    size: fields.size ?? '',
    color: fields.color ?? '',
    linkLabels: fields.linkLabels ?? [],
    linkUrls: fields.linkUrls ?? [],
    ...(fields.image ? { image: fields.image } : {}),
  });
  if (response.status !== 303) throw new Error(`Item creation failed: ${response.status} ${await response.text()}`);
  const location = response.headers.get('location') ?? '';
  const match = location.match(/#item-([a-f0-9]{32})/);
  if (!match) throw new Error(`Unexpected item redirect: ${location}`);
  return match[1] as string;
}

export async function createGroup(client: TestClient, name = 'Family'): Promise<string> {
  const response = await client.post('/groups', { name, note: '' });
  if (response.status !== 303) throw new Error(`Group creation failed: ${response.status} ${await response.text()}`);
  const location = response.headers.get('location') ?? '';
  const match = location.match(/\/groups\/([a-f0-9]{32})/);
  if (!match) throw new Error(`Unexpected group redirect: ${location}`);
  return match[1] as string;
}

export function groupInviteToken(harness: Harness, groupId: string): string | null {
  const row = harness.db.prepare('SELECT invite_token FROM groups WHERE id = ?').get(groupId) as
    | { invite_token: string | null }
    | undefined;
  return row?.invite_token ?? null;
}

export function publicTokenOf(harness: Harness, listId: string): string | null {
  const row = harness.db.prepare('SELECT public_token FROM lists WHERE id = ?').get(listId) as
    | { public_token: string | null }
    | undefined;
  return row?.public_token ?? null;
}

export function userIdOf(harness: Harness, username: string): string {
  const row = harness.db.prepare('SELECT id FROM users WHERE username_ci = ?').get(username.toLowerCase()) as {
    id: string;
  };
  return row.id;
}

export function pngFile(width = 8, height = 8): Promise<File> {
  // Small valid PNG generated with the same library the app uses for decoding.
  return import('sharp').then(async ({ default: sharp }) => {
    const data = await sharp({
      create: { width, height, channels: 3, background: { r: 240, g: 180, b: 210 } },
    })
      .png()
      .toBuffer();
    return new File([new Uint8Array(data)], 'test.png', { type: 'image/png' });
  });
}
