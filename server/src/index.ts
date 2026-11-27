import { existsSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { createAuthRuntime } from './auth/index.js';
import { setTransactionPool } from './db/tx.js';
import { ConfigError, loadConfig } from './config.js';
import { createDbProbe, createPool } from './db/pool.js';
import { createLogger } from './logger.js';
import { createFileStorage } from './storage/index.js';
import { createVerificationAdapter } from './storage/verificationAdapter.js';
import { gracefulShutdown } from './shutdown.js';

// Local development reads ./.env like the migrate and seed scripts. Variables already set in the environment
// win, and the AWS package never contains a .env file, so Elastic Beanstalk settings are used there.
if (existsSync('.env')) process.loadEnvFile('.env');

// Startup never runs migrations or any schema work (Requirement 3.7).
const logger = createLogger({ level: process.env.LOG_LEVEL });

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    logger.error({ issues: err.safeIssues }, 'invalid configuration');
  } else {
    logger.error({ err }, 'configuration failed');
  }
  process.exit(1);
}

const pool = createPool(config.database, logger);
setTransactionPool(pool);

let auth;
try {
  auth = createAuthRuntime(config, pool);
} catch (err) {
  if (err instanceof ConfigError) {
    logger.error({ issues: err.safeIssues }, 'invalid authentication configuration');
  } else {
    logger.error({ err }, 'authentication setup failed');
  }
  process.exit(1);
}
let files;
try {
  files = {
    storage: createFileStorage(config),
    verifier: createVerificationAdapter(config),
    maxUploadBytes: config.storage.maxUploadBytes,
    environment: config.nodeEnv,
  };
} catch (err) {
  if (err instanceof ConfigError) logger.error({ issues: err.safeIssues }, 'invalid file storage configuration');
  else logger.error({ code: (err as { code?: string }).code }, 'file storage setup failed');
  process.exit(1);
}
// server/dist/index.js (and tsx server/src/index.ts) -> <repo>/dist
const frontendDir = path.resolve(import.meta.dirname, '../../dist');
const app = createApp({
  logger,
  dbProbe: createDbProbe(pool),
  jsonBodyBytes: config.limits.jsonBodyBytes,
  frontendDir,
  auth,
  files,
});

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, env: config.nodeEnv }, 'server listening');
});

let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    gracefulShutdown({ server, pool, logger, timeoutMs: config.limits.shutdownTimeoutMs, signal })
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  });
}
