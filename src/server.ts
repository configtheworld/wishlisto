import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createLogger } from './lib/logger.js';
import { ensureEnvAdmin } from './lib/bootstrap.js';
import { createApp } from './app.js';

// Load .env for local/dev and plain `node dist/server.js` deployments.
// Existing environment variables (Docker, systemd, shell) take precedence.
try {
  process.loadEnvFile(process.env.ENV_FILE ?? '.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = openDatabase(config);

try {
  await ensureEnvAdmin(db, config, logger);
} catch (error) {
  logger.error('startup.admin_failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  db.close();
  process.exit(1);
}

const app = createApp({ config, db, logger });
const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    logger.info('server.started', {
      host: info.address,
      port: info.port,
      env: config.env,
      baseUrl: config.baseUrl,
    });
  },
);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.stopping', { signal });

  const force = setTimeout(() => {
    logger.warn('server.forced_exit');
    db.close();
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close((error) => {
    clearTimeout(force);
    if (error) logger.error('server.close_failed', { message: error.message });
    try {
      db.close();
    } catch (closeError) {
      logger.error('server.database_close_failed', {
        message: closeError instanceof Error ? closeError.message : String(closeError),
      });
    }
    process.exit(error ? 1 : 0);
  });
  const withIdleClose = server as unknown as { closeIdleConnections?: () => void };
  withIdleClose.closeIdleConnections?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (error) => {
  logger.error('process.uncaught_exception', { message: error.message });
  shutdown('uncaughtException');
});
