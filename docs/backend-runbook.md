# Backend runbook

Covers the whole rental chain: company/users, customers, fleet, CRM, hire agreements, LPOs, planner bookings and
Start Hire, invoices, transport and collection, documents (DN, CN, MQD, TPS, signed copies), gate and return intake.

This covers running the Express + PostgreSQL backend locally on Windows, building, packaging for
Elastic Beanstalk, and recovering from common failures. All commands run from the repo root in
PowerShell.

## Prerequisites

- Node.js 22 (pinned in `.nvmrc` and `package.json` `engines`: `>=22.0.0 <23`).
- PostgreSQL 18 installed natively (service `postgresql-x64-18`). Binaries:
  `C:\Program Files\PostgreSQL\18\bin`.
- Install packages with `npm install --legacy-peer-deps`. Plain `npm install` fails on peer ranges.

> **Odoo isolation.** The same PostgreSQL server also hosts the Odoo database `odoo_dev` and the
> role `odoo`. Never point any `fleet_*` URL at them. The migration runner and seed command refuse
> to run against `odoo_dev` or as `odoo`.

## 1. Create roles and databases (once)

```powershell
npm run db:setup:local
```

The script asks for the `postgres` superuser password, then creates:

| Role | Purpose |
|---|---|
| `fleet_owner` | Owns the schema objects (NOLOGIN) |
| `fleet_migrator` | Runs migrations, owns `fleet_local` and `fleet_test` |
| `fleet_app` | Runtime login. Not owner, no `BYPASSRLS`, so row-level security applies |

and the databases `fleet_local` (development) and `fleet_test` (integration tests, reset by every
run). Generated passwords are written to `.env.local-db` (gitignored). Do it by hand instead with
`psql` from `C:\Program Files\PostgreSQL\18\bin` if you prefer; the SQL is in
`server/scripts/dbSetup.ts`.

## 2. Configure `.env`

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL`: `fleet_app` on `fleet_local`.
- `MIGRATION_DATABASE_URL`: `fleet_migrator` on `fleet_local`.
- `TEST_DATABASE_URL`: `fleet_migrator` on `fleet_test`.
- `AUTH_MODE=development-fixture`, `ALLOW_DEV_AUTH=true`, `DEV_AUTH_USER_ID=<seeded user id>` for local
  sign-in. Dev auth only works with `NODE_ENV` development/test and a loopback `HOST`.
- `STORAGE_DRIVER=local`, `LOCAL_STORAGE_ROOT=./.local-storage`.

`.env*` files are gitignored except `.env.example`. Never put real values in `VITE_*` variables:
anything prefixed `VITE_` ships to the browser.

## 3. Migrate and seed

```powershell
npm run db:migrate      # applies server/migrations/0001-0010 in order; safe to re-run
npm run db:seed:dev     # one org (dev-fleet), 3 branches, 8 customers, 5 machines, 4 quotations, ...
```

The server never migrates on start-up.

## 4. Run in development (two terminals)

```powershell
# terminal 1: API on http://127.0.0.1:3000
npm run dev:server
# terminal 2: Vite on http://localhost:5173 (proxies /api to :3000)
npm run dev
```

Open `http://localhost:5173`. The header shows a "Dev fixture" badge when dev auth is active.

## 5. Health checks

- `GET http://127.0.0.1:3000/api/v1/health/live` returns 200 while the process is up.
- `GET http://127.0.0.1:3000/api/v1/health/ready` returns 200 when the database answers, 503 otherwise.

## 6. Build and start (production mode)

```powershell
npm run build   # tsc -b + vite build -> dist/, then server tsc -> server/dist/
npm start       # node server/dist/index.js, serves dist/ and /api/v1 on $env:PORT (default 3000)
```

`npm start` does not compile or migrate. Run `npm run db:migrate` first.

## 7. Tests

```powershell
# clear stale shell variables first so .env is used
Remove-Item Env:DATABASE_URL,Env:AUTH_MODE,Env:TEST_DATABASE_URL,Env:MIGRATION_DATABASE_URL,Env:DEV_AUTH_USER_ID -ErrorAction SilentlyContinue

npm run typecheck          # frontend, server and shared
npm run lint
npx vitest --run           # frontend
npm run test:server        # server unit + property tests (no database)
npm run test:integration   # real PostgreSQL against fleet_test
```

Never run two `test:integration` runs at the same time; each run resets `fleet_test`.

## 8. Package for Elastic Beanstalk

```powershell
npm run package:aws        # builds, scans dist/, writes build-artifacts/fleet-overall-eb.zip
npm run scan:bundle        # scan dist/ only
```

The ZIP holds `Procfile`, `package.json`, `package-lock.json`, `server/dist/`, `dist/` and
`.platform/`. The script fails if it would include `.env`, credentials, keys, local uploads,
database files, source files or `node_modules`. It never uploads or deploys anything.

## 9. Recovery

| Problem | Fix |
|---|---|
| Migration failed half-way | Each file runs in one transaction, so nothing from that file is applied. Fix the cause and re-run `npm run db:migrate`. |
| Checksum mismatch on an applied migration | An applied file was edited. Restore it from git; add a new migration for the change. |
| Upload failed or rejected | Rejected or unverified files are never linked to records. Re-upload from the screen. |
| `/health/ready` returns 503 | Check the PostgreSQL service is running and `DATABASE_URL` is correct. |
| 401 on every call locally | `AUTH_MODE`, `ALLOW_DEV_AUTH`, `DEV_AUTH_USER_ID` missing, or `HOST` not loopback. |
| Integration tests fail on connect | `TEST_DATABASE_URL` missing or a stale shell variable overrides `.env` (see section 7). |
| Reset local data | `npm run db:migrate` then `npm run db:seed:dev` (seed is idempotent for the dev org). |
