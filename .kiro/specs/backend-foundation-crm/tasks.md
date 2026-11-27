# Implementation Plan: Backend Foundation and CRM Chain (Stage 1)

## Overview

Implementation language is TypeScript (the design uses TypeScript). The plan builds bottom-up so each task can be verified on its own: tooling, local database setup, config, app foundation, migration runner, schema, DB primitives, auth, storage, CRM-chain APIs, dev seed, frontend client and screens, build/package, runbook, final verification.

Global rules for every task:

- Install packages with `npm install --legacy-peer-deps`.
- Never touch the `odoo_dev` database, the `odoo` role or anything under `c:\Users\koush\Project 1-11\odoo`.
- Stay on branch `feature/crm-plugin`. Do not run `git commit`, `git push` or change git config.
- No real AWS call or credential, no Docker.
- fast-check is v4: do not use `fc.stringOf`. Build strings with `fc.array(fc.constantFrom(...)).map(a => a.join(''))` or `fc.string()`.
- Property tests live in their own files under `server/tests/property/` (server) or next to the module (frontend). Each file starts with the tag comment `// Feature: backend-foundation-crm, Property <n>: <title>` and uses `numRuns >= 100`.
- Integration tests live in `server/tests/integration/*.int.test.ts`, run against `fleet_test` only, and refuse to run when the database name is not a test database.
- Server unit and property tests are picked up by `server/vitest.config.ts` (`server/tests/unit/**` and `server/tests/property/**`).
- Each API module adds its DTO schemas under `shared/dto/` and its router under `server/src/modules/<name>/`. A separate "register routers" sub-task edits `server/src/routes.ts` so parallel module tasks never edit the same file.

## Tasks

- [x] 1. Tooling and repository layout
  - [x] 1.1 Add dependencies and package.json scripts/engines
    - Run `npm install --legacy-peer-deps` for `express`, `pg`, `decimal.js`, `jose`, `@aws-sdk/client-s3`, `pino`, `archiver`, and dev dependencies `tsx`, `@types/express`, `@types/pg`, `@types/archiver`, `supertest`, `@types/supertest`, `aws-sdk-client-mock` (zod and fast-check already exist)
    - Add scripts `dev`, `dev:server` (`tsx watch server/src/index.ts`), `db:migrate`, `db:seed:dev`, `db:setup:local`, `build` (vite build plus `tsc -p server/tsconfig.json`), `start` (`node server/dist/index.js`), `typecheck` (frontend and server), `lint`, `test` (frontend plus `test:server`), `test:server`, `test:integration`, `package:aws`, `scan:bundle`
    - Add `engines.node` pinned to the chosen Node 22 LTS range and `"type"` handling that keeps the frontend working while server output is ESM
    - _Requirements: 17.1, 17.6, 17.13_
  - [x] 1.2 Create server TypeScript/ESM layout, shared DTO folder, vitest configs and eslint boundary
    - Create `server/tsconfig.json` (ESM, `NodeNext`, `outDir: dist`, own include list) and a `server/src/index.ts` placeholder that compiles
    - Create `shared/dto/index.ts` and `shared/tsconfig` coverage so both sides can import it without browser modules
    - Create `server/vitest.config.ts` (node environment, include `server/tests/unit/**/*.test.ts` and `server/tests/property/**/*.test.ts`) and `server/vitest.integration.config.ts` (include `server/tests/integration/**/*.int.test.ts`, no file parallelism, global setup that asserts the target DB name contains `fleet_test`)
    - Add an eslint `no-restricted-imports` rule in `eslint.config.js` forbidding `server/src/**` and `shared/**` from importing `src/store/*`, `src/services/*` and browser-only modules
    - _Requirements: 17.2, 17.4, 17.10, 17.11_
  - [x] 1.3 Create environment, ignore, Beanstalk and Node version files
    - Write `.env.example` documenting every variable of Requirement 1.1 with empty values or `CHANGE_ME_LOCAL` placeholders only
    - Update `.gitignore` for `.env*` (except `.env.example`), `server/dist/`, local storage root, generated ZIPs
    - Create `Procfile` (`web: node server/dist/index.js`), `.platform/nginx/conf.d/uploads.conf` (12 MiB body, bounded timeouts) and `.nvmrc` matching `engines.node`
    - _Requirements: 1.12, 1.13, 17.5, 17.6_

- [x] 2. Local database setup (roles and databases)
  - [x] 2.1 Write the idempotent local DB setup script
    - Create `server/scripts/dbSetup.ps1` (or `.ts` calling `psql.exe` from `C:\Program Files\PostgreSQL\18\bin`) that creates roles `fleet_owner`, `fleet_migrator`, `fleet_app` (NOBYPASSRLS) and databases `fleet_local`, `fleet_test` only if missing, grants CONNECT to `fleet_app`, and enables `btree_gist` availability check
    - Read the postgres superuser password from the `PGPASSWORD` environment variable or a prompt, never from a committed file; read local role passwords from env with a local-only default
    - Refuse any database or role name in the denylist (`odoo_dev`, `odoo`) and print a clear message
    - Wire it to `npm run db:setup:local`
    - _Requirements: 3.9, 3.10, 3.11, 5.2, 17.12_
  - [x] 2.2 Execute the setup against the local PostgreSQL service
    - Verify service `postgresql-x64-18` is running, then run `npm run db:setup:local` using the local postgres superuser
    - If the superuser password is unknown or authentication fails, STOP and ask the user (user_input tool) for it or for manual execution; do not guess passwords or edit `pg_hba.conf`
    - Re-run once to confirm idempotency; confirm `odoo_dev` is untouched (do not connect to it)
    - Write the resulting local-only connection strings into the gitignored `.env`
    - _Requirements: 3.9, 3.11, 17.12_

- [x] 3. Config_Loader and production guards
  - [x] 3.1 Implement `server/src/config.ts`
    - zod schema for all variables, `ServerConfig`, `ConfigError` with `safeIssues`, cross-field production guards, s3/local rules, `buildPgSsl(mode, caFile)`, loopback check helper, no `VITE_` reads
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 6.6_
  - [x]* 3.2 Write property test for production configuration guard
    - File `server/tests/property/config.production.property.test.ts`
    - **Property 1: Production configuration guard is total over the guard predicate table**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.7**
  - [x]* 3.3 Write property test for s3 configuration completeness
    - File `server/tests/property/config.s3.property.test.ts`
    - **Property 2: s3-mode storage configuration completeness**
    - **Validates: Requirements 1.8**
  - [x]* 3.4 Write property test for TLS options
    - File `server/tests/property/config.ssl.property.test.ts`
    - **Property 3: Non-disabled SSL modes never disable certificate verification**
    - **Validates: Requirements 1.10**
  - [x] 3.5 Write unit tests for configuration and production rejection
    - File `server/tests/unit/config.test.ts`: missing/invalid variable stops with safe issues and no secrets, local mode accepts blank AWS values, and dev auth, local/memory storage, disabled TLS, stub scanner and `CHANGE_ME` placeholders are each rejected in production
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 18.1, 18.13_

- [x] 4. App foundation
  - [x] 4.1 Implement errors, logger and correlation id
    - `server/src/errors.ts` (`AppError`, `ErrorCode`, `toErrorBody` with the fixed status table, zod error mapping to 422 without SQL text), `server/src/logger.ts` (pino, JSON, redaction of authorization/password/token/secret/connection strings), correlation-id middleware
    - _Requirements: 2.2, 2.3, 2.4, 2.14, 2.15_
  - [x] 4.2 Implement the Express app, DB pool, health, fallbacks, limits and shutdown
    - `server/src/db/pool.ts` (pg Pool using `buildPgSsl`), `server/src/app.ts` (middleware order, body limit 413, `/api/v1` mount, `/api/*` JSON 404, non-GET unmatched JSON error, SPA fallback only for GET/HEAD without extension, 404 for missing assets), `server/src/modules/health/` (`live` 200 without dependencies, `ready` 200 or 503 with no connection details), 503 retryable mapping when PostgreSQL is unreachable, `server/src/index.ts` (config load, listen on `PORT`, SIGTERM/SIGINT bounded drain, pool close, no migrations or schema work at startup)
    - _Requirements: 2.1, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 3.7, 17.3_
  - [x]* 4.3 Write property test for error body mapping
    - File `server/tests/property/errors.body.property.test.ts`
    - **Property 4: Every mapped error produces a complete, correctly shaped body**
    - **Validates: Requirements 2.2, 2.3, 2.15**
  - [x]* 4.4 Write property test for validation error mapping
    - File `server/tests/property/errors.validation.property.test.ts`
    - **Property 5: Invalid request bodies map to 422 with a field error per invalid field and no raw SQL**
    - **Validates: Requirements 2.4**
  - [x]* 4.5 Write property test for body size limit
    - File `server/tests/property/bodyLimit.property.test.ts`
    - **Property 6: Oversized bodies are rejected at the configured limit**
    - **Validates: Requirements 2.12**
  - [x]* 4.6 Write unit tests for the app foundation
    - File `server/tests/unit/app.test.ts` (supertest): live 200, ready 503 with a failing probe and no mock data, unknown `/api/x` JSON 404, POST to unknown path JSON error, `/planner` returns index.html, `/missing.js` 404, correlation id in errors and logs, graceful shutdown closes the pool
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.13, 2.14_

- [x] 5. Migration runner
  - [x] 5.1 Implement `server/scripts/migrate.ts` and its library
    - Ordered apply from `server/migrations/`, `schema_migrations` ledger written in the same transaction, sha256 checksum with mismatch exit code, `pg_advisory_lock` so a second runner waits or exits, `MIGRATION_DATABASE_URL` required, target database-name guard (application or test names only, denylist includes `odoo_dev`), never drops or reseeds non-test databases; export pure `checksumMismatch(applied, current)` and `assertAllowedTarget(dbName, config)` helpers
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.9, 3.10, 3.11_
  - [x]* 5.2 Write property test for checksum mismatch detection
    - File `server/tests/property/migrationChecksum.property.test.ts`
    - **Property 7: Migration checksum mismatch is always detected**
    - **Validates: Requirements 3.4**
  - [x]* 5.3 Write property test for the target database name guard
    - File `server/tests/property/migrationDenylist.property.test.ts`
    - **Property 8: Migration target database name denylist is total**
    - **Validates: Requirements 3.9, 3.11**
  - [x] 5.4 Write integration tests for the runner using a temporary migrations directory
    - File `server/tests/integration/migrationRunner.int.test.ts` against `fleet_test`: ordered apply, ledger rows, second run applies nothing and exits 0, checksum change fails and names the version, concurrent runners do not double-apply, blank `MIGRATION_DATABASE_URL` exits non-zero, `odoo_dev` target refused before any SQL
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.9, 3.11_

- [x] 6. Schema migrations, constraints, RLS and identity resolver
  - [x] 6.1 Write migrations 0001 and 0002
    - `0001_extensions_roles.sql` (`btree_gist`, grants scaffolding) and `0002_company_users.sql` (organizations, branches, roles, users, organization_apps, custom_field_definitions; cyclic users FKs added after creation)
    - Follow DATABASE_DESIGN.md section 2/3 for columns, composite `(org_id, id)` keys, money/rate types, row_version
    - _Requirements: 3.8, 4.2, 4.3, 4.4, 4.6, 4.8, 4.9, 4.13_
  - [x] 6.2 Write migrations 0003 and 0004
    - `0003_customer_fleet.sql` (customers, machine_models, machines, machine_documents without the `files` FK) and `0004_crm.sql` (quotations, quotation_phase_history append-only, hire_agreements with same-customer enforcement, customer_lpos, `uq_live_quote_agreement`, phase and status checks)
    - _Requirements: 4.2, 4.5, 4.6, 4.12, 4.13, 4.14, 4.15_
  - [x] 6.3 Write migrations 0005, 0006 and 0007
    - bookings, invoices, invoice_lines with `ex_machine_planned_booking`, `ex_machine_physical_booking`, `ex_quote_invoice_overlap`, `ck_booking_dates`, `ck_actual_booking_return`, `ck_invoice_dates`; drivers, transport_vehicles, transport_jobs; gate_passes, gate_movements (append-only), collection_notes, mqd_reports, third_party_service_reports, third_party_service_lines, delivery_notes, inspections, inspection_results
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.9, 4.10, 4.11, 4.13_
  - [x] 6.4 Write migrations 0008 and 0009
    - `0008_documents_files_evidence.sql` (files with scan status, documents with exactly-one-owner check, document_versions, document_files, evidence_attachments with exactly-one-owner check, cyclic `documents.current_version_id`, deferred `machine_documents.file_id` FK) and `0009_numbering_idempotency_audit.sql` (number_sequences, idempotency_keys, audit_events append-only, `uq_open_collection`)
    - _Requirements: 4.1, 4.2, 4.5, 4.8, 4.10, 4.13, 4.16, 7.18_
  - [x] 6.5 Write migration 0010 (RLS, grants, identity resolver)
    - `ENABLE` and `FORCE ROW LEVEL SECURITY` with the `tenant_isolation` policy on every org-scoped table, grants to `fleet_app` (no UPDATE/DELETE on quotation_phase_history, gate_movements, audit_events), `identity_resolver(auth_subject)` as `SECURITY DEFINER` with fixed `search_path`, no unrestricted user listing
    - _Requirements: 4.5, 5.1, 5.2, 5.5, 5.6, 5.9, 8.16, 12.12_
  - [x] 6.6 Write integration test: migrate from empty and verify all 37 tables
    - File `server/tests/integration/schema.migrate.int.test.ts`: create a throwaway `fleet_test_<random>` database, run the real migrations, assert exactly the 37 business tables plus `schema_migrations`, re-run applies nothing and exits 0, then drop only that throwaway database; also migrate `fleet_test` for later tests
    - _Requirements: 3.3, 3.8, 4.1, 18.2_
  - [x] 6.7 Write integration tests for database constraints
    - File `server/tests/integration/schema.constraints.int.test.ts` using direct SQL as `fleet_app` with Tenant_Context: cross-organization FK rejected (4.7), overlapping active bookings rejected (4.11), second non-cancelled agreement per quotation rejected (4.12), agreement customer differing from quotation customer rejected (4.15), documents and evidence_attachments require exactly one owner FK (4.16), UPDATE/DELETE on append-only tables denied (4.5)
    - _Requirements: 4.5, 4.7, 4.11, 4.12, 4.15, 4.16, 18.11_
  - [x] 6.8 Write integration tests for RLS with the runtime role
    - File `server/tests/integration/rls.int.test.ts`: no Tenant_Context returns zero rows and rejects inserts; context A never sees B and cannot insert B rows; runtime role has no BYPASSRLS and is not owner; identity resolver returns only the matched active user
    - _Requirements: 5.1, 5.2, 5.5, 5.6, 5.9, 18.7_
  - [ ]* 6.9 Write property test for cross-organization foreign keys
    - File `server/tests/property/schema.crossOrgFk.property.test.ts` (real fleet_test)
    - **Property 9: Cross-organization foreign keys are always rejected**
    - **Validates: Requirements 4.7**
  - [ ]* 6.10 Write property test for booking overlap exclusion
    - File `server/tests/property/schema.bookingOverlap.property.test.ts` (real fleet_test)
    - **Property 10: Machine booking overlap exclusion is total over date ranges and statuses**
    - **Validates: Requirements 4.11**
  - [ ]* 6.11 Write property test for one live agreement per quotation
    - File `server/tests/property/schema.liveAgreement.property.test.ts` (real fleet_test)
    - **Property 11: At most one non-cancelled hire agreement per quotation**
    - **Validates: Requirements 4.12**
  - [ ]* 6.12 Write property test for agreement/quotation customer equality
    - File `server/tests/property/schema.agreementCustomer.property.test.ts` (real fleet_test)
    - **Property 12: Hire agreement customer must equal quotation customer**
    - **Validates: Requirements 4.15**
  - [ ]* 6.13 Write property test for exactly-one-owner foreign key
    - File `server/tests/property/schema.ownerFk.property.test.ts` (real fleet_test)
    - **Property 13: Exactly one owner foreign key on documents and evidence_attachments**
    - **Validates: Requirements 4.16**
  - [ ]* 6.14 Write property test for tenant isolation
    - File `server/tests/property/rls.isolation.property.test.ts` (real fleet_test)
    - **Property 14: Tenant isolation holds with and without Tenant_Context**
    - **Validates: Requirements 5.5, 5.6**

- [x] 7. Transaction helper, idempotency, row version, numbering, audit
  - [x] 7.1 Implement `server/src/db/tx.ts`
    - `withTransaction(orgId, fn)`: BEGIN, `set_config('app.org_id', $1, true)`, work, COMMIT/ROLLBACK, release in all outcomes; parameterized SQL only; sort-field whitelist and pagination helpers in `server/src/modules/shared/pagination.ts`
    - _Requirements: 5.3, 5.4, 5.8_
  - [x] 7.2 Implement `server/src/modules/shared/numberAllocator.ts`
    - Pure `formatNumber`; `allocateNumber` locks the `number_sequences` row with `FOR UPDATE`, increments, never reuses; creates the sequence row on first use
    - _Requirements: 8.9, 8.10, 8.11, 8.13_
  - [x] 7.3 Implement `server/src/modules/shared/idempotency.ts` and middleware
    - `claimIdempotencyKey` inside the command transaction, replay of stored status/body, 409 `IDEMPOTENCY_CONFLICT` on hash mismatch, 422 `IDEMPOTENCY_KEY_REQUIRED` for create commands, no secrets/signed URLs retained
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 7.4 Implement `server/src/modules/shared/rowVersion.ts`
    - Parse `If-Match`, 428 when absent, 409 `STALE_VERSION` on mismatch, helper that appends `WHERE row_version = $n` and increments by 1, returning the new value
    - _Requirements: 8.6, 8.7, 8.8_
  - [x] 7.5 Implement `server/src/modules/shared/audit.ts`
    - `recordAudit` in the caller's transaction with recursive redaction of password/token/secret-like keys
    - _Requirements: 8.14, 8.15, 8.16_
  - [x] 7.6 Write integration test for concurrent numbering (T19)
    - File `server/tests/integration/numbering.concurrency.int.test.ts`: N concurrent creates on independent connections give N distinct contiguous numbers; a rolled-back create does not consume a number; archived/cancelled numbers are not reissued
    - _Requirements: 8.9, 8.10, 8.11, 8.12, 18.8_
  - [x] 7.7 Write integration tests for idempotency and optimistic concurrency
    - File `server/tests/integration/idempotency.int.test.ts` using real transactions: same key and hash replays with no second row, same key with a different hash returns 409, rollback leaves no completed key, missing `If-Match` returns 428, stale `If-Match` returns 409 and changes nothing, success increments by 1
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 8.7, 8.8, 18.9_
  - [ ]* 7.8 Write property test for transaction context cleanup
    - File `server/tests/property/tx.context.property.test.ts` (real fleet_test)
    - **Property 15: Transaction_Helper leaves no Tenant_Context after a transaction ends**
    - **Validates: Requirements 5.3, 5.4**
  - [ ]* 7.9 Write property test for idempotency matching
    - File `server/tests/property/idempotency.property.test.ts`
    - **Property 24: Idempotency replay and conflict are total over (key, hash) pairs**
    - **Validates: Requirements 8.1, 8.2**
  - [ ]* 7.10 Write property test for optimistic concurrency
    - File `server/tests/property/rowVersion.property.test.ts`
    - **Property 25: Optimistic concurrency check is exact and increments by one on success**
    - **Validates: Requirements 8.6, 8.7, 8.8**
  - [ ]* 7.11 Write property test for number formatting
    - File `server/tests/property/numberFormat.property.test.ts`
    - **Property 26: Allocated numbers are always derived from the sequence row**
    - **Validates: Requirements 8.13**
  - [ ]* 7.12 Write property test for audit redaction
    - File `server/tests/property/auditRedaction.property.test.ts`
    - **Property 27: Audit redaction never leaks secret-shaped values**
    - **Validates: Requirements 8.15**

- [x] 8. Authentication and principal
  - [x] 8.1 Implement principal and permission allowlist
    - `server/src/auth/principal.ts`: `Principal` type, role-to-action allowlist derived from `src/features/auth/authStore` role grants (including the reopen permission code), `authorize(principal, action, resource)` returning allow, forbid (403) or hide (404) per own-company/branch rules; unknown action denied
    - _Requirements: 6.13, 6.14_
  - [x] 8.2 Implement the OIDC adapter and auth middleware
    - `server/src/auth/oidcAdapter.ts` (jose `jwtVerify`: signature, algorithm allowlist, issuer, audience, expiry, remote JWKS) and `server/src/auth/middleware.ts` (single verification path for RS256 and dev HS256, Identity_Resolver call, 401 for inactive/suspended, Tenant_Context from Principal only, headers/body org ids ignored)
    - _Requirements: 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.9, 6.10, 6.11_
  - [x] 8.3 Implement dev fixture auth and session endpoint
    - `server/src/auth/devFixtureAuth.ts`: `POST /api/v1/dev/session` registered only when `AUTH_MODE=development-fixture`, `NODE_ENV` development/test, `ALLOW_DEV_AUTH=true` and loopback `HOST`; ignores body role/org/password; 15-minute HS256 token for `DEV_AUTH_USER_ID`; `GET /api/v1/session` returning user, role, action codes, organization, branch scope and `authMode`; wire into `server/src/app.ts`
    - _Requirements: 6.6, 6.7, 6.8, 6.12_
  - [ ]* 8.4 Write property test for token verification
    - File `server/tests/property/authToken.property.test.ts`
    - **Property 16: Token verification accepts only signature-, algorithm-, issuer-, audience- and expiry-valid tokens**
    - **Validates: Requirements 6.2, 6.3**
  - [ ]* 8.5 Write property test for the dev fixture gate
    - File `server/tests/property/devFixtureGate.property.test.ts`
    - **Property 17: Dev-fixture mode activates only under the exact three-condition gate**
    - **Validates: Requirements 6.6**
  - [ ]* 8.6 Write property test for permission checks
    - File `server/tests/property/permissions.property.test.ts`
    - **Property 18: Permission and action-code checks match the allowlist and ownership table exactly**
    - **Validates: Requirements 6.13, 6.14**
  - [x] 8.7 Write integration tests for authentication flow
    - File `server/tests/integration/auth.int.test.ts`: no credential 401, dev session works only under the gate, session endpoint returns auth mode, ignored role/org in body and headers, inactive/suspended user 401 even with a valid token, expired/wrong-issuer/wrong-audience tokens 401, no password endpoints exist
    - _Requirements: 6.1, 6.3, 6.5, 6.7, 6.8, 6.11, 6.12_

- [x] 9. File storage and files API
  - [x] 9.1 Implement storage interface, key rules, upload validator and verification stub
    - `server/src/storage/fileStorage.ts` (interface, `generateKey`, `assertSafeKey`), `uploadValidator.ts` (PDF/PNG/JPEG signatures, 1..`MAX_UPLOAD_BYTES`), `verificationAdapter.ts` (development-stub selectable only in development/test, records audit marker that no scan occurred)
    - _Requirements: 7.1, 7.2, 7.3, 7.15, 7.16, 7.17_
  - [x] 9.2 Implement the local storage adapter
    - `localStorageAdapter.ts`: root resolved once outside `dist/`, `src/`, public dirs; stream to `.part`, count bytes, rename only within `maxBytes`, remove partial on overflow, return key/bytes/sha256, `head`, `read`, `removeUnattached`; no static mount, no AWS call
    - _Requirements: 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_
  - [x] 9.3 Implement the S3 adapter with an injected client
    - `s3StorageAdapter.ts` taking an `S3Client`, prefix-qualified keys, SDK default credential chain, domain error mapping without credentials or signed URLs, `STORAGE_NOT_CONFIGURED` for blank/placeholder config with no local fallback
    - _Requirements: 7.11, 7.12, 7.13, 7.14_
  - [x] 9.4 Implement the files API and scan-status gate
    - `server/src/modules/files/` (upload endpoint using the validator, storage and verification adapter, `files` rows with scan status, download only for Clean files), DTOs in `shared/dto/files.ts`, register in `server/src/routes.ts`
    - _Requirements: 7.2, 7.15, 7.16, 7.17, 7.18, 11.8, 14.5_
  - [ ]* 9.5 Write property test for storage keys
    - File `server/tests/property/storageKey.property.test.ts`
    - **Property 19: Generated storage keys are well-formed and collision-resistant**
    - **Validates: Requirements 7.2**
  - [ ]* 9.6 Write property test for unsafe keys
    - File `server/tests/property/storageUnsafeKey.property.test.ts`
    - **Property 20: Unsafe keys and filenames are always rejected before any I/O**
    - **Validates: Requirements 7.3**
  - [ ]* 9.7 Write property test for upload size boundary
    - File `server/tests/property/storageSize.property.test.ts`
    - **Property 21: Upload size enforcement is exact at the boundary**
    - **Validates: Requirements 7.5, 7.6**
  - [ ]* 9.8 Write property test for byte and hash round trip
    - File `server/tests/property/storageRoundTrip.property.test.ts`
    - **Property 22: Stored bytes and hash round-trip exactly**
    - **Validates: Requirements 7.7, 7.8**
  - [ ]* 9.9 Write property test for upload validation
    - File `server/tests/property/uploadValidator.property.test.ts`
    - **Property 23: Upload signature/size validation is exact**
    - **Validates: Requirements 7.15, 7.16**
  - [x] 9.10 Write integration tests for local and S3-mock storage
    - File `server/tests/integration/storage.int.test.ts`: store a PDF, recreate the adapter, read identical bytes and SHA-256; S3 mock asserts bucket, prefixed key, body and content type; error mapping leaks no credentials; blank s3 config yields `STORAGE_NOT_CONFIGURED`; non-Clean file cannot be attached or downloaded
    - _Requirements: 7.8, 7.12, 7.13, 7.14, 7.18, 18.12_

- [x] 10. Company, branches, roles, users, apps and custom fields
  - [x] 10.1 Implement company profile with gating rules
    - `server/src/modules/company/`: `GET/PUT /api/v1/company`, exact seven-boolean gating validation, 422 for any attempt to disable Won-only invoicing or same-company ownership, audit event; DTOs in `shared/dto/company.ts`
    - _Requirements: 9.1, 9.2, 9.3, 9.12_
  - [x] 10.2 Implement branches
    - `server/src/modules/branches/`: list, create, update, deactivate, unique code per organization, permission-gated
    - _Requirements: 9.4, 9.12_
  - [x] 10.3 Implement roles and users
    - `server/src/modules/users/`: role listing with permission and app code validation against allowlists; user list/create/update/status with one role and one organization, unique normalized email, audit event with previous and new values on role/branch/status change
    - _Requirements: 9.5, 9.6, 9.7, 9.12_
  - [x] 10.4 Implement organization apps and custom field definitions
    - `server/src/modules/apps/` (read/update `organization_apps` validated against `src/constants/apps.ts` catalog and dependencies; deactivation keeps records) and `server/src/modules/customFields/` (CRUD, uniqueness, six types, system-field protection); shared `customAttributes` validator in `server/src/modules/shared/customAttributes.ts`
    - _Requirements: 9.8, 9.9, 9.10, 9.11, 9.12, 10.8, 11.11_
  - [x] 10.5 Register company-area routers
    - Edit `server/src/routes.ts` to mount the routers of 10.1 to 10.4 under `/api/v1`
    - _Requirements: 2.1, 9.1_
  - [ ]* 10.6 Write property test for gating rules
    - File `server/tests/property/gatingRules.property.test.ts`
    - **Property 28: Gating-rules validation accepts exactly the seven named booleans and protects the two locked rules**
    - **Validates: Requirements 9.2, 9.3**
  - [ ]* 10.7 Write property test for code allowlists
    - File `server/tests/property/codeAllowlist.property.test.ts`
    - **Property 29: Role and app code validation matches the server allowlist exactly**
    - **Validates: Requirements 9.5**
  - [ ]* 10.8 Write property test for custom field definitions
    - File `server/tests/property/customFieldDefs.property.test.ts`
    - **Property 30: Custom field definitions reject duplicates and invalid types**
    - **Validates: Requirements 9.10**
  - [x] 10.9 Write integration tests for company-area APIs
    - File `server/tests/integration/company.int.test.ts`: profile read/update with audit, gating rejection, branch uniqueness, user role/branch change audited with before/after, duplicate email 409, app deactivation retains records, system custom field delete/retype 422, permission-less role gets 403
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.9, 9.10, 9.11, 9.12_

- [x] 11. Customers API
  - [x] 11.1 Implement the customers module
    - `server/src/modules/customers/` and `shared/dto/customers.ts`: list/read/create/update/archive, `Idempotency-Key` on create, `customer_code` via Number_Allocator unless unique code supplied, 409 field errors for duplicate `customer_code`/`fleet_log_code`, four statuses, archive instead of delete when referenced, no automatic merge, branch scope (omit from lists, 404 on read), `custom_attributes` validation, status/branch filters and name/code search with pagination, `If-Match` on update, audit
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_
  - [x] 11.2 Register the customers router
    - Edit `server/src/routes.ts`
    - _Requirements: 2.1_
  - [ ]* 11.3 Write property test for customer status
    - File `server/tests/property/customerStatus.property.test.ts`
    - **Property 31: Customer status is restricted to the four allowed values**
    - **Validates: Requirements 10.4**
  - [ ]* 11.4 Write property test for custom attributes
    - File `server/tests/property/customAttributes.property.test.ts`
    - **Property 32: custom_attributes validate against active field definitions for the entity type**
    - **Validates: Requirements 10.8, 11.11**
  - [x] 11.5 Write integration tests for customers including cross-tenant (T18)
    - File `server/tests/integration/customers.int.test.ts`: create with idempotent replay, duplicate code 409, archive, branch-scope hiding; two organizations with several roles and branches: another company's customer returns 404 on read/update/archive and never appears in lists, same-company missing permission returns 403
    - _Requirements: 10.2, 10.3, 10.5, 10.7, 10.9, 6.13, 18.6_

- [x] 12. Machine models, machines and machine documents API
  - [x] 12.1 Implement machine models and machines
    - `server/src/modules/machines/` and `shared/dto/machines.ts`: model CRUD with `UNIQUE(org_id, make, model)`; machine CRUD/archive with required branch, model, asset/fleet/serial numbers and 409 field errors on duplicates; status enums; direct update to Allocated/On Hire/Transport only through audited manual action with reason; no model-default overwrite; archive when referenced; `custom_attributes`; filters by branch/status/readiness/model with pagination
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.9, 11.11, 11.12_
  - [x] 12.2 Implement machine documents
    - `server/src/modules/machineDocuments/`: list/create/deactivate for Registration, Insurance, Certificate, Manual, Permit; file must be Verified and Clean or 422 `FILE_INVALID`; authorization through the owning machine's organization and branch
    - _Requirements: 11.7, 11.8, 11.10_
  - [x] 12.3 Register machine routers
    - Edit `server/src/routes.ts`
    - _Requirements: 2.1_
  - [ ]* 12.4 Write property test for duplicate machine identifiers
    - File `server/tests/property/machineDuplicates.property.test.ts` (real fleet_test)
    - **Property 33: Duplicate asset/fleet/serial numbers are always rejected within one organization**
    - **Validates: Requirements 11.3**
  - [ ]* 12.5 Write property test for machine status enums
    - File `server/tests/property/machineStatus.property.test.ts`
    - **Property 34: Machine status fields are restricted to their allowed enum sets**
    - **Validates: Requirements 11.4**
  - [x] 12.6 Write integration tests for machines including cross-tenant (T18)
    - File `server/tests/integration/machines.int.test.ts`: duplicate asset/fleet/serial 409, reserved status requires reason and audit, document attach with non-Clean file 422, archive of referenced machine; other company's machine, model and document return 404; branch-scoped principal cannot read other-branch machine documents
    - _Requirements: 11.3, 11.5, 11.8, 11.9, 11.10, 6.13, 18.6_

- [x] 13. Quotations and phase history API
  - [x] 13.1 Implement the pure transition function
    - `server/src/modules/quotations/transitions.ts` with `checkTransition` exactly per the design (six allowed pairs, reason 1..500 trimmed for LOST and reopen, reopen permission, WON terminal)
    - _Requirements: 12.3, 12.4, 12.5, 12.7, 12.8, 12.9_
  - [x] 13.2 Implement the quotations module
    - `server/src/modules/quotations/` and `shared/dto/quotations.ts`: create (idempotent, phase AWAITING, number allocator, initial Phase_History row, customer same organization and branch scope), list/read/filter by phase/customer/branch/sales user/number with pagination, update with `If-Match` and amount/currency validation, `IMMUTABLE_FIELD` 409 for `customer_id`/`amount` once an agreement exists, own-records restriction for sales role, phase change endpoint that updates quotation, increments version, inserts history and audit in one transaction and sets `won_at`/`lost_*`
    - _Requirements: 12.1, 12.2, 12.3, 12.6, 12.10, 12.13, 12.15, 12.16, 12.17, 12.18_
  - [x] 13.3 Update frontend CRM rules and their tests
    - Edit `src/features/crm/crmRules.ts` so `ALLOWED` includes `['Awaiting','Won']`, and update `src/features/crm/crmRules.test.ts` (add the case that Awaiting to Won succeeds without a reason); update any dependent expectations without deleting tests
    - _Requirements: 12.4, 18.14_
  - [x] 13.4 Register the quotations router
    - Edit `server/src/routes.ts`
    - _Requirements: 2.1_
  - [x] 13.5 Write integration test for the transition table through the API (T01)
    - File `server/tests/integration/quotations.transitions.int.test.ts`: for every ordered phase pair, with and without reason and reopen permission, the API result equals the allowed table and reason rules; WON to anything is `INVALID_TRANSITION`; LOST needs a reason (422 field error `reason`); reopen needs reason (422) and permission (403); history chain invariant holds for several valid sequences; a repeated idempotency key adds no second history row
    - _Requirements: 12.3, 12.4, 12.5, 12.7, 12.8, 12.9, 12.13, 12.14, 18.3, 18.4_
  - [ ]* 13.6 Write property test for transition rules
    - File `server/tests/property/quotationTransitions.property.test.ts`
    - **Property 35: Quotation phase transitions match the allowed-transition and reason-required table exactly**
    - **Validates: Requirements 12.3, 12.5, 12.7, 12.8, 12.9**
  - [ ]* 13.7 Write property test for the phase history chain
    - File `server/tests/property/phaseHistoryChain.property.test.ts` (real fleet_test)
    - **Property 36: Phase history forms a valid chain ending at the current phase**
    - **Validates: Requirements 12.1, 12.14**
  - [ ]* 13.8 Write property test for amount and currency validation
    - File `server/tests/property/quotationAmount.property.test.ts`
    - **Property 37: Quotation amount/currency validation is exact**
    - **Validates: Requirements 12.18**
  - [x] 13.9 Write integration test for phase-change atomicity
    - File `server/tests/integration/quotations.atomicity.int.test.ts`: inject a failure between the quotation update and the history insert and assert neither the new phase nor a history row exists; assert `fleet_app` cannot UPDATE/DELETE history
    - _Requirements: 12.10, 12.11, 12.12, 18.10_
  - [x] 13.10 Write integration tests for quotations including cross-tenant (T18)
    - File `server/tests/integration/quotations.int.test.ts`: customer of another organization rejected, `IMMUTABLE_FIELD` after agreement, sales own-records restriction, concurrent creates give distinct numbers, other company's quotation 404 on read/update/phase change
    - _Requirements: 12.1, 12.2, 12.16, 12.17, 6.13, 18.6_

- [x] 14. Hire agreements and customer LPOs API
  - [x] 14.1 Implement the hire agreements module
    - `server/src/modules/hireAgreements/` and `shared/dto/hireAgreements.ts`: idempotent create with same-organization quotation and matching customer (422 on `customer_id`), `AGREEMENT_EXISTS` 409, number allocation, issuer/customer snapshots with all identity fields, snapshots unchanged after master edits, date order 422 on `hire_end_date`, server-side decimal totals (decimal.js) ignoring client totals, status enum, Cancelled keeps row and number and frees the quotation, `sent_at`/`received_at` audited (received needs evidence or audited reason), separate `crm_ha_reference`, `If-Match` on updates, `payment_term_days` 0..365 and positive integer `quantity`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13_
  - [x] 14.2 Implement the customer LPOs module
    - `server/src/modules/customerLpos/` and `shared/dto/customerLpos.ts`: idempotent create with quotation and customer consistency and optional agreement of the same quotation, customer-supplied `lpo_no` stored as given, per-customer duplicate 409 on `lpo_no`, `valid_until` before `received_on` 422, attached file must be same-organization Verified and Clean else `FILE_INVALID`, several LPOs per agreement, list/read/update with filters and `If-Match`, no internal document generation
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_
  - [x] 14.3 Register hire agreement and LPO routers
    - Edit `server/src/routes.ts`
    - _Requirements: 2.1_
  - [ ]* 14.4 Write property test for agreement dates
    - File `server/tests/property/hireAgreementDates.property.test.ts`
    - **Property 38: Hire agreement date order is enforced**
    - **Validates: Requirements 13.6**
  - [ ]* 14.5 Write property test for agreement totals and money round trip
    - File `server/tests/property/hireAgreementTotals.property.test.ts`; includes the decimal-string parse/format/parse round-trip
    - **Property 39: Hire agreement totals are always server-computed from decimal inputs and client totals are ignored**
    - **Validates: Requirements 13.7, 18.5**
  - [ ]* 14.6 Write property test for payment term and quantity bounds
    - File `server/tests/property/hireAgreementBounds.property.test.ts`
    - **Property 40: payment_term_days and quantity bounds are enforced exactly**
    - **Validates: Requirements 13.13**
  - [ ]* 14.7 Write property test for LPO dates
    - File `server/tests/property/lpoDates.property.test.ts`
    - **Property 41: LPO valid_until must not precede received_on**
    - **Validates: Requirements 14.3**
  - [x] 14.8 Write integration tests for agreements and LPOs including cross-tenant (T18)
    - File `server/tests/integration/hireAgreementsLpos.int.test.ts`: `AGREEMENT_EXISTS`, customer mismatch 422, re-create after Cancelled, snapshot immutability after customer edit, client totals ignored, `received_at` rules, duplicate `lpo_no` per customer, non-Clean LPO file `FILE_INVALID`, several LPOs per agreement; other company's agreements and LPOs return 404
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.7, 13.9, 13.10, 14.2, 14.5, 14.6, 6.13, 18.6_

- [x] 15. Development seed command
  - [x] 15.1 Implement `server/scripts/seedDev.ts`
    - Fixture organization, branches, roles, the user matching `DEV_AUTH_USER_ID`, sample customers, models, machines and quotations; idempotent (upsert by natural keys); refuses in production or on a non-development/test database name; wire to `npm run db:seed:dev`; no seeding at API startup
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_
  - [x] 15.2 Write integration test for the seed command
    - File `server/tests/integration/seed.int.test.ts`: run twice with equal row counts, refuse under `NODE_ENV=production`, refuse non-test database name, fixture user resolves through the identity resolver
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [x] 16. Checkpoint - Backend complete
  - Ensure all server unit, property and integration tests pass, ask the user if questions arise.

- [x] 17. Frontend API client
  - [x] 17.1 Implement the http client, error mapping and idempotency keys
    - `src/services/api/http.ts` (`apiRequest`, `ApiClientError`, `mapErrorBody`, relative `/api/v1` URLs, credential attach, `If-Match`/`Idempotency-Key` headers, connection error naming `/api/v1`) and `src/services/api/idempotency.ts` (`getOrCreateIdempotencyKey`, `clearSubmission`)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.15_
  - [x] 17.2 Implement the frontend auth adapter
    - Edit `src/features/auth/authStore.ts` and add `src/services/api/session.ts`: obtain the dev fixture session, keep the token in memory only, read `GET /api/v1/session` for role, actions, organization, branch scope and auth mode, expose a visible "Dev Fixture Auth" indicator flag, stop trusting persisted `isAuthenticated`/role from storage
    - _Requirements: 6.8, 6.10, 15.1, 15.8_
  - [x] 17.3 Implement resource API modules and query keys
    - `src/services/api/customers.ts`, `machines.ts`, `machineModels.ts`, `machineDocuments.ts`, `quotations.ts`, `hireAgreements.ts`, `customerLpos.ts`, `company.ts`, `queryKeys.ts` (keys include organization id, branch scope, resource id and filters), types from `shared/dto`
    - _Requirements: 15.4, 15.5, 15.6_
  - [x] 17.4 Configure the Vite proxy and cache reset
    - Edit `vite.config.ts` to proxy `/api` to the local Express port; edit `src/app/QueryProvider.tsx` so `resetQueryCache()` calls `queryClient.cancelQueries()` before `clear()`
    - _Requirements: 15.7, 15.16_
  - [ ]* 17.5 Write property test for error mapping
    - File `src/services/api/http.property.test.ts`
    - **Property 42: API error body mapping preserves code, fieldErrors and correlationId exactly**
    - **Validates: Requirements 15.2**
  - [ ]* 17.6 Write property test for idempotency key reuse
    - File `src/services/api/idempotency.property.test.ts`
    - **Property 43: Idempotency-Key reuse matches the retry/new-submission rule**
    - **Validates: Requirements 15.3**
  - [ ]* 17.7 Write unit tests for the client
    - File `src/services/api/http.test.ts`: headers, `If-Match`, relative URLs, 503 and network error messages
    - _Requirements: 15.1, 15.4, 15.11, 15.15_

- [x] 18. Switch CRM screens to the API
  - [x] 18.1 Switch the Customers screens
    - Locate the Customers feature with `grep` under `src/features`; replace store/mock authority with React Query hooks on `customersApi`; loading, error (message plus correlation id, entered values kept), 409 conflict reload-without-discard, 503 message with no mock data
    - _Requirements: 15.5, 15.9, 15.10, 15.11_
  - [x] 18.2 Switch the Fleet screens
    - Machines, models and machine documents through `machinesApi`, `machineModelsApi`, `machineDocumentsApi` with the same loading/error/conflict behavior
    - _Requirements: 15.5, 15.9, 15.10, 15.11_
  - [x] 18.3 Switch the CRM pipeline and Status panel
    - `src/features/crm`: quotations and phase changes through `quotationsApi`, manual AWAITING to WON action, required reason for Lost and reopen, stale-version handling
    - _Requirements: 15.5, 15.10, 15.12_
  - [x] 18.4 Switch the Hire Agreement page
    - Agreement create/update through `hireAgreementsApi` with server-computed totals shown from the response, `AGREEMENT_EXISTS` handling, `If-Match` on edits
    - _Requirements: 15.4, 15.5, 15.9, 15.10_
  - [x] 18.5 Build the LPO page
    - Replace the placeholder route with a page that lists, creates and edits LPOs through `customerLpoApi`; edit `src/app/AppRouter.tsx` only if the route wiring needs it
    - _Requirements: 15.13_
  - [x] 18.6 Add read adapters for retained browser screens
    - Edit `src/services/services.ts` so `customerService` and `machineService` keep their exported signatures but call the API modules and map DTOs back to existing `Customer`/`Machine` shapes; add `src/services/api/readAdapters.ts` exposing quotations and agreements in the shapes used by `customerLinks.ts`, `quotationInvoicing.ts` and `collectionDocs.ts`
    - _Requirements: 15.17, 15.18_
  - [x] 18.7 Remove implicit demo seeding and persisted business data for moved screens
    - Edit the zustand stores (`crmStore`, `hireAgreementStore`, customer/fleet stores) so the moved resources hold only UI state (filters, selections, drafts) and no business records or role grants are persisted to localStorage; remove startup demo seeding for these resources
    - _Requirements: 15.5, 15.8, 15.14, 16.5_
  - [ ]* 18.8 Write component tests for the moved screens
    - New test files beside each screen with mocked API modules: loading state, error with correlation id and kept form values, 409 reload offer, 503 message without mock data, Lost/reopen reason required, LPO page list/create
    - _Requirements: 15.9, 15.10, 15.11, 15.12, 15.13_
  - [x] 18.9 Run the existing frontend suite and fix regressions in moved code
    - Run `npx vitest --run` (root) and `npm run typecheck`; planner, invoices, transport, collection, documents, gate and inspection tests, and the root `GatePassDialog*.test.tsx`, must pass without modification
    - _Requirements: 15.17, 18.14_

- [x] 19. Build, start and package
  - [x] 19.1 Verify and complete build and start behavior
    - Ensure `npm run build` outputs `dist/` and `server/dist/` and fails on either error, server ESM imports use correct extensions, `npm start` runs `node server/dist/index.js` with no tsx, serves assets and `/api/v1`, binds `process.env.PORT`, and does not compile or migrate
    - _Requirements: 17.2, 17.3, 17.4_
  - [x] 19.2 Implement `server/scripts/packageAws.ts`
    - Build then create one deterministic ZIP (archiver) with `Procfile`, `package.json`, `package-lock.json`, `server/dist/`, `dist/`, `.platform/` at the root; reject and fail if the ZIP contains `.env`, credentials, local uploads, databases, source attachments or `node_modules`; never upload or deploy
    - _Requirements: 17.7, 17.8_
  - [x] 19.3 Implement the bundle secret scan
    - `server/scripts/scanBundle.ts` (`npm run scan:bundle`): scan `dist/` for `DATABASE_URL`, password-like values, AWS credential patterns and server-only variable names
    - _Requirements: 17.9, 1.11_
  - [ ]* 19.4 Write unit tests for package validation and bundle scan
    - Files `server/tests/unit/packageAws.test.ts` and `server/tests/unit/scanBundle.test.ts` with in-memory file lists: forbidden entries fail, required entries present pass, planted secret strings are detected
    - _Requirements: 17.7, 17.8, 17.9_

- [x] 20. Documentation and test report
  - [x] 20.1 Write the backend runbook
    - Create `docs/backend-runbook.md`: native PostgreSQL role/database creation with `C:\Program Files\PostgreSQL\18\bin`, `.env` setup, migrate, seed, dev (two terminals), build, start, health check, test commands, package command, failed-file recovery, Odoo isolation warning, Node version pin, `--legacy-peer-deps`
    - _Requirements: 17.6, 17.12, 17.13_
  - [x] 20.2 Write the test report
    - Create `docs/backend-test-report.md` from the actual results of tasks 21.1 and 21.2, with separate sections for unit/property, real-database integration, and not run (real AWS S3, real OIDC provider, real file scanner)
    - _Requirements: 18.15_

- [x] 21. Final verification
  - [x] 21.1 Run typecheck, lint and unit/property suites
    - `npm run typecheck` (frontend and server), `npm run lint`, `npm test`; fix failures
    - _Requirements: 17.1, 18.1, 18.14_
  - [x] 21.2 Run integration tests against fleet_test
    - Migrate `fleet_test`, then `npm run test:integration`; confirm T01, T18, T19 and migrate-from-empty tests ran and passed
    - _Requirements: 17.10, 17.11, 18.2, 18.3, 18.6, 18.8_
  - [x] 21.3 Build and smoke-test start against fleet_local
    - `npm run db:migrate` and `npm run db:seed:dev` on `fleet_local`, `npm run build`, start `npm start` as a background process, call `GET /api/v1/health/live` and `/health/ready` (expect 200), `GET /planner` returns index.html, then stop the process
    - _Requirements: 2.7, 2.9, 2.10, 17.2, 17.3_
  - [x] 21.4 Run the package command
    - `npm run package:aws`, confirm the ZIP validation passes and that nothing was uploaded
    - _Requirements: 17.7, 17.8_
  - [x] 21.5 Confirm git state
    - Run `git branch --show-current` (expect `feature/crm-plugin`) and `git status`; confirm no commit was made by these tasks and nothing under `odoo/` changed
    - _Requirements: 3.10_

- [x] 22. Report to the user
  - Write the final chat message: what was built, results of each verification step, which tests are unit, integration or not run, open items from the requirements, and step-by-step local instructions (PostgreSQL service, `npm run db:setup:local`, `.env`, `npm run db:migrate`, `npm run db:seed:dev`, `npm run dev:server`, `npm run dev`, health URL, `npm run test:integration`, `npm run package:aws`)
  - _Requirements: 17.12, 18.15_

## Notes

- Tasks marked with `*` are optional (property tests, component tests, extra unit tests) and can be skipped for a faster MVP. The real-database integration tests for migrate-from-empty (6.6), constraints (6.7), RLS (6.8), numbering concurrency T19 (7.6), transition table T01 (13.5), atomicity (13.9) and cross-tenant T18 (11.5, 12.6, 13.10, 14.8) are required.
- Task 2.2 must stop and ask the user if the local postgres superuser password is unknown.
- Each task references requirement clauses for traceability; property sub-tasks reference the design property numbers.
- No task commits to git.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2", "3.3", "3.4", "3.5"] },
    { "id": 7, "tasks": ["4.1"] },
    { "id": 8, "tasks": ["4.2"] },
    { "id": 9, "tasks": ["4.3", "4.4", "4.5", "4.6"] },
    { "id": 10, "tasks": ["5.1"] },
    { "id": 11, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 12, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 13, "tasks": ["6.5"] },
    { "id": 14, "tasks": ["6.6"] },
    { "id": 15, "tasks": ["6.7", "6.8", "6.9", "6.10", "6.11", "6.12", "6.13", "6.14"] },
    { "id": 16, "tasks": ["7.1"] },
    { "id": 17, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 18, "tasks": ["7.6", "7.7", "7.8", "7.9", "7.10", "7.11", "7.12"] },
    { "id": 19, "tasks": ["8.1", "8.2"] },
    { "id": 20, "tasks": ["8.3"] },
    { "id": 21, "tasks": ["8.4", "8.5", "8.6", "8.7"] },
    { "id": 22, "tasks": ["9.1"] },
    { "id": 23, "tasks": ["9.2", "9.3"] },
    { "id": 24, "tasks": ["9.4"] },
    { "id": 25, "tasks": ["9.5", "9.6", "9.7", "9.8", "9.9", "9.10"] },
    { "id": 26, "tasks": ["10.1", "10.2", "10.3", "10.4"] },
    { "id": 27, "tasks": ["10.5"] },
    { "id": 28, "tasks": ["10.6", "10.7", "10.8", "10.9"] },
    { "id": 29, "tasks": ["11.1"] },
    { "id": 30, "tasks": ["11.2"] },
    { "id": 31, "tasks": ["11.3", "11.4", "11.5"] },
    { "id": 32, "tasks": ["12.1", "12.2"] },
    { "id": 33, "tasks": ["12.3"] },
    { "id": 34, "tasks": ["12.4", "12.5", "12.6"] },
    { "id": 35, "tasks": ["13.1"] },
    { "id": 36, "tasks": ["13.2", "13.3"] },
    { "id": 37, "tasks": ["13.4"] },
    { "id": 38, "tasks": ["13.5", "13.6", "13.7", "13.8", "13.9", "13.10"] },
    { "id": 39, "tasks": ["14.1", "14.2"] },
    { "id": 40, "tasks": ["14.3"] },
    { "id": 41, "tasks": ["14.4", "14.5", "14.6", "14.7", "14.8"] },
    { "id": 42, "tasks": ["15.1"] },
    { "id": 43, "tasks": ["15.2"] },
    { "id": 44, "tasks": ["16"] },
    { "id": 45, "tasks": ["17.1", "17.2"] },
    { "id": 46, "tasks": ["17.3", "17.4"] },
    { "id": 47, "tasks": ["17.5", "17.6", "17.7"] },
    { "id": 48, "tasks": ["18.1", "18.2"] },
    { "id": 49, "tasks": ["18.3"] },
    { "id": 50, "tasks": ["18.4", "18.5"] },
    { "id": 51, "tasks": ["18.6"] },
    { "id": 52, "tasks": ["18.7"] },
    { "id": 53, "tasks": ["18.8", "18.9"] },
    { "id": 54, "tasks": ["19.1"] },
    { "id": 55, "tasks": ["19.2", "19.3"] },
    { "id": 56, "tasks": ["19.4"] },
    { "id": 57, "tasks": ["20.1"] },
    { "id": 58, "tasks": ["21.1"] },
    { "id": 59, "tasks": ["21.2"] },
    { "id": 60, "tasks": ["21.3"] },
    { "id": 61, "tasks": ["21.4"] },
    { "id": 62, "tasks": ["20.2", "21.5"] },
    { "id": 63, "tasks": ["22"] }
  ]
}
```
