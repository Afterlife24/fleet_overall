import { Router } from 'express';
import { AppError } from '../../errors.js';

/** live: no dependency checks. ready: one trivial DB query; no connection details leak. */
export function healthRouter(probe: () => Promise<void>): Router {
  const router = Router();
  router.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  router.get('/health/ready', async (_req, res, next) => {
    try {
      await probe();
      res.status(200).json({ status: 'ready' });
    } catch {
      next(new AppError('SERVICE_UNAVAILABLE', 'Database is not reachable', {}, true));
    }
  });
  return router;
}
