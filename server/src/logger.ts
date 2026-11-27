import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import pino, { type DestinationStream, type Logger } from 'pino';

const SECRET_KEYS = [
  'authorization', 'cookie', 'set-cookie', 'password', 'passwd', 'token', 'accessToken',
  'refreshToken', 'idToken', 'secret', 'clientSecret', 'apiKey', 'connectionString',
  'databaseUrl', 'url', 'dsn',
];

/** Paths redacted at the top level and one and two levels deep. */
export const REDACT_PATHS: string[] = SECRET_KEYS.flatMap((k) => [
  k, `*.${k}`, `*.*.${k}`, `req.headers.${k}`,
]).filter((p, i, a) => a.indexOf(p) === i);

// postgres://user:pass@host/db style strings inside free-text messages
const CONNECTION_STRING = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]*@[^\s'"]*/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function scrubText(text: string): string {
  return text.replace(CONNECTION_STRING, '[REDACTED]').replace(BEARER, 'Bearer [REDACTED]');
}

export function createLogger(opts: { level?: string; destination?: DestinationStream } = {}): Logger {
  return pino(
    {
      level: opts.level ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      formatters: { level: (label) => ({ level: label }) },
      hooks: {
        logMethod(args, method) {
          // Scrub connection strings / bearer tokens embedded in message text.
          const patched = args.map((a) => (typeof a === 'string' ? scrubText(a) : a)) as typeof args;
          return method.apply(this, patched);
        },
      },
      serializers: {
        err: (e: unknown) => {
          if (e instanceof Error) {
            return { type: e.name, message: scrubText(e.message), stack: e.stack ? scrubText(e.stack) : undefined };
          }
          return { message: scrubText(String(e)) };
        },
      },
    },
    opts.destination,
  );
}

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
    log: Logger;
  }
}

/** Assigns a server-generated correlation id and a request-scoped child logger. */
export function correlationMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = randomUUID();
    req.correlationId = correlationId;
    req.log = logger.child({ correlationId });
    res.setHeader('X-Correlation-Id', correlationId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      req.log.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        },
        'request',
      );
    });
    next();
  };
}
