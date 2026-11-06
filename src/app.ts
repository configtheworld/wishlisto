import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppEnv } from './types.js';
import type { Config } from './config.js';
import type { DB } from './db/index.js';
import { createLogger } from './lib/logger.js';
import type { Logger } from './lib/logger.js';
import { requestLogger, securityHeaders } from './middleware/security.js';
import { csrfMiddleware, sessionMiddleware } from './middleware/session.js';
import { localeMiddleware } from './middleware/auth.js';
import { requirePasswordChangeComplete } from './middleware/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerListRoutes } from './routes/lists.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerGroupRoutes } from './routes/groups.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerClaimRoutes } from './routes/claims.js';
import { notFound, payloadTooLarge, renderError } from './views/errors.js';
import { loadSiteConfig } from './lib/site.js';
import { paletteCss } from './lib/palette.js';

export interface AppDependencies {
  config: Config;
  db: DB;
  logger?: Logger;
}

const STATIC_ASSETS = ['/app.css', '/app.js', '/theme.js', '/favicon.svg'];

export function createApp({ config, db, logger = createLogger(config.logLevel) }: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const site = loadSiteConfig(config.siteConfigPath);

  app.use('*', async (c, next) => {
    c.set('config', config);
    c.set('site', site);
    c.set('db', db);
    c.set('logger', logger);
    c.set('user', null);
    c.set('session', null);
    c.set('locale', 'en');
    c.set('csrfToken', '');
    c.set('form', null);
    await next();
  });

  app.use('*', requestLogger());
  app.use('*', securityHeaders(config));

  // Colour tokens from site.json, served as a file: inline styles would break the strict CSP.
  const tokensCss = paletteCss(site.colors);
  app.get('/theme-tokens.css', (c) => {
    c.header('Content-Type', 'text/css; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(tokensCss);
  });

  for (const asset of STATIC_ASSETS) {
    app.use(asset, async (c, next) => {
      await next();
      if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=300');
    });
    app.use(asset, serveStatic({ root: config.publicDir }));
  }

  app.use(
    '*',
    bodyLimit({
      maxSize: config.maxUploadBytes + 1024 * 1024,
      onError: (c) => payloadTooLarge(c),
    }),
  );

  app.use('*', sessionMiddleware(db, config));
  app.use('*', localeMiddleware);
  app.use('*', csrfMiddleware);
  app.use('*', requirePasswordChangeComplete);

  registerAuthRoutes(app);
  registerSettingsRoutes(app);
  registerGroupRoutes(app);
  registerAdminRoutes(app);
  registerListRoutes(app);
  registerClaimRoutes(app);

  app.notFound((c) => notFound(c));

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      if (error.status === 413) return payloadTooLarge(c);
      return renderError(c, error.status === 401 || error.status === 403 ? error.status : 500, 'errors.serverTitle', 'errors.serverText');
    }
    c.get('logger')?.error('request.failed', {
      error: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      path: c.req.path,
      method: c.req.method,
    });
    return renderError(c, 500, 'errors.serverTitle', 'errors.serverText');
  });

  return app;
}
