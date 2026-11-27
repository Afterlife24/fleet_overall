import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { AuthRuntime } from './auth/index.js';
import type { FilesDeps } from './modules/files/index.js';
import { AppError, toErrorBody } from './errors.js';
import { correlationMiddleware } from './logger.js';
import { createApiRouter } from './routes.js';

export interface AppOptions {
  logger: Logger;
  dbProbe: () => Promise<void>;
  /** Maximum JSON body size in bytes. */
  jsonBodyBytes: number;
  /** Directory holding the compiled frontend (index.html); omitted or missing => no SPA. */
  frontendDir?: string;
  /** Authentication runtime; protected routes answer 401 when omitted. */
  auth?: AuthRuntime;
  /** File storage dependencies; the files API is not mounted when omitted. */
  files?: FilesDeps;
}

/** JSON body parser with an exact byte limit; oversize => 413 via the error middleware. */
export function bodyLimit(maxBytes: number): RequestHandler {
  return express.json({ limit: maxBytes, type: ['application/json', 'application/*+json'] });
}

export const errorMiddleware: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const { status, body } = toErrorBody(err, req.correlationId);
  const log = req.log;
  if (status >= 500) log.error({ err, code: body.code }, 'request failed');
  else log.info({ code: body.code, status }, 'request rejected');
  res.status(status).json(body);
};

export function createApp(opts: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(correlationMiddleware(opts.logger));
  app.use(bodyLimit(opts.jsonBodyBytes));

  // 1. Business routes first (Requirement 2.1).
  app.use('/api/v1', createApiRouter({ dbProbe: opts.dbProbe, auth: opts.auth, files: opts.files }));

  // 2. Any other /api/ path is a JSON 404, never index.html (2.5).
  app.use('/api', (req, _res, next) => {
    next(new AppError('NOT_FOUND', `No route for ${req.method} ${req.originalUrl.split('?')[0]}`));
  });

  // 3. Frontend: static assets + SPA fallback, GET/HEAD only (2.6-2.8).
  const indexHtml = opts.frontendDir ? path.join(opts.frontendDir, 'index.html') : undefined;
  if (opts.frontendDir && indexHtml && existsSync(indexHtml)) {
    app.use(express.static(opts.frontendDir, { index: false }));
    app.use((req, res, next) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && path.extname(req.path) === '') {
        res.sendFile(indexHtml);
        return;
      }
      next();
    });
  }

  // 4. Everything else: JSON 404 (missing asset, unmatched non-GET).
  app.use((req, _res, next) => {
    next(new AppError('NOT_FOUND', `No route for ${req.method} ${req.path}`));
  });

  app.use(errorMiddleware);
  return app;
}
