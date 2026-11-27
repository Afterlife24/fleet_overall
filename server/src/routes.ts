import { Router } from 'express';
import { sessionRouter, type AuthRuntime } from './auth/index.js';
import { rejectAllMiddleware } from './auth/middleware.js';
import { appsRouter } from './modules/apps/index.js';
import { branchesRouter } from './modules/branches/index.js';
import { companyRouter } from './modules/company/index.js';
import { customerLposRouter } from './modules/customerLpos/index.js';
import { customersRouter } from './modules/customers/index.js';
import { customFieldsRouter } from './modules/customFields/index.js';
import { filesRouter, type FilesDeps } from './modules/files/index.js';
import { healthRouter } from './modules/health/index.js';
import { hireAgreementsRouter } from './modules/hireAgreements/index.js';
import { machineDocumentsRouter } from './modules/machineDocuments/index.js';
import { machinesRouter } from './modules/machines/index.js';
import { quotationsRouter } from './modules/quotations/index.js';
import { usersRouter } from './modules/users/index.js';
import { bookingsRouter } from './modules/bookings/index.js';
import { invoicesRouter } from './modules/invoices/index.js';
import { transportRouter } from './modules/transport/index.js';
import { collectionRouter } from './modules/collection/index.js';
import { documentsRouter } from './modules/documents/index.js';
import { gateRouter } from './modules/gate/index.js';

export interface RouteDeps {
  dbProbe: () => Promise<void>;
  /** Authentication. When absent every protected route answers 401 (fail closed). */
  auth?: AuthRuntime;
  /** File storage and verification; the files API is not mounted when absent. */
  files?: FilesDeps;
}

/** Builds the `/api/v1` router. Later tasks mount their module routers here, after the auth middleware. */
export function createApiRouter(deps: RouteDeps): Router {
  const router = Router();

  // Public routes.
  router.use(healthRouter(deps.dbProbe));
  if (deps.auth) router.use(deps.auth.publicRouter);

  // Everything below requires a verified credential.
  router.use(deps.auth ? deps.auth.middleware : rejectAllMiddleware);
  router.use(sessionRouter());
  if (deps.files) router.use(filesRouter(deps.files));

  // Company area (Requirement 9).
  router.use(companyRouter());
  router.use(branchesRouter());
  router.use(usersRouter());
  router.use(appsRouter());
  router.use(customFieldsRouter());

  // CRM chain: customers (Requirement 10), machine models, machines and machine documents (Requirement 11).
  router.use(customersRouter());
  router.use(machinesRouter());
  router.use(machineDocumentsRouter());

  // Quotations and phase history (Requirement 12), hire agreements (13) and customer LPOs (14).
  router.use(quotationsRouter());
  router.use(hireAgreementsRouter());
  router.use(customerLposRouter());

  // Rental chain: planner bookings and Start Hire, invoices, transport and collection, documents, gate and intake.
  router.use(bookingsRouter());
  router.use(invoicesRouter());
  router.use(transportRouter());
  router.use(collectionRouter());
  router.use(documentsRouter());
  router.use(gateRouter());

  return router;
}
