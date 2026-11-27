# Requirements Document

## Introduction

The Fleet application is currently browser-only: business data lives in mock services (`src/services/services.ts`), persisted zustand stores and IndexedDB. This feature implements Stage 1 of the backend handoff (`README.md`, `APPLICATION_BUILD_AND_AWS_HANDOFF.md`, `DATABASE_DESIGN.md`, `IMPLEMENTATION_PLAN.md`): a Node.js/TypeScript/Express JSON API under `/api/v1`, a real PostgreSQL schema of 37 tables, verified-identity authentication, private file storage, and the "CRM chain" (company, customers, fleet, quotations, hire agreements, LPOs) moved onto the API.

Stage 1 has two parts.

- **Part A, Foundation:** server configuration, health, errors, PostgreSQL migrations for all 37 tables, tenant isolation with row-level security, authentication boundary, file storage adapters, build/start/package commands.
- **Part B, CRM chain:** company/branches/roles/users/apps/custom fields, customers, machine models, machines, machine documents, quotations with phase history, hire agreements, customer LPOs, plus idempotency, optimistic concurrency, numbering and audit. The existing Customers, Fleet, CRM pipeline/Status, Hire Agreement and LPO screens use the API.

Context: the in-progress browser-only spec `rental-flow-integration` (gate pass QR, hire documents, browser demo data) is superseded by this backend work and is stopped. It is not continued in this spec.

Constraints:

- The application uses its own PostgreSQL database and role. It never uses the Odoo database or role on the shared local server, and nothing under `odoo/` is modified.
- No real AWS resource, credential or deployment is used. No Docker.
- Commits are made only when the user asks.
- Local PostgreSQL 18 runs as Windows service `postgresql-x64-18`. `psql` is not on PATH; binaries are under `C:\Program Files\PostgreSQL\18`.

## Glossary

- **API_Server**: The Express application in `server/` that serves `/api/v1` and, in production, the compiled React assets.
- **Config_Loader**: The module `server/src/config.ts` that parses and validates environment variables with zod.
- **Migration_Runner**: The command behind `npm run db:migrate` that applies ordered SQL migrations.
- **Migration_Ledger**: The infrastructure table that records applied migration versions and checksums.
- **Runtime_Role**: The least-privilege PostgreSQL role used by the running API_Server. It is neither the table owner nor a role with BYPASSRLS.
- **Migration_Role**: The PostgreSQL role in `MIGRATION_DATABASE_URL` used only by the Migration_Runner.
- **Tenant_Context**: The transaction-local PostgreSQL setting that carries the authenticated organization id for row-level security.
- **Transaction_Helper**: The shared function that runs a command on one pooled connection with BEGIN, Tenant_Context, work, COMMIT or ROLLBACK, and always releases the connection.
- **Principal**: The authenticated identity (company, user, role, branch scope) derived from a verified token and database records.
- **Identity_Resolver**: The least-privilege database function that maps a verified provider subject to its active user and company before Tenant_Context exists.
- **OIDC_Adapter**: The authentication adapter that verifies signature, algorithm, issuer, audience and expiry of an OIDC token against configured JWKS.
- **Dev_Fixture_Auth**: The explicit local-only authentication mode that selects a preseeded fixture user by server configuration.
- **File_Storage**: The server interface with `put`, `head`, `read` and `removeUnattached` operations.
- **Local_Storage_Adapter**: The File_Storage implementation that writes to a private filesystem root.
- **S3_Storage_Adapter**: The File_Storage implementation that uses AWS SDK v3 through an injected client.
- **Verification_Adapter**: The interface that scans or verifies an uploaded file and returns a scan status.
- **Upload_Validator**: The component that checks size and content signature of an upload.
- **Idempotency_Store**: The `idempotency_keys` table and the logic that replays or rejects repeated mutations.
- **Number_Allocator**: The component that allocates business numbers from `number_sequences` under a row lock.
- **Audit_Log**: The append-only `audit_events` table.
- **Row_Version**: The `row_version` column used with the `If-Match` request header for optimistic concurrency.
- **Quotation**: A row in `quotations` with phase AWAITING, TENDER, LOST or WON.
- **Phase_History**: The append-only `quotation_phase_history` table.
- **Hire_Agreement**: A row in `hire_agreements`, one transactional agreement for a Quotation.
- **Customer_LPO**: A row in `customer_lpos`, a customer purchase order record.
- **CRM_Screens**: The existing frontend Customers, Fleet, CRM pipeline/Status panel, Hire Agreement page and LPO page.
- **API_Client**: The typed HTTP adapters in `src/services/api/` used by the frontend.
- **Seed_Command**: The command behind `npm run db:seed:dev` that creates local fixture data.
- **Package_Command**: The command behind `npm run package:aws` that builds and validates a Beanstalk ZIP without uploading it.
- **Test_Database**: An isolated PostgreSQL database whose name is explicitly marked as a test database.

## Requirements

### Requirement 1: Configuration and production guards

**User Story:** As a developer, I want all server settings parsed and validated in one place, so that a misconfigured environment fails at startup with a clear reason.

#### Acceptance Criteria

1. THE Config_Loader SHALL parse every server environment variable defined in handoff section 6.1 and 6.2 with zod, including NODE_ENV, HOST, PORT, APP_PUBLIC_URL, DATABASE_URL, MIGRATION_DATABASE_URL, DATABASE_SSL_MODE, DATABASE_CA_FILE, DATABASE_POOL_MAX, STORAGE_DRIVER, LOCAL_STORAGE_ROOT, MAX_UPLOAD_BYTES, AWS_REGION, S3_BUCKET, S3_KEY_PREFIX, AUTH_MODE, ALLOW_DEV_AUTH, DEV_AUTH_USER_ID, OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL and FILE_SCAN_DRIVER.
2. WHEN a required variable is missing or invalid, THE Config_Loader SHALL stop startup with a non-zero exit code and log the variable names and a safe error code without secret values.
3. IF NODE_ENV is production AND AUTH_MODE is development-fixture, THEN THE Config_Loader SHALL reject the configuration.
4. IF NODE_ENV is production AND STORAGE_DRIVER is local or memory, THEN THE Config_Loader SHALL reject the configuration.
5. IF NODE_ENV is production AND DATABASE_SSL_MODE is not verify-full, THEN THE Config_Loader SHALL reject the configuration.
6. IF NODE_ENV is production AND FILE_SCAN_DRIVER is development-stub, THEN THE Config_Loader SHALL reject the configuration.
7. IF NODE_ENV is production AND any of DATABASE_URL, APP_PUBLIC_URL, OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL, S3_BUCKET or AWS_REGION is blank or contains an unresolved placeholder string such as CHANGE_ME, THEN THE Config_Loader SHALL reject the configuration.
8. WHERE STORAGE_DRIVER is s3, THE Config_Loader SHALL require non-blank AWS_REGION, S3_BUCKET and S3_KEY_PREFIX and reject unresolved placeholder values.
9. WHERE STORAGE_DRIVER is local, THE Config_Loader SHALL accept blank AWS_REGION and S3_BUCKET.
10. IF DATABASE_SSL_MODE is anything other than disable, THEN THE API_Server SHALL create the pg Pool with certificate and hostname verification enabled and SHALL NOT set rejectUnauthorized to false.
11. THE Config_Loader SHALL NOT read any variable with the `VITE_` prefix as a server secret, and no server-only variable SHALL use the `VITE_` prefix.
12. THE `.env.example` file SHALL document every variable from criterion 1 with empty values or clearly marked local-only placeholders and SHALL contain no real credential.
13. THE `.gitignore` file SHALL exclude `.env` files other than `.env.example`, `server/dist/`, the local storage root and generated package ZIPs.

### Requirement 2: API foundation, errors and health

**User Story:** As a frontend developer, I want a predictable JSON API with consistent errors, so that the UI can show truthful states.

#### Acceptance Criteria

1. THE API_Server SHALL mount all business routes under `/api/v1` before any frontend fallback.
2. THE API_Server SHALL generate a correlation id for every request and include it in every error response.
3. WHEN a request fails, THE API_Server SHALL return JSON with the fields `code`, `message`, `fieldErrors`, `correlationId` and `retryable`.
4. WHEN a request body is invalid, THE API_Server SHALL respond with status 422, a `fieldErrors` entry per invalid field, and no raw SQL text.
5. WHEN a request path begins with `/api/` and matches no route, THE API_Server SHALL respond with status 404 and a JSON error body, never `index.html`.
6. WHEN a non-GET and non-HEAD request matches no route, THE API_Server SHALL respond with a JSON error and SHALL NOT serve the SPA fallback.
7. WHERE the compiled frontend exists, WHEN a GET or HEAD request for a non-API navigation path (for example `/planner` or `/crm/won`) is received, THE API_Server SHALL respond with `index.html`.
8. WHEN a request for a missing static asset path (a path with a file extension) is received, THE API_Server SHALL respond with status 404.
9. WHEN `GET /api/v1/health/live` is called, THE API_Server SHALL respond 200 without checking dependencies.
10. WHEN `GET /api/v1/health/ready` is called AND PostgreSQL answers a trivial query, THE API_Server SHALL respond 200 without exposing connection details.
11. IF PostgreSQL is unreachable, THEN THE API_Server SHALL respond to `GET /api/v1/health/ready` with status 503 and to business requests with status 503 and `retryable` true, and SHALL NOT return mock data.
12. THE API_Server SHALL limit JSON request bodies to a configured byte size and reject larger bodies with status 413.
13. WHEN the process receives SIGTERM or SIGINT, THE API_Server SHALL stop accepting new connections, wait up to a configured bounded time for in-flight requests, close the database pool and exit.
14. THE API_Server SHALL write structured JSON logs that contain the correlation id and omit secrets, tokens and connection strings.
15. THE API_Server SHALL use status 401 for missing or invalid identity, 403 for insufficient permission, 404 for missing or inaccessible resource, 409 for stale state, duplicate or conflict, and 422 for business or input rejection.

### Requirement 3: Versioned migrations and runner

**User Story:** As a developer, I want ordered, checksummed SQL migrations, so that any database can be built reproducibly from empty.

#### Acceptance Criteria

1. THE Migration_Runner SHALL apply the SQL files in `server/migrations/` in ascending version order.
2. THE Migration_Runner SHALL record each applied migration version, name and checksum in the Migration_Ledger within the same transaction as the migration.
3. WHEN `npm run db:migrate` is run a second time with no new files, THE Migration_Runner SHALL apply nothing and exit with code 0.
4. IF the checksum of an already-applied migration file differs from the ledger value, THEN THE Migration_Runner SHALL stop with a non-zero exit code and report the migration version.
5. WHILE one Migration_Runner holds the migration lock, THE Migration_Runner SHALL make a second concurrent runner wait or exit without applying any migration.
6. THE Migration_Runner SHALL connect with MIGRATION_DATABASE_URL and SHALL exit with a non-zero code when that variable is blank.
7. THE API_Server SHALL NOT apply migrations or create schema at startup.
8. THE Migration_Runner SHALL create the `btree_gist` extension, the Runtime_Role grants, and the schema objects of Requirement 4 on an empty Test_Database.
9. IF the Migration_Runner target database name is not the application database or a Test_Database, THEN THE Migration_Runner SHALL refuse to run.
10. THE Migration_Runner SHALL NOT drop, recreate or reseed any non-test database.
11. THE application database and its roles SHALL be separate from the Odoo database and roles, and THE Migration_Runner SHALL refuse a target whose database name matches the configured Odoo database name denylist.

### Requirement 4: Schema of the 37 tables

**User Story:** As a developer, I want the exact current-scope schema in PostgreSQL, so that later stages build on correct constraints.

The 37 tables are derived from DATABASE_DESIGN.md section 3 because TABLE_INVENTORY.md is unavailable (see Open items): organizations, branches, roles, users, organization_apps, custom_field_definitions, customers, machine_models, machines, machine_documents, quotations, quotation_phase_history, hire_agreements, customer_lpos, bookings, invoices, invoice_lines, drivers, transport_vehicles, transport_jobs, gate_passes, gate_movements, collection_notes, mqd_reports, third_party_service_reports, third_party_service_lines, delivery_notes, inspections, inspection_results, files, documents, document_versions, document_files, evidence_attachments, number_sequences, idempotency_keys, audit_events.

#### Acceptance Criteria

1. THE Migration_Runner SHALL create exactly the 37 business tables listed above, plus only the Migration_Ledger as infrastructure.
2. THE schema SHALL define every column, type, nullability, default, enum or check value, and unique constraint stated for each table in DATABASE_DESIGN.md section 3.
3. THE schema SHALL define on every table except organizations the columns `id uuid` default `gen_random_uuid()` and `org_id`, with `UNIQUE(org_id,id)`.
4. THE schema SHALL define on every mutable table the columns `created_at`, `updated_at`, `created_by`, `updated_by` and `row_version` with the defaults in DATABASE_DESIGN.md section 2.
5. THE schema SHALL define the append-only tables quotation_phase_history, gate_movements and audit_events with `created_at` and `created_by` only, and SHALL reject UPDATE and DELETE on them for the Runtime_Role.
6. THE schema SHALL define every domain and user foreign key as the composite `(org_id, foreign_id)` referencing the parent `(org_id, id)`.
7. IF a row references a parent row of a different organization, THEN THE database SHALL reject the insert or update with a foreign key violation.
8. THE schema SHALL create the cyclic foreign keys (users created_by/updated_by, documents current_version_id) after both tables exist.
9. THE schema SHALL define money columns as `numeric(20,6)`, quantities and rates as `numeric(18,6)`, tax fraction as `numeric(9,6)`, and currency codes as three-letter uppercase values enforced by a check.
10. THE schema SHALL create the btree_gist exclusion constraints `ex_machine_planned_booking`, `ex_machine_physical_booking` and `ex_quote_invoice_overlap`, the check constraints `ck_booking_dates`, `ck_actual_booking_return` and `ck_invoice_dates`, and the partial unique indexes `uq_live_quote_agreement` and `uq_open_collection`, as stated in DATABASE_DESIGN.md section 5.1.
11. WHEN two bookings rows for the same machine in the same organization have overlapping date ranges AND both statuses are in Reserved, Pending Approval, Approved, Allocated or On Hire, THE database SHALL reject the second row.
12. WHEN two non-cancelled hire_agreements rows share one quotation_id, THE database SHALL reject the second row.
13. THE schema SHALL define an index on every foreign key column and on the list and filter fields named in DATABASE_DESIGN.md.
14. THE schema SHALL define the quotation phase check values AWAITING, TENDER, LOST and WON and the Hire_Agreement status values Draft, Active, Completed and Cancelled.
15. THE schema SHALL enforce a same-customer rule so that a hire_agreements row whose customer differs from its quotation's customer is rejected.
16. THE schema SHALL enforce that exactly one owner foreign key is populated on documents and on evidence_attachments.

### Requirement 5: Tenant isolation and database roles

**User Story:** As a company administrator, I want one company's data to be invisible to others, so that tenant isolation holds even if application code has a bug.

#### Acceptance Criteria

1. THE Migration_Runner SHALL enable and force row-level security on every organization-scoped table with a policy that compares `org_id` with the Tenant_Context.
2. THE Runtime_Role SHALL be a role that is not the table owner, does not have BYPASSRLS and has only the privileges needed by the API_Server.
3. THE Transaction_Helper SHALL use one pooled connection for BEGIN, setting Tenant_Context with a transaction-local setting, all queries, and COMMIT or ROLLBACK, and SHALL release the connection in all outcomes.
4. WHEN a transaction ends, THE Transaction_Helper SHALL leave no Tenant_Context on the pooled connection.
5. WHEN a query runs as the Runtime_Role without Tenant_Context, THE database SHALL return zero rows from organization-scoped tables and SHALL reject inserts.
6. WHEN a query runs as the Runtime_Role with Tenant_Context for organization A, THE database SHALL return no rows that belong to organization B and SHALL reject inserts with `org_id` of organization B.
7. THE API_Server SHALL derive Tenant_Context only from the Principal and SHALL ignore any organization id, role or user id supplied in request headers, query strings or bodies.
8. THE API_Server SHALL use parameterized SQL for every query and SHALL whitelist selectable sort fields.
9. THE Identity_Resolver SHALL be the only mechanism that reads users before Tenant_Context exists, SHALL use a fixed safe search path, and SHALL expose no unrestricted user listing.

### Requirement 6: Authentication and principal

**User Story:** As an employee, I want the API to know who I am from a verified identity, so that my role and branch limit what I can do.

#### Acceptance Criteria

1. WHEN a request to a protected `/api/v1` route has no credential, THE API_Server SHALL respond with status 401.
2. WHERE AUTH_MODE is oidc, THE OIDC_Adapter SHALL accept a token only when signature, permitted algorithm, issuer, audience and expiry all verify against configured values.
3. IF a token is decoded but not verified, expired, or has the wrong issuer or audience, THEN THE OIDC_Adapter SHALL reject the request with status 401.
4. WHEN a token verifies, THE API_Server SHALL resolve the provider subject through the Identity_Resolver to one active user and derive company, role and branch scope from the database.
5. IF the resolved user is INACTIVE or SUSPENDED, THEN THE API_Server SHALL respond with status 401 even when the token is otherwise valid.
6. WHERE AUTH_MODE is development-fixture, THE API_Server SHALL start only when NODE_ENV is development or test, ALLOW_DEV_AUTH is true and HOST is a loopback address.
7. WHILE Dev_Fixture_Auth is active, THE API_Server SHALL select only the preseeded fixture user identified by DEV_AUTH_USER_ID and SHALL ignore any requested role, organization or password.
8. WHILE Dev_Fixture_Auth is active, THE API_Server SHALL issue short-lived tokens verified locally and SHALL expose the active auth mode through the session endpoint so the frontend can display it.
9. WHERE AUTH_MODE is oidc and the OIDC settings are blank, THE API_Server SHALL fail startup in production and report authentication as not configured in development.
10. THE API_Server SHALL NOT trust an `isAuthenticated`, role or organization value from browser storage.
11. THE API_Server SHALL NOT create password tables or password login endpoints.
12. WHEN `GET /api/v1/session` is called with a valid credential, THE API_Server SHALL return the user id, display name, role code, permitted action codes, organization id and name, branch scope and auth mode.
13. WHEN a Principal lacks the permission code for an action or the branch of a resource, THE API_Server SHALL respond with status 403 for a known resource of its own company and 404 for a resource of another company.
14. IF an action code is not in the server allowlist, THEN THE API_Server SHALL deny the action.

### Requirement 7: File storage foundation

**User Story:** As a developer, I want a provider-independent private file store, so that documents can be saved locally now and in S3 later.

#### Acceptance Criteria

1. THE File_Storage interface SHALL provide `put`, `head`, `read` and `removeUnattached` with the signatures in handoff section 9.1.
2. THE API_Server SHALL generate every storage key on the server in the form `environment/orgUUID/fileUUID/original.<ext>`, deriving the organization from the Principal.
3. IF a requested key or filename contains a path traversal sequence, an absolute path or a drive letter, THEN THE File_Storage SHALL reject the operation without touching the filesystem or bucket.
4. THE Local_Storage_Adapter SHALL resolve LOCAL_STORAGE_ROOT once to an absolute path outside `dist/`, `src/` and any public directory.
5. WHEN `put` is called, THE Local_Storage_Adapter SHALL write to a temporary file, stream bytes while counting, and rename to the final key only after the count is within `maxBytes`.
6. IF a stream exceeds `maxBytes`, THEN THE File_Storage SHALL abort, remove the partial data and report a size error.
7. WHEN `put` completes, THE File_Storage SHALL return the key, the byte count and the SHA-256 of the stored bytes.
8. WHEN `read` is called after the server process restarts, THE Local_Storage_Adapter SHALL return the same bytes with the same SHA-256 as stored.
9. THE API_Server SHALL NOT mount the local storage folder with a static file handler.
10. WHERE STORAGE_DRIVER is local, THE API_Server SHALL make no AWS network call or credential lookup.
11. WHERE STORAGE_DRIVER is s3, THE S3_Storage_Adapter SHALL use an injected AWS SDK v3 client, the configured bucket and key prefix, and the SDK default credential chain, with no access key read from application configuration.
12. THE S3_Storage_Adapter SHALL be tested with a mocked client that asserts bucket, prefix-qualified key, body, content type and error mapping, and SHALL NOT call real AWS in any test in this stage.
13. WHEN the S3 client reports missing, denied or provider failure, THE S3_Storage_Adapter SHALL map the failure to a domain error without credentials or signed URLs in the message.
14. IF STORAGE_DRIVER is s3 AND configuration is blank or placeholder, THEN THE API_Server SHALL fail with a STORAGE_NOT_CONFIGURED error and SHALL NOT fall back to local storage.
15. THE Upload_Validator SHALL accept only content whose leading bytes match PDF, PNG or JPEG signatures, with a size from 1 byte to MAX_UPLOAD_BYTES (default 10485760).
16. IF an upload is empty, larger than the limit, or its signature does not match its declared content type, THEN THE Upload_Validator SHALL reject it with the code FILE_INVALID.
17. THE Verification_Adapter SHALL provide a development-stub implementation that is selectable only when NODE_ENV is development or test and that records an audit marker stating that no malware scan occurred.
18. WHILE a file's scan status is not Clean, THE API_Server SHALL keep the file inaccessible for attachment and download.

### Requirement 8: Idempotency, concurrency, numbering and audit

**User Story:** As a user, I want retried or concurrent requests to be safe, so that I never get duplicate records or lost updates.

#### Acceptance Criteria

1. WHEN a mutating request carries an Idempotency-Key AND the same key and request hash were completed, THE Idempotency_Store SHALL return the original status and body without repeating the change.
2. IF the same Idempotency-Key is used with a different request hash, THEN THE Idempotency_Store SHALL reject the request with status 409.
3. THE Idempotency_Store SHALL claim the key inside the command's database transaction, so a rollback leaves no completed key.
4. WHEN a create command that requires an Idempotency-Key arrives without one, THE API_Server SHALL respond with status 422 and the field error `Idempotency-Key`.
5. THE Idempotency_Store SHALL NOT store secrets or signed URLs in retained response bodies.
6. WHEN an update request arrives without `If-Match`, THE API_Server SHALL respond with status 428.
7. IF the `If-Match` value differs from the stored Row_Version, THEN THE API_Server SHALL respond with status 409 and the code STALE_VERSION and SHALL change nothing.
8. WHEN an update succeeds, THE API_Server SHALL increment Row_Version by 1 and return the new value.
9. THE Number_Allocator SHALL lock the matching `number_sequences` row, increment `next_value` and insert the business row in the same transaction.
10. WHEN a command that allocated a number rolls back, THE Number_Allocator SHALL leave `next_value` unchanged.
11. WHEN a record that owns a number is cancelled or archived, THE Number_Allocator SHALL NOT make that number available again.
12. WHEN N concurrent creates run on independent connections, THE Number_Allocator SHALL produce N distinct numbers with no gaps among the committed rows.
13. THE Number_Allocator SHALL derive numbers from the sequence kind, prefix, year and minimum width in the sequence row, and SHALL NOT use array length, unlocked MAX+1 or a timestamp suffix.
14. THE Audit_Log SHALL record an event with actor, action, entity type, entity id, correlation id and before/after data for every create, update, phase change and access or permission change in this stage, in the same transaction as the change.
15. THE Audit_Log SHALL redact passwords, tokens and secrets from before/after data.
16. THE Runtime_Role SHALL be unable to update or delete Audit_Log rows.

### Requirement 9: Company profile, branches, roles, users, apps and custom fields

**User Story:** As a company administrator, I want company settings, team and app configuration saved on the server, so that every employee sees the same configuration.

#### Acceptance Criteria

1. WHEN `GET /api/v1/company` is called, THE API_Server SHALL return the Principal's organization profile including issuer fields, timezone, currency code, VAT rate and the seven gating rule booleans.
2. WHEN an authorized user updates the company profile, THE API_Server SHALL validate the gating rules as exactly the booleans requireQuote, requireHaSent, requireHaReceived, requireLpo, blockCreditHold, requireTpcValid and warnOverdueInspection, and record an audit event.
3. IF a request tries to disable Won-only invoicing or same-company ownership through the gating rules, THEN THE API_Server SHALL reject it with status 422.
4. THE API_Server SHALL provide list, create, update and deactivate operations for branches with a unique code per organization.
5. THE API_Server SHALL provide list operations for roles whose permission codes and app codes are validated against server allowlists.
6. THE API_Server SHALL provide list, create, update and status-change operations for users with exactly one role and one organization per user and a unique normalized email.
7. WHEN a user's role, branch scope or status changes, THE API_Server SHALL record an audit event with the previous and new values.
8. THE API_Server SHALL provide read and update operations for organization_apps (active, onboarded) validated against the app catalog in `src/constants/apps.ts` and its dependencies.
9. WHEN an app is deactivated, THE API_Server SHALL retain all transactional and master records.
10. THE API_Server SHALL provide list, create, update and deactivate operations for custom_field_definitions with unique `(org_id, app_code, entity_type, field_key)` and the types TEXT, NUMBER, CURRENCY, DATE, SELECT and BOOLEAN.
11. IF a custom field request would delete or retype a system field, THEN THE API_Server SHALL reject it with status 422.
12. THE API_Server SHALL restrict each operation in criteria 1 to 11 to Principals with the matching permission code.

### Requirement 10: Customers

**User Story:** As a sales user, I want customers stored on the server, so that every browser shows the same customer record.

#### Acceptance Criteria

1. THE API_Server SHALL provide list, read, create, update and archive operations for customers with fields as defined in DATABASE_DESIGN.md section 3.2.
2. WHEN a customer is created, THE API_Server SHALL require Idempotency-Key and allocate a unique `customer_code` per organization through the Number_Allocator unless an explicit unique code is supplied.
3. IF `customer_code` or a non-null `fleet_log_code` duplicates one in the same organization, THEN THE API_Server SHALL respond with status 409 and a field error naming the field.
4. THE API_Server SHALL accept the customer statuses ACTIVE, INACTIVE, SUSPENDED and BLACKLISTED and reject any other value.
5. WHEN a customer is referenced by a quotation or agreement, THE API_Server SHALL reject hard deletion and offer archive (status INACTIVE) instead.
6. THE API_Server SHALL NOT merge customers automatically on name similarity.
7. WHEN a Principal's branch scope excludes a customer's branch, THE API_Server SHALL omit that customer from lists and respond 404 on direct read.
8. THE API_Server SHALL validate `custom_attributes` against active custom_field_definitions of entity type customer.
9. THE API_Server SHALL support filtering customers by status and branch and searching by name or code with pagination, using parameterized SQL.

### Requirement 11: Machine models, machines and machine documents

**User Story:** As a fleet manager, I want models, machines and their documents saved on the server, so that the whole team sees the same fleet.

#### Acceptance Criteria

1. THE API_Server SHALL provide list, read, create and update operations for machine_models with `UNIQUE(org_id, make, model)`.
2. THE API_Server SHALL provide list, read, create, update and archive operations for machines with a required branch, model, asset number, fleet number and serial number, each unique per organization where DATABASE_DESIGN.md requires.
3. IF asset number, fleet number or serial number duplicates one in the same organization, THEN THE API_Server SHALL respond with status 409 and a field error naming the field.
4. THE API_Server SHALL accept `operational_status` only from Available, Allocated, On Hire, Under Repair, In Workshop, PDI, PHI, Transport, Breakdown and Offline, and `readiness_status` only from READY, INTAKE_PENDING and BLOCKED.
5. THE API_Server SHALL NOT allow a direct update of `operational_status` to a value reserved for later-stage commands (Allocated, On Hire, Transport) except through an audited permitted manual action with a reason.
6. THE API_Server SHALL NOT copy model defaults over individual machine characteristics that the user saved.
7. THE API_Server SHALL provide list, create and deactivate operations for machine_documents of types Registration, Insurance, Certificate, Manual and Permit, each linked to a verified file.
8. WHEN a machine document file is not Verified and Clean, THE API_Server SHALL reject attaching it with status 422 and the code FILE_INVALID.
9. WHEN a machine is referenced by other records, THE API_Server SHALL reject hard deletion and offer archive (active false).
10. THE API_Server SHALL resolve machine document authorization through the owning machine's organization and branch scope.
11. THE API_Server SHALL validate `custom_attributes` against active custom_field_definitions of entity type machine.
12. THE API_Server SHALL support filtering machines by branch, status, readiness and model with pagination.

### Requirement 12: Quotations and phase history

**User Story:** As a sales user, I want quotations and their phase changes stored with history, so that the pipeline is the same for everyone and auditable.

#### Acceptance Criteria

1. WHEN a quotation is created, THE API_Server SHALL require an Idempotency-Key, set the phase to AWAITING, allocate a unique quotation number through the Number_Allocator, and insert a Phase_History row with null `from_phase`, `to_phase` AWAITING and source SYSTEM or MANUAL in the same transaction.
2. THE API_Server SHALL require a customer of the same organization and branch scope on quotation creation.
3. WHEN a manual phase change from AWAITING to TENDER, AWAITING to LOST, AWAITING to WON, TENDER to WON or TENDER to LOST is requested, THE API_Server SHALL apply the change and insert one Phase_History row with source MANUAL.
4. WHEN a manual change from AWAITING to WON is requested, THE API_Server SHALL allow it and set `won_at`; this replaces the current crmRules behavior that forbids it, and `src/features/crm/crmRules.ts` and its tests SHALL be updated to the same rule.
5. WHEN a change to LOST is requested without a trimmed reason of 1 to 500 characters, THE API_Server SHALL respond with status 422 and a field error on `reason`.
6. WHEN a change to LOST succeeds, THE API_Server SHALL store `lost_reason`, `lost_at` and `lost_by`.
7. WHEN a change from LOST to AWAITING (reopen) is requested, THE API_Server SHALL require both a trimmed reason of 1 to 500 characters and the reopen permission code, and otherwise respond with 422 or 403 respectively.
8. IF a change from WON to any other phase is requested, THEN THE API_Server SHALL reject it with status 422 and the code INVALID_TRANSITION.
9. IF a requested transition is not in the set defined by criteria 3 and 7 (for example TENDER to AWAITING, LOST to TENDER or LOST to WON), THEN THE API_Server SHALL reject it with status 422 and the code INVALID_TRANSITION and change nothing.
10. WHEN a phase change is applied, THE API_Server SHALL update the quotation, increment Row_Version, insert the Phase_History row and an audit event in one transaction.
11. IF the phase change transaction fails after the quotation update, THEN THE database SHALL contain neither the new phase nor the history row.
12. THE database SHALL reject UPDATE and DELETE on Phase_History rows for the Runtime_Role.
13. WHEN a phase change request repeats an Idempotency-Key with the same hash, THE API_Server SHALL return the original response and add no second Phase_History row.
14. FOR ALL valid sequences of manual transitions, THE API_Server SHALL produce a Phase_History chain in which each row's `from_phase` equals the previous row's `to_phase` and the last `to_phase` equals the quotation's current phase (invariant).
15. THE API_Server SHALL provide list, read, update and filter operations for quotations by phase, customer, branch, sales user and number, with pagination.
16. WHEN a quotation update changes commercial fields after a Hire_Agreement exists, THE API_Server SHALL reject changes to `customer_id` and `amount` with status 409 and the code IMMUTABLE_FIELD.
17. THE API_Server SHALL enforce that a sales role restricted to own records sees only quotations whose `sales_user_id` equals the Principal's user id.
18. THE API_Server SHALL accept an update to a quotation's amount and currency only with a valid three-letter currency code and a non-negative decimal string amount.

### Requirement 13: Hire agreements

**User Story:** As a sales user, I want the hire agreement saved against its quotation, so that later stages can rely on one valid agreement per quotation.

#### Acceptance Criteria

1. WHEN a hire agreement is created, THE API_Server SHALL require an Idempotency-Key, a quotation of the same organization and a customer equal to the quotation's customer, and allocate a unique agreement number.
2. IF the quotation already has a non-cancelled Hire_Agreement, THEN THE API_Server SHALL respond with status 409 and the code AGREEMENT_EXISTS.
3. IF the customer differs from the quotation's customer, THEN THE API_Server SHALL respond with status 422 and a field error on `customer_id`.
4. THE API_Server SHALL store issuer and customer snapshots that contain every lessor and hirer identity field shown by the Hire Agreement page (name, address, TRN, attention, email, contact).
5. WHEN a customer or company master later changes, THE API_Server SHALL leave existing agreement snapshots unchanged.
6. IF `hire_end_date` is earlier than `hire_start_date`, THEN THE API_Server SHALL respond with status 422 and a field error on `hire_end_date`.
7. THE API_Server SHALL compute `subtotal`, `vat_amount` and `total_amount` on the server from `monthly_rental`, `transportation_charges` and the organization VAT rate using decimal arithmetic, and ignore client-supplied totals.
8. THE API_Server SHALL accept agreement statuses Draft, Active, Completed and Cancelled and reject other values.
9. WHEN an agreement is set to Cancelled, THE API_Server SHALL retain the row and its number and allow a new non-cancelled agreement for the same quotation.
10. WHEN `sent_at` or `received_at` is set, THE API_Server SHALL record the actor and audit event, and SHALL require signed evidence or an audited manual confirmation reason for `received_at`.
11. THE API_Server SHALL keep the CRM display reference `crm_ha_reference` separate from the agreement id and agreement number.
12. THE API_Server SHALL require Row_Version through `If-Match` for every agreement update.
13. THE API_Server SHALL validate `payment_term_days` as an integer from 0 to 365 and `quantity` as a positive integer.

### Requirement 14: Customer LPOs

**User Story:** As a sales user, I want customer LPO details saved against the quotation and agreement, so that the LPO gate and later documents use real records.

#### Acceptance Criteria

1. WHEN an LPO is created, THE API_Server SHALL require an Idempotency-Key, a quotation and customer of the same organization with the customer equal to the quotation's customer, and an optional hire agreement of the same quotation.
2. IF the same customer already has an LPO with the same `lpo_no`, THEN THE API_Server SHALL respond with status 409 and a field error on `lpo_no`.
3. IF `valid_until` is earlier than `received_on`, THEN THE API_Server SHALL respond with status 422 and a field error on `valid_until`.
4. THE API_Server SHALL store the customer-provided LPO number as given and SHALL NOT allocate an internal number for it.
5. WHERE an LPO file is attached, THE API_Server SHALL require the file to belong to the same organization and be Verified and Clean, and otherwise respond with FILE_INVALID.
6. THE API_Server SHALL allow several LPOs to reference one agreement.
7. THE API_Server SHALL provide list, read, create and update operations for LPOs filtered by quotation, agreement and customer, using Row_Version for updates.
8. THE API_Server SHALL NOT generate a customer LPO document internally.

### Requirement 15: Frontend API client and CRM screens

**User Story:** As an employee, I want the existing screens to read and write server data, so that my changes persist and show for colleagues.

#### Acceptance Criteria

1. THE API_Client SHALL call relative URLs under `/api/v1` and attach the credential of the active session.
2. THE API_Client SHALL map API error bodies to typed errors that keep `code`, `fieldErrors` and `correlationId`.
3. THE API_Client SHALL send an Idempotency-Key generated once per user submit action and reuse the same key when the same submission is retried, and SHALL NOT generate a new key automatically for an unsafe retry.
4. THE API_Client SHALL send `If-Match` with the last-read Row_Version on every update.
5. THE CRM_Screens SHALL read and write customers, machines, models, machine documents, quotations, phase changes, hire agreements and LPOs through the API_Client and SHALL NOT use `services.ts` mock arrays, localStorage or IndexedDB as the authority for these records.
6. THE React Query keys for these resources SHALL include the organization id, branch scope, resource id and filters.
7. WHEN the session, organization or branch context changes, THE CRM_Screens SHALL cancel in-flight requests and clear cached data of the previous context.
8. THE zustand stores used by the CRM_Screens SHALL hold only UI state (filters, selections, unsaved drafts) and SHALL NOT persist business records or role grants to localStorage.
9. WHILE a request is loading, THE CRM_Screens SHALL show a loading state; WHEN a request fails, THE CRM_Screens SHALL show the error message and correlation id and keep the user's entered form values.
10. WHEN the API returns 409 STALE_VERSION, THE CRM_Screens SHALL show a conflict message and offer to reload the record without discarding the user's entries.
11. WHEN the API returns 503, THE CRM_Screens SHALL show a service-unavailable message and SHALL NOT display mock data.
12. THE CRM pipeline and Status panel SHALL offer the manual AWAITING to WON action per Requirement 12 and require a reason for Lost and for reopen.
13. THE LPO page, currently a placeholder route, SHALL list, create and edit LPOs through the API_Client.
14. THE application SHALL NOT seed demo business records for the moved screens at startup.
15. WHEN the API is not reachable in development, THE CRM_Screens SHALL show a connection error that names the `/api/v1` base path.
16. THE Vite dev server SHALL proxy `/api` to the local Express server.
17. THE screens for planner, invoices, transport, collection, documents, gate and inspections SHALL keep their current browser implementation and SHALL continue to build, render and pass their existing tests.
18. WHERE a retained screen needs customer, machine, quotation or agreement data, THE application SHALL provide a read adapter so those screens do not break when the source moves to the API.

### Requirement 16: Development fixtures and seed

**User Story:** As a developer, I want explicit local fixture data, so that I can run the app without any implicit demo seeding.

#### Acceptance Criteria

1. WHEN `npm run db:seed:dev` is run, THE Seed_Command SHALL create a fixture organization, branches, roles, a fixture user matching DEV_AUTH_USER_ID, sample customers, models, machines and quotations.
2. IF NODE_ENV is production, THEN THE Seed_Command SHALL refuse to run and exit non-zero.
3. IF the target database is not a development or test database, THEN THE Seed_Command SHALL refuse to run.
4. WHEN the Seed_Command is run twice, THE Seed_Command SHALL create no duplicate rows.
5. THE API_Server SHALL NOT create demo business records at startup or on first request.

### Requirement 17: Build, run and package

**User Story:** As a developer, I want a documented command set, so that I can build, test and package the single application.

#### Acceptance Criteria

1. THE root `package.json` SHALL define the commands `dev`, `dev:server`, `db:migrate`, `db:seed:dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:integration` and `package:aws` with the behavior in handoff section 5.
2. WHEN `npm run build` is run, THE build SHALL compile the frontend into `dist/` and the server into `server/dist/` and exit non-zero if either fails.
3. WHEN `npm start` is run after build with production dependencies, THE API_Server SHALL run `node server/dist/index.js`, serve the React assets and `/api/v1`, bind to `process.env.PORT`, and neither compile code nor run migrations.
4. THE compiled server SHALL run as ESM from `server/dist` with correct import paths and not depend on tsx or other development tools.
5. THE repository SHALL contain `Procfile` with `web: node server/dist/index.js` and `.platform/nginx/conf.d/` configuration that allows 12 MiB request bodies and bounded timeouts.
6. THE package.json `engines` field, a developer version file and the documentation SHALL record the same pinned Node.js LTS version, compatible with Node 22 and the repository's Vite version.
7. WHEN `npm run package:aws` is run, THE Package_Command SHALL create one ZIP whose root contains Procfile, package.json, package-lock.json, `server/dist/`, `dist/` and `.platform/`, and SHALL NOT upload or deploy anything.
8. THE Package_Command SHALL verify that the ZIP contains no `.env` file, credential, local upload file, test database, source attachment or node_modules, and fail otherwise.
9. THE built frontend bundle SHALL contain no DATABASE_URL, password, AWS credential or server-only variable name.
10. WHEN `npm run test:integration` is run, THE test runner SHALL use an isolated real PostgreSQL Test_Database and a private temporary file directory.
11. IF the integration test target database name is not marked as a test database, THEN THE test runner SHALL refuse to run.
12. THE runbook SHALL describe native PostgreSQL role and database creation (using binaries under `C:\Program Files\PostgreSQL\18`), migration, seeding, build, health check and failed-file recovery.
13. Package installs for this feature SHALL use `npm install --legacy-peer-deps`.

### Requirement 18: Test coverage

**User Story:** As a maintainer, I want automated tests for the stage, so that the foundation and CRM chain are verified against a real database.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for Config_Loader guards (Requirement 1), Upload_Validator, storage key generation and traversal rejection, error mapping and the quotation transition table.
2. THE test suite SHALL include a real-database integration test that migrates an empty Test_Database, re-runs the migrations with no change, and verifies that all 37 tables exist.
3. THE test suite SHALL include a property-based test (fast-check) for the quotation transition rules: FOR ALL phase pairs, the API result SHALL equal the allowed-transition table and reason rules in Requirement 12 (T01).
4. THE test suite SHALL include a property-based test that FOR ALL valid transition sequences the Phase_History chain invariant of Requirement 12 criterion 14 holds.
5. THE test suite SHALL include a round-trip property for request/response serialization of money decimal strings, so that parse then format then parse yields an equal decimal value.
6. THE test suite SHALL include integration tests with two organizations and several roles and branches proving that reads, writes and file lookups for customers, machines, quotations, agreements and LPOs of another company or branch are denied or return 404 (T18).
7. THE test suite SHALL include an integration test of RLS using the Runtime_Role with and without Tenant_Context.
8. THE test suite SHALL include a concurrency integration test using independent PostgreSQL connections where N concurrent quotation creates yield N distinct contiguous numbers, and a test that a rolled-back create does not consume a number (T19).
9. THE test suite SHALL include integration tests that the same Idempotency-Key replays the original result, a different payload with the same key returns 409, and a stale `If-Match` returns 409.
10. THE test suite SHALL include an integration test that a failure injected between the quotation update and the Phase_History insert leaves neither change.
11. THE test suite SHALL include integration tests for the database constraints in Requirement 4 criteria 7, 11, 12, 15 and 16 using direct SQL with the Runtime_Role.
12. THE test suite SHALL include a local storage test that stores a PDF, restarts the storage adapter and reads identical bytes and SHA-256, and a test that an S3 mock receives the expected bucket, key, body and content type.
13. THE test suite SHALL include a production-configuration test that development auth, local storage, disabled TLS, the stub verifier and unresolved placeholders are rejected.
14. THE existing frontend tests for screens outside this stage SHALL continue to pass, and tests invalidated by Requirement 12 criterion 4 (`crmRules.test.ts`) SHALL be updated rather than deleted.
15. THE test report SHALL state separately which tests are unit, real-database integration and not run (real AWS S3, real OIDC provider).

## Out of scope / later stages

The following are not part of Stage 1. Their screens keep the current browser implementation and must not break.

- Planner bookings, availability and atomic Start Hire with automatic Won (T02 to T05). The `bookings` table is created by the migrations, but no booking API is built.
- Invoice generation, invoice lines and period rules (T06 to T10). Tables are created; no API.
- Transport jobs, drivers, vehicles and collection initiation (T11, T12). Tables are created; no API.
- Documents, PDF generation, document versions and signed copy upload/replace (T13, T14), beyond the storage foundation of Requirement 7. The `documents`, `document_versions` and `document_files` tables are created; no document API.
- Gate passes, gate movements, QR resolution, inspection and intake hold (T15 to T17).
- Full rental flow (T20).
- Delivery Note, MQD, TPS and evidence upload endpoints.
- Real AWS provisioning, S3 integration against a real bucket, real OIDC provider registration, a production file scanner, RDS connection and Beanstalk deployment (handoff section 13).
- Importing existing browser data into PostgreSQL. Existing browser exports are preserved and no import feature is added.
- The superseded `rental-flow-integration` spec.

## Open items

1. `TABLE_INVENTORY.md` is not available. The 37-table list in Requirement 4 is derived from DATABASE_DESIGN.md section 3 and should be confirmed against the inventory when it is supplied.
2. `CODE_AND_REQUIREMENTS_TRACEABILITY.md` is not available. The source-to-table mapping and confirmed UI gaps are derived from the other documents and from source inspection, and should be reconciled when the file is supplied.
3. Real OIDC provider values (issuer, audience, JWKS URL, registered client id and redirect URI) are not supplied. Production login remains unconfigured, and Stage 1 reports this limitation.
4. A production file scanner is not selected. Only the development stub exists, and production uploads stay disabled until a scanner is configured.
5. AWS values (region, bucket, prefix, instance role, RDS endpoint and CA, Beanstalk environment, final HTTPS domain) are not supplied. The S3 adapter is verified by mocks only.
6. The exact pinned Node.js LTS version for Beanstalk must be confirmed against the Beanstalk platform available at implementation. Local Node is v22.15.1.
7. The permission code list per role, including the reopen permission, must be derived from `authStore` during design.
8. The Odoo database name denylist used by Requirement 3 criterion 11 must be confirmed (database name on the shared server).
9. The dev-fixture token mechanism (locally signed JWT versus opaque session) is a design decision.
10. Handoff section 3.2 lists `files` and `documents` rows used by machine documents and LPO files. Stage 1 implements only the file records and verification states needed for these attachments, not the document version workflow.
