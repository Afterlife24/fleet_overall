# Design Document

## Overview

Stage 1 adds a real Node.js/TypeScript/Express backend and PostgreSQL schema behind the existing React/Vite frontend, and moves the CRM chain (company, customers, fleet, quotations, hire agreements, LPOs) off mock services and zustand-persisted stores onto that backend. The backend and frontend are built and deployed as one application (handoff §1–§3); this design covers the Stage 1 slice only: foundation (config, errors, health, migrations, RLS, auth boundary, file storage, build/package) and the CRM chain vertical slice.

Guiding decisions carried through every section:

- **No Odoo collision.** The application uses its own PostgreSQL roles (`fleet_owner`, `fleet_migrator`, `fleet_app`) and its own databases (`fleet_local`, `fleet_test`), never `odoo_dev`/`odoo`. The migration runner refuses any target whose name matches a configured denylist that includes `odoo_dev`.
- **Server code is isolated from browser code.** `server/` has its own `tsconfig.json`, compiles to ESM in `server/dist/`, and never imports from `src/store/*` or `src/services/*`. A `shared/` folder holds DTO/type contracts importable by both sides without pulling in zustand or browser-only modules.
- **Tenant isolation is enforced twice**: application-level (`Transaction_Helper` always sets `app.org_id` before any query) and database-level (`FORCE ROW LEVEL SECURITY` policies compare `org_id` to `current_setting('app.org_id', true)`), so a bug in one layer does not expose another tenant's rows.
- **Dev-fixture auth is a real, narrow authentication path**, not a bypass: it issues a short-lived JWT signed with a dev-only HS256 secret for exactly the preseeded `DEV_AUTH_USER_ID`, verified through the same `jose`-based verification code path used for OIDC RS256 tokens in production, so the auth middleware has one verification code path and only the key material/issuer differ.

## Architecture

### Component map

```mermaid
flowchart TB
    subgraph Browser
        UI[React screens: Customers, Fleet, CRM, Hire Agreement, LPO]
        RQ[React Query]
        APIClient[src/services/api http client]
        UI --> RQ --> APIClient
    end

    subgraph "Express app (server/src)"
        MW1[correlationId + jsonLogger]
        MW2[bodyLimit]
        MW3[authMiddleware: OIDC_Adapter / Dev_Fixture_Auth]
        MW4[idempotencyMiddleware]
        Router["/api/v1 routers (modules/*)"]
        Err[errorMiddleware]
        SPA[staticFrontendFallback]
        MW1 --> MW2 --> MW3 --> Router
        Router --> Err
        Router --> SPA
    end

    subgraph modules
        Company[modules/company]
        Customers[modules/customers]
        Fleet[modules/machines]
        CRM[modules/quotations]
        HA[modules/hireAgreements]
        LPO[modules/customerLpos]
        Health[modules/health]
    end
    Router --> Company & Customers & Fleet & CRM & HA & LPO & Health

    subgraph db["server/src/db"]
        Pool[pg Pool]
        TxHelper[Transaction_Helper]
        IdentityResolver["SECURITY DEFINER identity_resolver()"]
    end
    Company & Customers & Fleet & CRM & HA & LPO --> TxHelper --> Pool
    MW3 --> IdentityResolver

    subgraph storage["server/src/storage"]
        FS[FileStorage interface]
        Local[LocalStorageAdapter]
        S3[S3StorageAdapter]
        FS --> Local
        FS --> S3
    end
    Fleet --> FS

    PG[(PostgreSQL: fleet_local / RDS later)]
    Pool --> PG
    APIClient -- "fetch /api/v1 (Vite proxy in dev)" --> MW1
```

### Request lifecycle (mutating request)

```mermaid
sequenceDiagram
    participant C as API_Client
    participant E as Express middleware
    participant A as authMiddleware
    participant I as idempotencyMiddleware
    participant S as Service (e.g. quotations)
    participant T as Transaction_Helper
    participant D as PostgreSQL (RLS on)

    C->>E: POST /api/v1/quotations {Idempotency-Key, If-Match?}
    E->>A: verify token -> Principal
    A->>D: SELECT identity_resolver(subject) [no Tenant_Context yet]
    D-->>A: user, org_id, role, branch_scope
    A->>I: Principal attached to req
    I->>D: claim idempotency key (inside tx, see below)
    I->>S: forward if new / short-circuit if replay
    S->>T: run(orgId, fn)
    T->>D: BEGIN; SET LOCAL app.org_id; work; COMMIT
    D-->>T: rows (RLS-filtered)
    T-->>S: result
    S-->>E: 201 + body
    E-->>C: JSON {data, correlationId}
```

### Repository layout (handoff §5, decision)

```text
fleet_overall/
  src/                         existing frontend (unchanged structure)
    services/api/              new: typed HTTP adapters (replaces mock authority for CRM chain)
  shared/
    dto/                       DTO/zod schemas shared by server + src/services/api (no store imports)
  server/
    src/
      app.ts                   Express app construction + middleware wiring
      index.ts                 config validation, pool creation, listen, graceful shutdown
      config.ts                zod-validated env parsing (Requirement 1)
      logger.ts                JSON logger (pino) with correlationId + redaction
      errors.ts                AppError hierarchy + error -> HTTP mapping (Requirement 2)
      auth/
        oidcAdapter.ts          jose-based OIDC verification
        devFixtureAuth.ts       POST /api/v1/dev/session, HS256 fixture tokens
        principal.ts            Principal type + permission/action allowlist
        middleware.ts
      db/
        pool.ts                  pg Pool + TLS option builder
        tx.ts                     Transaction_Helper
        identityResolver.sql.ts   calls SECURITY DEFINER fn
      modules/
        health/
        company/                 organizations, branches, roles, users, organization_apps, custom_field_definitions
        customers/
        machines/                machine_models, machines, machine_documents
        quotations/              quotations, quotation_phase_history
        hireAgreements/
        customerLpos/
        shared/                  numberAllocator.ts, idempotency.ts, audit.ts, pagination.ts
      storage/
        fileStorage.ts           interface
        localStorageAdapter.ts
        s3StorageAdapter.ts
        uploadValidator.ts
        verificationAdapter.ts   development-stub only in this stage
    migrations/
      0001_extensions_roles.sql
      0002_company_users.sql
      0003_customer_fleet.sql
      0004_crm.sql
      0005_bookings_invoices.sql
      0006_transport.sql
      0007_gate_collection_docs.sql
      0008_documents_files_evidence.sql
      0009_numbering_idempotency_audit.sql
      0010_rls_and_grants.sql
    scripts/
      migrate.ts                 Migration_Runner CLI
      seedDev.ts                 Seed_Command CLI
      packageAws.ts               Package_Command CLI
    tests/
      unit/                       config, upload validator, storage keys, transitions, number formatting
      integration/                 real fleet_test DB: schema, RLS, concurrency, idempotency
    tsconfig.json                 own ESM config, composite off, outDir ../server/dist
  dist/                           compiled frontend (unchanged, generated)
  Procfile
  .platform/nginx/conf.d/
  package.json                    adds root scripts (decision list below)
```

`shared/dto/*` is imported by both `server/src/modules/*` (for request/response validation) and `src/services/api/*` (for response typing), and must not import anything from `src/store` or `src/services/services.ts`. This keeps the constraint from handoff §5 ("Shared DTO/types must not import browser stores into backend code") mechanically enforceable by `eslint` import boundaries (see Testing Strategy).

### Library choices (decision + justification)

| Concern | Library | Why |
|---|---|---|
| HTTP server | `express` | Already the handoff-mandated choice; minimal, serves both API and compiled frontend. |
| PostgreSQL driver | `pg` | handoff-mandated; supports explicit TLS options and transaction-scoped `SET LOCAL`. |
| Validation | `zod` | Already a frontend dependency (v4); one validation library end-to-end, DTOs can be shared. |
| Decimal math | `decimal.js` | Avoids float error in VAT/subtotal/total math (Requirement 13.7); npm-maintained, no native deps. |
| OIDC + dev JWT | `jose` | Single library verifies RS256 (real OIDC, via remote JWKS) and HS256 (dev fixture) with the same `jwtVerify` call shape, so `auth/middleware.ts` has one code path regardless of `AUTH_MODE`. |
| S3 | `@aws-sdk/client-s3` | handoff-mandated v3 SDK; injected client makes unit testing with a mock client straightforward (Requirement 7.12). |
| Logging | `pino` | Fast structured JSON logger with built-in redaction paths, satisfies Requirement 2.14 (correlation id present, secrets omitted) with a documented redaction list rather than hand-rolled string scrubbing. |
| Migration runner | in-house (`scripts/migrate.ts`) | The ledger/checksum/advisory-lock/denylist rules (Requirement 3) are small and project-specific (Odoo denylist, test-db-name guard); an off-the-shelf runner (e.g. `node-pg-migrate`) would need the same custom wrapper anyway, so a ~150-line in-house runner avoids a dependency that doesn't fit the denylist/ledger requirements. |
| ZIP packaging | `archiver` | Streams a deterministic ZIP without shelling out to a platform-specific `zip` binary (Windows dev machine has none by default). |
| Dev process orchestration | two documented terminals (`npm run dev` = Vite, `npm run dev:server` = `tsx watch server/src/index.ts`) | `concurrently` is optional sugar; the handoff explicitly allows "document both separate processes if no combined runner is used" (handoff §5), and two terminals are simpler to reason about when one needs restarting (e.g. after an env change) without touching Vite. `dev:server` uses `tsx` only in development; the compiled path (`npm start`) never uses `tsx`. |

### Dev-fixture authentication flow (decision)

```mermaid
sequenceDiagram
    participant FE as Frontend auth adapter
    participant S as POST /api/v1/dev/session
    participant J as jose (HS256, dev secret)
    participant M as authMiddleware (all other routes)

    Note over S: Only registered when AUTH_MODE=development-fixture,<br/>NODE_ENV in {development,test}, ALLOW_DEV_AUTH=true, HOST is loopback
    FE->>S: POST /api/v1/dev/session {} (no credentials accepted)
    S->>S: load fixture user by DEV_AUTH_USER_ID (ignore any body fields)
    S->>J: sign {sub: user.auth_subject, iss: 'fleet-dev-fixture'} exp=15m
    J-->>S: token
    S-->>FE: {token, user: {id, displayName, authMode: 'development-fixture'}}
    FE->>FE: store token in memory (not localStorage as authority)
    FE->>M: subsequent requests: Authorization: Bearer <token>
    M->>J: jwtVerify(token, devSecret, {issuer:'fleet-dev-fixture'})
    M->>M: resolve Principal via identity_resolver (same path as OIDC)
```

`GET /api/v1/session` always reports the active `authMode` (`'oidc' | 'development-fixture'`) so the frontend can show a visible "Dev Fixture Auth" badge (Requirement 6.8), distinct from a real login.

### Row-level security model (decision)

- Every organization-scoped table gets: `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;` plus one policy:
  ```sql
  CREATE POLICY tenant_isolation ON <table>
    USING (org_id = current_setting('app.org_id', true)::uuid)
    WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
  ```
  `current_setting(..., true)` returns `NULL` (not an error) when unset, so a query with no `Tenant_Context` compares `org_id = NULL`, which is never true — satisfying Requirement 5.5 (zero rows, inserts rejected) without a special-cased policy.
- `Transaction_Helper.run(orgId, fn)` always does `BEGIN` → `SELECT set_config('app.org_id', $1, true)` (transaction-local, so it cannot leak across pooled connections after `COMMIT`/`ROLLBACK`) → `fn(client)` → `COMMIT`/`ROLLBACK` → release.
- `Runtime_Role` (`fleet_app`) is granted `SELECT, INSERT, UPDATE, DELETE` on business tables (no `UPDATE/DELETE` on append-only tables — revoked explicitly), is not the owner, and has no `BYPASSRLS`. `Migration_Role` (`fleet_migrator`) owns the schema and runs migrations; `fleet_owner` is the bootstrap superuser-equivalent used only to create the other two roles and the database itself.
- `identity_resolver(auth_subject text) RETURNS TABLE(user_id uuid, org_id uuid, role_code text, branch_id uuid, all_branches boolean)` is `SECURITY DEFINER`, owned by `fleet_migrator`, with `SET search_path = public, pg_temp` fixed on the function, and is the only function callable by `fleet_app` that reads `users` before `Tenant_Context` exists (Requirement 5.9, 6.4).

## Components and Interfaces

### Config_Loader (`server/src/config.ts`)

```ts
export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  appPublicUrl: string;
  database: { url: string; migrationUrl: string; sslMode: 'disable'|'require'|'verify-ca'|'verify-full'; caFile?: string; poolMax: number };
  storage: { driver: 'local'|'memory'|'s3'; localRoot?: string; maxUploadBytes: number; aws?: { region: string; bucket: string; keyPrefix: string } };
  auth: { mode: 'oidc'|'development-fixture'; allowDevAuth: boolean; devAuthUserId?: string; oidc?: { issuer: string; audience: string; jwksUrl: string } };
  fileScanDriver: 'development-stub' | 'approved-scanner';
}

/** Throws ConfigError; caller (index.ts) logs config.safeIssues() and exits(1). */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig;
export class ConfigError extends Error { readonly safeIssues: string[]; }
```

`loadConfig` runs one zod schema per Requirement 1.1, then a second pass of cross-field refinements for the production guards (1.3–1.9) and the `DATABASE_SSL_MODE` → pg `ssl` options builder (1.10, exposed as `buildPgSsl(mode, caFile)` for reuse by `db/pool.ts` and unit tests).

### Errors (`server/src/errors.ts`)

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'STALE_VERSION' | 'DUPLICATE' | 'IDEMPOTENCY_KEY_REQUIRED' | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_TRANSITION' | 'AGREEMENT_EXISTS' | 'IMMUTABLE_FIELD' | 'FILE_INVALID'
  | 'QR_INVALID' | 'STORAGE_NOT_CONFIGURED' | 'SERVICE_UNAVAILABLE';

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number,
    public fieldErrors: Record<string,string> = {}, public retryable = false) { super(message); }
}
export interface ErrorResponseBody {
  code: ErrorCode; message: string; fieldErrors: Record<string,string>;
  correlationId: string; retryable: boolean;
}
/** Pure mapper used by the error middleware and by unit tests. */
export function toErrorBody(err: unknown, correlationId: string): { status: number; body: ErrorResponseBody };
```

The status table (Requirement 2.15) is encoded once in `toErrorBody`: `UNAUTHENTICATED→401, FORBIDDEN→403, NOT_FOUND→404, STALE_VERSION|DUPLICATE|AGREEMENT_EXISTS→409, VALIDATION_ERROR|INVALID_TRANSITION|IMMUTABLE_FIELD|FILE_INVALID|QR_INVALID→422, SERVICE_UNAVAILABLE→503`.

### Transaction_Helper and Number_Allocator (`server/src/db`, `server/src/modules/shared`)

```ts
// db/tx.ts
export interface TxClient { query: pg.Pool['query']; }
export async function withTransaction<T>(orgId: string, fn: (tx: TxClient) => Promise<T>): Promise<T>;

// modules/shared/numberAllocator.ts
export interface SequenceRow { sequenceKind: string; sequenceYear: number; quotationId?: string; nextValue: bigint; minWidth: number; prefix: string }
/** Pure formatter — never array length, unlocked MAX+1, or timestamp. */
export function formatNumber(row: Pick<SequenceRow,'prefix'|'sequenceYear'|'nextValue'|'minWidth'>): string;
/** Locks the row (SELECT … FOR UPDATE), increments, returns the formatted number. Must run inside withTransaction. */
export async function allocateNumber(tx: TxClient, orgId: string, kind: string, opts: { year?: number; quotationId?: string }): Promise<string>;

// modules/shared/idempotency.ts
export async function claimIdempotencyKey(tx: TxClient, orgId: string, operation: string, key: string, requestHash: string):
  Promise<{ kind: 'new' } | { kind: 'replay'; status: number; body: unknown } | never /* throws 409 on hash mismatch */>;

// modules/shared/audit.ts
export async function recordAudit(tx: TxClient, orgId: string, event: {
  actorUserId?: string; action: string; entityType: string; entityId?: string;
  correlationId: string; reason?: string; before?: unknown; after?: unknown;
}): Promise<void>; // redacts password/token/secret-like keys before insert
```

### Quotation phase transitions (`server/src/modules/quotations/transitions.ts`)

This is the server-side equivalent of `src/features/crm/crmRules.ts`, extended with the Requirement 12.4 rule change (manual AWAITING→WON allowed) and the reopen permission check:

```ts
export type Phase = 'AWAITING' | 'TENDER' | 'LOST' | 'WON';
export interface TransitionRequest { from: Phase; to: Phase; reason?: string; hasReopenPermission: boolean }
export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: 'INVALID_TRANSITION' | 'VALIDATION_ERROR' | 'FORBIDDEN'; fieldErrors?: Record<string,string> };

/** Pure. For all (from,to) pairs: allowed set is exactly
 *  {AWAITING->TENDER, AWAITING->LOST, AWAITING->WON, TENDER->WON, TENDER->LOST, LOST->AWAITING}.
 *  LOST transitions and LOST->AWAITING require a trimmed 1..500 char reason;
 *  LOST->AWAITING additionally requires hasReopenPermission. */
export function checkTransition(req: TransitionRequest): TransitionCheck;
```

`src/features/crm/crmRules.ts` is updated in lockstep (Requirement 12.4 explicitly requires this) so `ALLOWED` gains `['Awaiting','Won']`, and `crmRules.test.ts` is updated, not deleted (Requirement 18.14).

### File_Storage (`server/src/storage/fileStorage.ts`)

```ts
export interface PutInput { key: string; body: AsyncIterable<Uint8Array>; contentType: string; maxBytes: number }
export interface PutResult { key: string; bytes: number; sha256: string }
export interface FileStorage {
  put(input: PutInput): Promise<PutResult>;
  head(key: string): Promise<{ bytes: number; contentType?: string } | null>;
  read(key: string): Promise<AsyncIterable<Uint8Array>>;
  removeUnattached(key: string): Promise<void>;
}
export function generateKey(env: string, orgId: string, fileId: string, originalName: string): string; // environment/orgUUID/fileUUID/original.<ext>
export function assertSafeKey(key: string): void; // throws FILE_INVALID on traversal/absolute/drive-letter
```

`LocalStorageAdapter` resolves `LOCAL_STORAGE_ROOT` once (outside `dist/`, `src/`, any public dir), writes to `<key>.part` then renames. `S3StorageAdapter` takes an injected `S3Client` constructor parameter so tests supply a mock (`@aws-sdk/client-s3` `S3Client` with mocked `send`).

### Upload_Validator (`server/src/storage/uploadValidator.ts`)

```ts
export type DeclaredType = 'application/pdf' | 'image/png' | 'image/jpeg';
export function validateUpload(bytes: Uint8Array, declaredType: DeclaredType, maxBytes: number):
  { ok: true } | { ok: false; code: 'FILE_INVALID' };
```
Checks leading-byte signatures (`%PDF-`, PNG `89 50 4E 47`, JPEG `FF D8 FF`) against `declaredType`, and `1 <= bytes.length <= maxBytes`.

### Frontend API client (`src/services/api/`)

```ts
// src/services/api/http.ts
export interface ApiError { code: string; message: string; fieldErrors: Record<string,string>; correlationId: string; retryable: boolean }
export class ApiClientError extends Error implements ApiError { code: string; fieldErrors: Record<string,string>; correlationId: string; retryable: boolean }
/** Maps a Response's JSON error body onto ApiClientError without losing code/fieldErrors/correlationId. */
export function mapErrorBody(body: unknown, fallbackCorrelationId: string): ApiClientError;

export interface RequestOptions { idempotencyKey?: string; ifMatch?: string; signal?: AbortSignal }
export async function apiRequest<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T>;

// src/services/api/idempotency.ts
/** One key per logical user submit action; the same key is returned for repeat calls with the same actionId
 *  until clearSubmission(actionId) is called (on success or explicit user-initiated new submission). */
export function getOrCreateIdempotencyKey(actionId: string): string;
export function clearSubmission(actionId: string): void;

// src/services/api/customers.ts (representative resource module; machines/quotations/hireAgreements/customerLpos follow the same shape)
export const customersApi = {
  list(params: { orgId: string; branchId?: string; status?: string; q?: string; page?: number }): Promise<Paged<CustomerDto>>,
  get(id: string): Promise<CustomerDto>,
  create(input: CustomerCreateDto, idempotencyKey: string): Promise<CustomerDto>,
  update(id: string, input: CustomerUpdateDto, rowVersion: number): Promise<CustomerDto>, // sends If-Match
  archive(id: string, rowVersion: number): Promise<CustomerDto>,
};
```

React Query keys include org/branch/filters per Requirement 15.6, e.g. `['customers', orgId, branchId, status, q, page]`; `src/app/QueryProvider.tsx`'s existing `resetQueryCache()` call on login/logout/org-switch (already wired in `authStore.ts`) satisfies Requirement 15.7 without new wiring, and is extended to also cancel in-flight queries (`queryClient.cancelQueries()` before `clear()`).

### Retained-screen read adapters (Requirement 15.18)

Planner, invoices, transport, collection, gate and inspection screens keep reading `customerService`, `machineService` and `crmStore`/`hireAgreementStore` shapes from `src/services/services.ts` unchanged in this stage. To avoid breaking them while customers/machines/quotations/hire-agreements move to the API, `services.ts`'s `customerService`, `machineService` bodies are changed internally to call `customersApi.list()`/`machinesApi.list()` and map the DTO back to the existing `Customer`/`Machine` shapes those screens already consume — the exported function signatures (`list()`, `get(id)`) do not change, so no retained screen's import needs to change. `crmStore`/`hireAgreementStore` are replaced for CRM screens by React Query hooks against `quotationsApi`/`hireAgreementsApi`, but a thin read-only selector (`src/services/api/readAdapters.ts`) exposes `quotationsApi.list()` results in the `Quotation[]` shape `customerLinks.ts`, `quotationInvoicing.ts` and `collectionDocs.ts` already expect, so those retained-scope consumers keep compiling and passing their existing tests (Requirement 15.17).

## Data Models

Full column-level contracts (types, defaults, enums, checks, uniques) are specified in `DATABASE_DESIGN.md` §3 and are not repeated here; this section maps each table to its migration file and states only the Stage-1-relevant summary and cross-references, per Requirement 4.

Every table except `organizations` has `id uuid default gen_random_uuid()`, `org_id uuid`, `UNIQUE(org_id,id)`; every mutable table additionally has `created_at`, `updated_at`, `created_by`, `updated_by`, `row_version bigint default 1` (DATABASE_DESIGN.md §2). Append-only tables (marked **A**) have `created_at`/`created_by` only and reject UPDATE/DELETE for `fleet_app`.

| Migration file | Tables | Notes |
|---|---|---|
| `0001_extensions_roles.sql` | *(infra only)* `schema_migrations` (Migration_Ledger: `version, name, checksum, applied_at`) | `CREATE EXTENSION IF NOT EXISTS btree_gist;` Creates `fleet_app` role grants (tables created later get grants in `0010`). |
| `0002_company_users.sql` | `organizations`, `branches`, `roles`, `users`, `organization_apps`, `custom_field_definitions` | `users.created_by/updated_by` cyclic FK added after table creation in the same file (DATABASE_DESIGN.md §2). `organizations.gating_rules` validated at the application layer against the exact 7-boolean shape (DATABASE_DESIGN.md §3.1). |
| `0003_customer_fleet.sql` | `customers`, `machine_models`, `machines`, `machine_documents` | `machine_documents.file_id` FK forward-declared against `files` created in `0008`; added as a deferred FK at end of `0008` instead to avoid forward references. |
| `0004_crm.sql` | `quotations`, `quotation_phase_history` **A**, `hire_agreements`, `customer_lpos` | `uq_live_quote_agreement` partial unique index (DATABASE_DESIGN.md §5.1) created here. |
| `0005_bookings_invoices.sql` | `bookings`, `invoices`, `invoice_lines` | Created for schema completeness (Requirement 4.1); no booking/invoice API in this stage (Out of scope). `ex_machine_planned_booking`, `ex_machine_physical_booking`, `ex_quote_invoice_overlap`, `ck_booking_dates`, `ck_actual_booking_return`, `ck_invoice_dates` created here per DATABASE_DESIGN.md §5.1. |
| `0006_transport.sql` | `drivers`, `transport_vehicles`, `transport_jobs` | Schema only, no API this stage. |
| `0007_gate_collection_docs.sql` | `gate_passes`, `gate_movements` **A**, `collection_notes`, `mqd_reports`, `third_party_service_reports`, `third_party_service_lines`, `delivery_notes` | Schema only, no API this stage. |
| `0008_documents_files_evidence.sql` | `files`, `documents`, `document_versions`, `document_files`, `evidence_attachments` | `documents.current_version_id` cyclic FK to `document_versions` added at end of file. Deferred `machine_documents.file_id` FK added here. |
| `0009_numbering_idempotency_audit.sql` | `number_sequences`, `idempotency_keys`, `audit_events` **A** | `uq_open_collection` partial unique index also created here (co-located with idempotency/number infra per DATABASE_DESIGN.md §5.1 grouping). |
| `0010_rls_and_grants.sql` | *(policies + grants only, no new tables)* | `ENABLE/FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy on every org-scoped table; `GRANT`/`REVOKE` to `fleet_app` including revoking UPDATE/DELETE on `quotation_phase_history`, `gate_movements`, `audit_events`; creates `identity_resolver()`. |

**Infrastructure ledger** (not one of the 37 business tables, per Requirement 3.1/4.1):

```sql
CREATE TABLE schema_migrations (
  version       text PRIMARY KEY,
  name          text NOT NULL,
  checksum      char(64) NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now()
);
```

**Tenant/role separation at the database level:**

```sql
CREATE ROLE fleet_owner LOGIN PASSWORD '...';         -- local bootstrap only, never used by the app
CREATE ROLE fleet_migrator LOGIN PASSWORD '...';       -- MIGRATION_DATABASE_URL; owns all schema objects
CREATE ROLE fleet_app LOGIN PASSWORD '...' NOBYPASSRLS; -- DATABASE_URL (Runtime_Role); not table owner
```

`fleet_app` is never granted `BYPASSRLS` and is never the owner of any table (Requirement 5.2).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Production configuration guard is total over the guard predicate table

For all environment records and for all of {AUTH_MODE, STORAGE_DRIVER, DATABASE_SSL_MODE, FILE_SCAN_DRIVER, and the blank/placeholder fields DATABASE_URL/APP_PUBLIC_URL/OIDC_ISSUER/OIDC_AUDIENCE/OIDC_JWKS_URL/S3_BUCKET/AWS_REGION}, when NODE_ENV is production, `loadConfig` rejects the configuration if and only if at least one of: AUTH_MODE is development-fixture, STORAGE_DRIVER is local or memory, DATABASE_SSL_MODE is not verify-full, FILE_SCAN_DRIVER is development-stub, or one of the listed fields is blank or an unresolved placeholder.

**Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.7**

### Property 2: s3-mode storage configuration completeness

For all environment records with STORAGE_DRIVER=s3, `loadConfig` accepts the configuration if and only if AWS_REGION, S3_BUCKET and S3_KEY_PREFIX are all non-blank and contain no unresolved placeholder value.

**Validates: Requirements 1.8**

### Property 3: Non-disabled SSL modes never disable certificate verification

For all DATABASE_SSL_MODE values other than `disable`, the pg connection options produced by `buildPgSsl` never set `rejectUnauthorized` to `false`, and always include hostname/certificate verification.

**Validates: Requirements 1.10**

### Property 4: Every mapped error produces a complete, correctly shaped body

For all error values thrown inside a request (AppError instances, zod validation errors, and unmapped exceptions), `toErrorBody` returns a body containing exactly the fields `code`, `message`, `fieldErrors`, `correlationId`, `retryable`, with the given `correlationId`, and the status matches the fixed code→status table in Requirement 2.15.

**Validates: Requirements 2.2, 2.3, 2.15**

### Property 5: Invalid request bodies map to 422 with a field error per invalid field and no raw SQL

For all zod `SafeParseError` results produced by validating a request body, the mapped response has status 422, contains one `fieldErrors` entry per failing path, and the `message` and `fieldErrors` values contain no SQL keywords or table names from the schema.

**Validates: Requirements 2.4**

### Property 6: Oversized bodies are rejected at the configured limit

For all request body byte lengths, the body-size middleware passes the request through if and only if the length is less than or equal to the configured maximum, and rejects with 413 otherwise.

**Validates: Requirements 2.12**

### Property 7: Migration checksum mismatch is always detected

For all pairs of (originally applied file content, later-read file content) that differ, the Migration_Runner's checksum comparison reports a mismatch for that version; for all pairs that are byte-identical, no mismatch is reported.

**Validates: Requirements 3.4**

### Property 8: Migration target database name denylist is total

For all candidate target database names, the Migration_Runner refuses to run if and only if the name equals the application's own non-test database name's forbidden counterpart (the Odoo database name, e.g. `odoo_dev`) or does not match the configured application/test naming pattern.

**Validates: Requirements 3.9, 3.11**

### Property 9: Cross-organization foreign keys are always rejected

For all pairs of (child row, parent row) where the child's foreign id references the parent's id but the child's `org_id` differs from the parent's `org_id`, the database rejects the insert or update with a foreign key violation.

**Validates: Requirements 4.7**

### Property 10: Machine booking overlap exclusion is total over date ranges and statuses

For all pairs of bookings for the same machine and organization, inserting the second row succeeds if and only if its date range does not overlap the first row's date range, or at least one of the two rows has a status outside {Reserved, Pending Approval, Approved, Allocated, On Hire}.

**Validates: Requirements 4.11**

### Property 11: At most one non-cancelled hire agreement per quotation

For all sequences of hire_agreements rows inserted for one quotation, at most one row with status other than Cancelled exists at any time; inserting a second non-cancelled row for the same quotation is always rejected.

**Validates: Requirements 4.12**

### Property 12: Hire agreement customer must equal quotation customer

For all (hire_agreement, quotation) pairs, the insert or update succeeds if and only if the hire_agreement's customer_id equals the quotation's customer_id.

**Validates: Requirements 4.15**

### Property 13: Exactly one owner foreign key on documents and evidence_attachments

For all candidate rows of `documents` and of `evidence_attachments` with any combination of their owner foreign-key columns populated, the insert succeeds if and only if exactly one owner foreign key is non-null.

**Validates: Requirements 4.16**

### Property 14: Tenant isolation holds with and without Tenant_Context

For all pairs of organizations A and B and all rows belonging to B, a query executed as `fleet_app` returns none of B's rows and rejects inserts carrying B's `org_id` when Tenant_Context is unset or set to A; the same query returns all of A's visible rows when Tenant_Context is set to A.

**Validates: Requirements 5.5, 5.6**

### Property 15: Transaction_Helper leaves no Tenant_Context after a transaction ends

For all sequences of transactions run on one pooled connection through `withTransaction`, after each transaction commits or rolls back, `current_setting('app.org_id', true)` on that connection is null (or the next transaction's own value), never a prior transaction's organization id.

**Validates: Requirements 5.3, 5.4**

### Property 16: Token verification accepts only signature-, algorithm-, issuer-, audience- and expiry-valid tokens

For all generated tokens (validly signed and matching configured issuer/audience/algorithm, and tokens with a tampered signature, wrong algorithm, wrong issuer, wrong audience, or expired `exp`), the OIDC_Adapter's verification succeeds if and only if all five conditions hold.

**Validates: Requirements 6.2, 6.3**

### Property 17: Dev-fixture mode activates only under the exact three-condition gate

For all combinations of (NODE_ENV, ALLOW_DEV_AUTH, HOST), Dev_Fixture_Auth is active if and only if NODE_ENV is development or test, ALLOW_DEV_AUTH is true, and HOST is a loopback address.

**Validates: Requirements 6.6**

### Property 18: Permission and action-code checks match the allowlist and ownership table exactly

For all (Principal, action code, resource organization, resource branch) tuples, the authorization check allows the action if and only if the action code is in the server allowlist for the Principal's role, the resource belongs to the Principal's organization, and the Principal's branch scope includes the resource's branch (or the Principal has all-branches/role-level override); a resource of another organization is denied with the same decision path that leads to a 404 response, and a known resource of the Principal's own organization lacking only the permission code is denied with the path that leads to 403.

**Validates: Requirements 6.13, 6.14**

### Property 19: Generated storage keys are well-formed and collision-resistant

For all organization ids, file ids and original filenames, `generateKey` produces a string matching `environment/orgUUID/fileUUID/original.<ext>`, and for all distinct (orgId, fileId) pairs the generated keys differ.

**Validates: Requirements 7.2**

### Property 20: Unsafe keys and filenames are always rejected before any I/O

For all strings containing a path traversal sequence (`..`), an absolute path, or a drive letter, `assertSafeKey` throws before any filesystem or bucket call is made; for all strings free of those patterns, `assertSafeKey` does not throw.

**Validates: Requirements 7.3**

### Property 21: Upload size enforcement is exact at the boundary

For all byte stream lengths and a configured `maxBytes`, `put` succeeds if and only if the streamed length is less than or equal to `maxBytes`; when the stream exceeds `maxBytes`, no partial file remains at the final key afterward.

**Validates: Requirements 7.5, 7.6**

### Property 22: Stored bytes and hash round-trip exactly

For all byte buffers, storing via `put` and then reading via `read` (including after simulating an adapter restart for the local adapter) yields byte-identical content and an identical SHA-256 to the `sha256` returned by `put`.

**Validates: Requirements 7.7, 7.8**

### Property 23: Upload signature/size validation is exact

For all byte buffers and declared content types in {PDF, PNG, JPEG}, `validateUpload` accepts the upload if and only if the buffer's leading bytes match the signature for the declared type and the buffer length is between 1 and `MAX_UPLOAD_BYTES` inclusive.

**Validates: Requirements 7.15, 7.16**

### Property 24: Idempotency replay and conflict are total over (key, hash) pairs

For all sequences of requests sharing one Idempotency-Key, a repeat request with the same request hash as a previously completed request returns the original stored status and body without re-executing the command; a repeat request with a different request hash is rejected with status 409.

**Validates: Requirements 8.1, 8.2**

### Property 25: Optimistic concurrency check is exact and increments by one on success

For all pairs of (`If-Match` header value, stored `row_version`), the update proceeds if and only if the header value equals the stored `row_version`; on success, the new stored `row_version` equals the prior value plus exactly one; on mismatch, nothing in the row changes and the response is 409 STALE_VERSION.

**Validates: Requirements 8.6, 8.7, 8.8**

### Property 26: Allocated numbers are always derived from the sequence row, never from array length, unlocked MAX, or a timestamp

For all sequence rows (prefix, sequenceYear, nextValue, minWidth), `formatNumber` returns `prefix` concatenated with `sequenceYear` (when the sequence kind is year-scoped) concatenated with `nextValue` zero-padded to at least `minWidth` digits, and the output is a pure function of those fields only.

**Validates: Requirements 8.13**

### Property 27: Audit redaction never leaks secret-shaped values

For all before/after objects containing keys matching password/token/secret-like names at any nesting depth, the value stored in `audit_events` for those keys is a fixed redaction marker, never the original value, while all other keys are preserved unchanged.

**Validates: Requirements 8.15**

### Property 28: Gating-rules validation accepts exactly the seven named booleans and protects the two locked rules

For all candidate gating-rules objects, validation succeeds if and only if the object has exactly the keys `requireQuote, requireHaSent, requireHaReceived, requireLpo, blockCreditHold, requireTpcValid, warnOverdueInspection` each boolean, and validation rejects any candidate that would disable Won-only invoicing or same-company ownership (properties the gating-rules object cannot represent being turned off, enforced as a fixed server invariant rather than a field).

**Validates: Requirements 9.2, 9.3**

### Property 29: Role and app code validation matches the server allowlist exactly

For all candidate permission-code and app-code lists, validation accepts the list if and only if every code is present in the corresponding server allowlist.

**Validates: Requirements 9.5**

### Property 30: Custom field definitions reject duplicates and invalid types

For all candidate custom_field_definitions rows, creation succeeds if and only if `field_type` is one of TEXT, NUMBER, CURRENCY, DATE, SELECT, BOOLEAN and no existing active row shares the same `(org_id, app_code, entity_type, field_key)`.

**Validates: Requirements 9.10**

### Property 31: Customer status is restricted to the four allowed values

For all candidate status strings, the API accepts the value if and only if it is one of ACTIVE, INACTIVE, SUSPENDED, BLACKLISTED.

**Validates: Requirements 10.4**

### Property 32: custom_attributes validate against active field definitions for the entity type

For all candidate `custom_attributes` maps and sets of active `custom_field_definitions` for a given entity type, validation succeeds if and only if every key in the map corresponds to an active definition for that entity type and the value matches that definition's declared type.

**Validates: Requirements 10.8, 11.11**

### Property 33: Duplicate asset/fleet/serial numbers are always rejected within one organization

For all pairs of machines in the same organization where both share a value in any one of `asset_no`, `fleet_no`, `serial_no`, inserting the second machine is rejected with a field error naming that field.

**Validates: Requirements 11.3**

### Property 34: Machine status fields are restricted to their allowed enum sets

For all candidate `operational_status` and `readiness_status` strings, the API accepts the value if and only if it is in the respective allowed set (Available/Allocated/On Hire/Under Repair/In Workshop/PDI/PHI/Transport/Breakdown/Offline for operational_status; READY/INTAKE_PENDING/BLOCKED for readiness_status).

**Validates: Requirements 11.4**

### Property 35: Quotation phase transitions match the allowed-transition and reason-required table exactly

For all (from phase, to phase) pairs and all presence/absence and lengths of a supplied reason and reopen permission, `checkTransition` allows the transition if and only if the pair is one of {AWAITING→TENDER, AWAITING→LOST, AWAITING→WON, TENDER→WON, TENDER→LOST, LOST→AWAITING}; a transition to LOST or from LOST to AWAITING additionally requires a trimmed reason of 1 to 500 characters, and LOST→AWAITING additionally requires the reopen permission; every other pair is rejected with INVALID_TRANSITION and changes nothing.

**Validates: Requirements 12.3, 12.5, 12.7, 12.8, 12.9**

### Property 36: Phase history forms a valid chain ending at the current phase

For all valid sequences of manual phase transitions applied to one quotation starting from creation, the resulting `quotation_phase_history` rows, ordered by `occurred_at`, satisfy that each row's `from_phase` equals the previous row's `to_phase` (the first row's `from_phase` is null), and the last row's `to_phase` equals the quotation's current `phase`.

**Validates: Requirements 12.1, 12.14**

### Property 37: Quotation amount/currency validation is exact

For all candidate (amount, currency) pairs, the update is accepted if and only if `currency` is a three-letter uppercase code and `amount` parses as a non-negative decimal string.

**Validates: Requirements 12.18**

### Property 38: Hire agreement date order is enforced

For all candidate (`hire_start_date`, `hire_end_date`) pairs, the create or update is rejected with a field error on `hire_end_date` if and only if `hire_end_date` is earlier than `hire_start_date`.

**Validates: Requirements 13.6**

### Property 39: Hire agreement totals are always server-computed from decimal inputs and client totals are ignored

For all (`monthly_rental`, `transportation_charges`, organization `vat_rate`) decimal triples, the stored `subtotal` equals `monthly_rental + transportation_charges` rounded to the configured currency precision, `vat_amount` equals `subtotal * vat_rate` rounded the same way, `total_amount` equals `subtotal + vat_amount`, and any client-supplied `subtotal`/`vat_amount`/`total_amount` in the request has no effect on the stored values.

**Validates: Requirements 13.7**

### Property 40: payment_term_days and quantity bounds are enforced exactly

For all candidate integers, `payment_term_days` is accepted if and only if it is between 0 and 365 inclusive, and `quantity` is accepted if and only if it is a positive integer.

**Validates: Requirements 13.13**

### Property 41: LPO valid_until must not precede received_on

For all candidate (`received_on`, `valid_until`) date pairs, the create or update is rejected with a field error on `valid_until` if and only if `valid_until` is earlier than `received_on`.

**Validates: Requirements 14.3**

### Property 42: API error body mapping preserves code, fieldErrors and correlationId exactly

For all JSON bodies matching the server's error shape, `mapErrorBody` produces an `ApiClientError` whose `code`, `fieldErrors` and `correlationId` equal the corresponding fields of the input body exactly.

**Validates: Requirements 15.2**

### Property 43: Idempotency-Key reuse matches the retry/new-submission rule

For all sequences of calls to `getOrCreateIdempotencyKey` for one `actionId` without an intervening `clearSubmission`, every call returns the same key; after `clearSubmission(actionId)`, the next call returns a new key distinct from all prior keys for that `actionId`.

**Validates: Requirements 15.3**

## Error Handling

| Situation | Code | HTTP status | retryable | Notes |
|---|---|---|---|---|
| No/invalid credential on protected route | `UNAUTHENTICATED` | 401 | false | Includes expired/wrong-issuer/wrong-audience OIDC tokens and inactive/suspended users (Req 6.1, 6.3, 6.5). |
| Known resource, insufficient permission, same org | `FORBIDDEN` | 403 | false | Req 6.13. |
| Resource of another organization, or unknown resource | `NOT_FOUND` | 404 | false | Never reveals existence of another tenant's row (Req 6.13). |
| Row_Version mismatch on update | `STALE_VERSION` | 409 | false | Req 8.7; CRM_Screens offer reload-without-discard (Req 15.10). |
| Unique constraint violation (customer_code, fleet_log_code, asset/fleet/serial no, lpo_no, agreement already exists) | `DUPLICATE` / `AGREEMENT_EXISTS` | 409 | false | Field error names the offending field (Req 10.3, 11.3, 13.2, 14.2). |
| Idempotency-Key missing on a command that requires one | `IDEMPOTENCY_KEY_REQUIRED` | 422 | false | fieldErrors.`Idempotency-Key` (Req 8.4). |
| Idempotency-Key reused with different request hash | `IDEMPOTENCY_CONFLICT` | 409 | false | Req 8.2. |
| No `If-Match` on an update | — (HTTP 428 directly, no body code needed beyond standard shape) | 428 | false | Req 8.6. |
| Invalid phase transition | `INVALID_TRANSITION` | 422 | false | Req 12.8, 12.9. |
| Edit to `customer_id`/`amount` after Hire_Agreement exists | `IMMUTABLE_FIELD` | 409 | false | Req 12.16. |
| Upload fails signature/size/scan check | `FILE_INVALID` | 422 | false | Req 7.16, 11.8, 14.5. |
| Invalid/stale QR payload | `QR_INVALID` | 422 | false | Out-of-scope gate API in Stage 1, code reserved for schema/front-end reuse. |
| STORAGE_DRIVER=s3 with blank/placeholder config | `STORAGE_NOT_CONFIGURED` | 422 | false | Req 7.14; never falls back to local. |
| PostgreSQL unreachable | `SERVICE_UNAVAILABLE` | 503 | true | Req 2.11; health/ready also 503, no mock fallback. |
| Request body validation failure | `VALIDATION_ERROR` | 422 | false | fieldErrors per invalid path, no raw SQL (Req 2.4). |
| Body exceeds configured limit | — (standard shape) | 413 | false | Req 2.12. |
| Unmatched `/api/*` route | — (standard shape) | 404 | false | Never `index.html` (Req 2.5). |
| Non-GET/HEAD unmatched route | — (standard shape) | varies (404 unless matched) | false | No SPA fallback (Req 2.6). |

All error bodies share the shape `{ code, message, fieldErrors, correlationId, retryable }` (Requirement 2.3), produced by the single `toErrorBody` mapper so every route — including ones not yet written — gets a conforming body by construction rather than by convention.

## Testing Strategy

**Dual approach.** Unit tests (vitest, existing project runner) cover pure functions and mapped error/validation logic with concrete examples and edge cases. Property tests (fast-check v4, already a devDependency) cover the universal properties listed above with a minimum of 100 iterations each. Integration tests (new `server/tests/integration`, a separate vitest project pointed at a real `fleet_test` database) cover schema existence, RLS, concurrency, idempotency-under-real-transactions and storage-adapter restart behavior — the areas explicitly identified in prework as not meaningfully improved by randomized iteration (real-DB migration application, SIGTERM shutdown, S3 mock wiring, build/package artifact contents).

Server-side property tests use fast-check directly (no React/DOM concerns); none require `fc.stringOf` (unavailable in v4) — string generation uses `fc.string()`, `fc.stringMatching()`-style constrained generators built from `fc.array(fc.constantFrom(...))` plus `.join('')`, or domain-specific generators (e.g. a date-pair generator built from `fc.date()` pairs) as needed, consistent with existing fast-check v4 usage in the repository's property tests (e.g. `hireLink*.test.ts`).

### Test layout

```text
server/tests/
  unit/
    config.test.ts                 Property 1, 2, 3
    errors.test.ts                 Property 4, 5
    bodyLimit.test.ts              Property 6
    migrationChecksum.test.ts      Property 7
    migrationDenylist.test.ts      Property 8
    authTokenVerification.test.ts  Property 16
    devFixtureGate.test.ts         Property 17
    permissionAllowlist.test.ts    Property 18
    storageKeys.test.ts            Property 19, 20
    uploadValidator.test.ts        Property 23
    idempotency.test.ts            Property 24 (pure matching logic; real-tx variant in integration)
    rowVersion.test.ts             Property 25 (pure matching logic; real-tx variant in integration)
    numberAllocator.test.ts        Property 26
    audit.test.ts                  Property 27
    gatingRules.test.ts            Property 28
    codeAllowlist.test.ts          Property 29
    customFieldDefs.test.ts        Property 30
    customerStatus.test.ts         Property 31
    customAttributes.test.ts       Property 32
    quotationTransitions.test.ts   Property 35, 36
    quotationAmount.test.ts        Property 37
    hireAgreementDates.test.ts     Property 38
    hireAgreementTotals.test.ts    Property 39 (decimal.js round-trip)
    hireAgreementBounds.test.ts    Property 40
    lpoDates.test.ts               Property 41
  integration/   (requires fleet_test; guarded by test-db-name check, Requirement 17.11)
    migrationRunner.int.test.ts    3.1,3.2,3.3,3.5,3.6,3.7,3.8,3.10; all-37-tables-exist (18.2)
    schemaConstraints.int.test.ts  Property 9, 10, 11, 12, 13 run against real Postgres (exclusion/FK/check constraints cannot be unit-tested without a real engine)
    rls.int.test.ts                Property 14, 15; Runtime_Role with/without Tenant_Context (18.6, 18.7)
    crossTenant.int.test.ts        two orgs, several roles/branches, denial/404 matrix (18.6/T18)
    concurrencyNumbering.int.test.ts  N concurrent quotation creates -> N distinct numbers, rollback leaves next_value unchanged (18.8/T19)
    idempotencyAndConcurrency.int.test.ts  replay/conflict and stale If-Match against real transactions (18.9)
    phaseHistoryAtomicity.int.test.ts  injected failure between quotation update and history insert (18.10)
    localStorage.int.test.ts       restart-and-reread byte/hash identity (18.12, Property 22 variant against real filesystem)
    s3Mock.int.test.ts             mocked S3Client bucket/key/body/contentType assertions (18.12)
    productionConfig.int.test.ts   dev auth / local storage / disabled TLS / stub verifier / placeholders all rejected (18.13)
client-side (existing src/ vitest project):
  src/services/api/http.test.ts          Property 42
  src/services/api/idempotency.test.ts   Property 43
  src/features/crm/crmRules.test.ts      updated for AWAITING->WON (Req 12.4, 18.14), not deleted
  component tests (existing pattern, e.g. HireAgreementPage.test.tsx style) for 15.9, 15.10, 15.11, 15.12, 15.13, 15.15
```

### Property test configuration

- Every property test configures `fc.assert(fc.property(...), { numRuns: 100 })` at minimum.
- Each test is tagged in a comment: `// Feature: backend-foundation-crm, Property N: <short title>` referencing the numbered property above.
- `server/vitest.config.ts` (new) mirrors the existing root `vitest.config.ts` shape (`environment: 'node'`, path alias) with `include: ['server/tests/unit/**/*.test.ts']` for the fast unit/property run, and a second `server/vitest.integration.config.ts` with `include: ['server/tests/integration/**/*.int.test.ts']`, run only by `npm run test:integration`, which first asserts `process.env.DATABASE_URL`/`TEST_DATABASE_URL` contains `fleet_test` (or another name explicitly marked as a test database) before doing anything destructive — satisfying Requirement 17.11 and the "Test_Database" glossary constraint.
- Root `package.json` gains `"test:server": "vitest --run --config server/vitest.config.ts"`, folded into `"test"` so `npm test` runs both frontend and server unit/property suites; `"test:integration": "vitest --run --config server/vitest.integration.config.ts"` stays separate because it requires a running local PostgreSQL service.

### Round-trip and decimal precision tests

Requirement 18.5 (money decimal string round-trip) is covered by Property 39's decimal.js-based test: parsing a decimal string, formatting it back, and reparsing yields an equal `Decimal` value for all generated decimal strings within the `numeric(20,6)` range.

### Existing frontend tests

`npm run test` (root) continues to run the full `src/**/*.test.{ts,tsx}` suite unchanged; Requirement 18.14 requires `crmRules.test.ts` to be updated (new case: `AWAITING -> WON` without a reason succeeds) rather than deleted, and Requirement 15.17/18.14 require the retained-scope screens' existing tests (planner, invoice, transport, collection, gate, inspections, and `GatePassDialog*.test.tsx` at the repo root) to keep passing unmodified, which the read-adapter approach in Components and Interfaces is designed to preserve.

### eslint import-boundary check

`eslint.config.js` gains a `no-restricted-imports` rule (or `import/no-restricted-paths` if the plugin is added) scoped to `server/src/**` forbidding imports from `src/store/*` and `src/services/services.ts`, enforcing the "shared DTO types must not import browser stores" constraint mechanically rather than by convention.

## Migration and rollout note: local setup

These are documentation commands for the runbook (Requirement 17.12), not actions taken by writing this design. Binaries are at `C:\Program Files\PostgreSQL\18\bin` (not on PATH).

```powershell
# 1. Create roles and databases as the existing postgres superuser (one-time, local only).
#    Never touch odoo_dev or the odoo role.
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE ROLE fleet_owner LOGIN PASSWORD 'CHANGE_ME_LOCAL';"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE ROLE fleet_migrator LOGIN PASSWORD 'CHANGE_ME_LOCAL';"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE ROLE fleet_app LOGIN PASSWORD 'CHANGE_ME_LOCAL' NOBYPASSRLS;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE fleet_local OWNER fleet_migrator;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE fleet_test OWNER fleet_migrator;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d fleet_local -c "GRANT CONNECT ON DATABASE fleet_local TO fleet_app;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d fleet_test  -c "GRANT CONNECT ON DATABASE fleet_test  TO fleet_app;"

# 2. .env (gitignored) for local development:
#    DATABASE_URL=postgresql://fleet_app:CHANGE_ME_LOCAL@127.0.0.1:5432/fleet_local
#    MIGRATION_DATABASE_URL=postgresql://fleet_migrator:CHANGE_ME_LOCAL@127.0.0.1:5432/fleet_local
#    DATABASE_SSL_MODE=disable

# 3. Apply migrations, then seed fixtures.
npm run db:migrate
npm run db:seed:dev

# 4. For integration tests, point at fleet_test instead and re-run step 3's migrate against it:
#    TEST_DATABASE_URL=postgresql://fleet_app:CHANGE_ME_LOCAL@127.0.0.1:5432/fleet_test
#    MIGRATION_DATABASE_URL=postgresql://fleet_migrator:CHANGE_ME_LOCAL@127.0.0.1:5432/fleet_test
npm run test:integration
```

The Migration_Runner's denylist (`['odoo_dev']`, configurable) is checked against the parsed database name from both `MIGRATION_DATABASE_URL` and the `--target` used by `test:integration`, before any SQL runs (Requirement 3.11, 3.9).
