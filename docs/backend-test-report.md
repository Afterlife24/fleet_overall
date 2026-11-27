# Backend test report

Run date: 27 November 2026, branch `feature/crm-plugin`, local Windows machine, Node 22.15.1, PostgreSQL 18.
All numbers below are from the final run after the last code change.

## 1. Static checks and build

| Check | Command | Result |
|---|---|---|
| Type check (frontend, server, shared) | `npm run typecheck` | Pass |
| Production build | `npm run build` (inside `npm run package:aws`) | Pass |
| Bundle secret scan | `npm run scan:bundle` (inside `package:aws`) | Pass, 125 files, no findings |
| AWS package | `npm run package:aws` | Pass, 247 entries, `build-artifacts/fleet-overall-eb.zip`; nothing uploaded |
| Lint | `npm run lint` | 254 errors, all in code that existed before this work; no new errors in changed files |
| Start smoke test | `npm start` against `fleet_local` | `/api/v1/health/live` 200, `/api/v1/health/ready` 200, `/planner` serves `index.html`, unauthenticated API call 401, bookings/invoices/transport-jobs/collection-notes/gate-passes/inspections/delivery-notes 200 with a dev session |

## 2. Unit and property tests (no database)

| Suite | Command | Files | Tests | Result |
|---|---|---|---|---|
| Frontend | `npx vitest --run` | 79 | 349 | All pass |
| Server unit/property | `npm run test:server` | 15 | 82 | All pass |

Optional property tests from the spec were skipped on request.

## 3. Real-database integration tests (`fleet_test`)

Command: `npm run test:integration`. Result: **23 files, 231 tests, all pass.**

| Required test | Covered by |
|---|---|
| T01 Quote create / manual Won / Lost / reopen | `quotations.transitions.int.test.ts`, `quotations.int.test.ts` |
| T02 Start Hire with any transport status | `bookings.startHire.int.test.ts` |
| T03 Start Hire retry, Lost source, wrong customer/company, no partial commit | `bookings.startHire.int.test.ts` |
| T04 Concurrent overlapping bookings, adjacent dates | `bookings.startHire.int.test.ts` |
| T05 Planned end passed, no return: still occupied | `bookings.startHire.int.test.ts` |
| T06 Non-Won invoice rejected without consuming a number | `invoices.int.test.ts` |
| T07 Concurrent invoice periods | `invoices.int.test.ts` |
| T08 Continuous vs Off-Hire end dates | `invoices.int.test.ts` |
| T09 Quantity, VAT, amountDue, transport carry-over | `invoices.int.test.ts` |
| T10 Latest Draft cancellation, issued edit protection | `invoices.int.test.ts` |
| T11 Manual/collection transport persistence | `transportCollection.int.test.ts` |
| T12 Collection without invoice, repeat initiation | `transportCollection.int.test.ts` |
| T13 Stored PDF unchanged after master data change | `documents.int.test.ts` |
| T14 Signed upload / replace / failure / wrong tenant | `documents.int.test.ts` |
| T15 Invalid/stale QR and manual fallback | `gate.int.test.ts` |
| T16 Pending pass vs repeated completion | `gate.int.test.ts` |
| T17 Intake Fail / Pass / release | `gate.int.test.ts` |
| T18 Role / branch / company / cache attacks | `rls.int.test.ts`, `customers/machines/quotations/hireAgreementsLpos.int.test.ts`, `rentalIsolation.int.test.ts` |
| T19 Numbering: no reuse, suffix 100 | `numbering.concurrency.int.test.ts`, `invoices.int.test.ts` |
| T20 Full rental chain | `rental.full.int.test.ts` |

Also covered: migrate from empty, schema constraints, RLS, idempotency, auth, storage, seed.

Bugs found by these tests and fixed: invoice numbers collided across quotations (now `<quotationNo>/<suffix>`); numeric
comparison of echoed amounts on invoice PATCH; Security could not complete a Gate IN (inspection read-back
permission); idempotent replay redacted a business field; three concurrent queries on one transaction client in
collection.

## 4. Not run

| Area | Why |
|---|---|
| Real AWS S3 | No AWS account values supplied; S3 adapter tested with a mocked client only |
| Real OIDC provider | No issuer/audience/JWKS supplied; tested with locally generated RS256 keys |
| Real file scanner | No scanner supplied; the verification adapter is the local pass-through |
| Browser end-to-end (clicking through the UI) | Not automated; screens are covered by component tests with mocked API modules |
| Delivery Note and HIRE MQD/TPS routes directly | Exercised only through shared code paths; no dedicated integration test yet |
