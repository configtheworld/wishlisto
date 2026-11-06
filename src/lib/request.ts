import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import type { Config } from '../config.js';

interface NodeEnv {
  incoming?: { socket?: { remoteAddress?: string } };
}

export function clientIp(c: Context<AppEnv>, config: Config): string {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    const real = c.req.header('x-real-ip');
    if (real) return real.trim();
  }
  const env = c.env as unknown as NodeEnv | undefined;
  return env?.incoming?.socket?.remoteAddress ?? '127.0.0.1';
}
