import path from 'node:path';
import { z } from 'zod';
import { AVATAR_STYLE_IDS, DEFAULT_AVATAR_STYLE } from './lib/avatar-ids.js';
import type { AvatarStyleId } from './lib/avatar-ids.js';

const boolish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1' || v === 'yes'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8099),
  HOST: z.string().min(1).default('0.0.0.0'),
  BASE_URL: z.string().url().default('http://localhost:8099'),
  DATA_DIR: z.string().min(1).default('./data'),
  PUBLIC_DIR: z.string().min(1).default('./src/public'),
  COOKIE_SECURE: boolish.optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TRUST_PROXY: boolish.default(false),
  OPEN_SIGNUP: boolish.default(true),
  ADMIN_USERNAME: z.string().min(1).max(64).optional(),
  ADMIN_PASSWORD: z.string().min(8).max(128).optional(),
  LINK_PREVIEW_ENABLED: boolish.default(true),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(25).default(8),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SITE_CONFIG: z.string().min(1).default('site.json'),
  AVATAR_STYLE: z.enum(AVATAR_STYLE_IDS).default(DEFAULT_AVATAR_STYLE),
});

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  baseUrl: string;
  dataDir: string;
  uploadsDir: string;
  dbPath: string;
  publicDir: string;
  cookieSecure: boolean;
  sessionTtlMs: number;
  trustProxy: boolean;
  openSignupDefault: boolean;
  adminUsername?: string;
  adminPassword?: string;
  linkPreviewEnabled: boolean;
  maxUploadBytes: number;
  logLevel: LogLevel;
  siteConfigPath: string;
  avatarStyle: AvatarStyleId;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration: ${details}`);
  }
  const v = parsed.data;

  if (Boolean(v.ADMIN_USERNAME) !== Boolean(v.ADMIN_PASSWORD)) {
    throw new ConfigError('ADMIN_USERNAME and ADMIN_PASSWORD must be set together (or neither).');
  }

  // Never let the admin password end up in a crash report or log line.
  const dataDir = path.resolve(v.DATA_DIR);
  const baseUrl = v.BASE_URL.replace(/\/+$/, '');
  const cookieSecure = v.COOKIE_SECURE ?? baseUrl.startsWith('https://');
  if (v.NODE_ENV === 'production' && !cookieSecure) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'COOKIE_SECURE is disabled in production; use HTTPS.' }));
  }

  return {
    env: v.NODE_ENV,
    port: v.PORT,
    host: v.HOST,
    baseUrl,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'wishlisto.db'),
    publicDir: path.resolve(v.PUBLIC_DIR),
    cookieSecure,
    sessionTtlMs: v.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    trustProxy: v.TRUST_PROXY,
    openSignupDefault: v.OPEN_SIGNUP,
    adminUsername: v.ADMIN_USERNAME,
    adminPassword: v.ADMIN_PASSWORD,
    linkPreviewEnabled: v.LINK_PREVIEW_ENABLED,
    maxUploadBytes: v.MAX_UPLOAD_MB * 1024 * 1024,
    logLevel: v.LOG_LEVEL,
    siteConfigPath: path.resolve(v.SITE_CONFIG),
    avatarStyle: v.AVATAR_STYLE,
  };
}
