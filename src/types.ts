import type { Config } from './config.js';
import type { DB } from './db/index.js';
import type { Logger } from './lib/logger.js';
import type { Locale } from './lib/i18n.js';
import type { SessionRow, SessionUser } from './lib/session.js';
import type { SiteConfig } from './lib/site.js';

export type FormValue = string | File | (string | File)[];
export type FormBody = Record<string, FormValue>;

export interface AppVariables {
  user: SessionUser | null;
  session: SessionRow | null;
  locale: Locale;
  csrfToken: string;
  form: FormBody | null;
  config: Config;
  db: DB;
  logger: Logger;
  site: SiteConfig;
}

export type AppEnv = { Variables: AppVariables };
