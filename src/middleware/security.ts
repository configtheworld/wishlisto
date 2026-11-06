import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';
import type { Config } from '../config.js';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'same-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    if (config.cookieSecure) {
      c.header('Strict-Transport-Security', 'max-age=31536000');
    }
    await next();
  };
}

export function requestLogger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const durationMs = Math.round((performance.now() - start) * 10) / 10;
    const path = c.req.path;
    const isQuiet = path === '/healthz' || /\.(css|js|svg|png|ico|webmanifest)$/.test(path);
    const fields = {
      method: c.req.method,
      path,
      status: c.res.status,
      durationMs,
      userId: c.get('user')?.id,
    };
    if (isQuiet) c.get('logger')?.debug('request', fields);
    else c.get('logger')?.info('request', fields);
  };
}
