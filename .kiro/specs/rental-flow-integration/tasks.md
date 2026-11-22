# Implementation Plan: Rental Flow Integration

## Overview

The implementation language is TypeScript (React, zustand, vitest 5.1.1, fast-check v4). Work goes bottom-up: shared pure cores first, then Transport, CRM, Customers, Gate, Hire documents, demo seeding, architecture tests, a checkpoint, the end-to-end verification suite, the traceability matrix, final verification and a user report.

Ground rules for every task:

- Work stays on branch `feature/crm-plugin`. Do not commit. Do not touch anything under `odoo/`.
- Install dependencies with `npm install --legacy-peer-deps` only if a package is missing.
- Pure cores import only types (see the design's Dependency rules). Existing numbering formats (QT-, HA-, INV `QT-…/NN`, CN-, MQD-, TPS-) stay unchanged.
- Property tests live in their own files, run at least 100 cases (`numRuns: 100` or more), use fast-check v4 without `fc.stringOf` (use `fc.string({ minLength, maxLength })` or `fc.array(fc.constantFrom(...)).map(a => a.join(''))`), and carry the tag comment `// Feature: rental-flow-integration, Property <n>: <title>`.
- Where a task says "locate", find the file with `grep_search` first (for example hooks such as `useTransportJobs`, `driversForOrg`, `trucksForOrg`). Do not guess paths.

## Tasks

- [x] 1. Shared pure cores
  - [x] 1.1 Create `src/services/refCounterCore.ts`
    - Export `RefPrefix`, `RefCounters`, `MAX_SEQ`, `counterKey`, `formatRef`, `REF_RE`, `issueRef`, `counterFloorFromRefs` exactly as in the design
    - `issueRef` never lowers a counter and returns `EXHAUSTED` with the counters unchanged at 9999
    - Type-only imports
    - _Requirements: 1.2, 5.1, 5.2, 5.3, 7.3_

  - [x] 1.2 Create `src/services/seedCore.ts`
    - Implement `planSeeds`, `demoDay` (local `YYYY-MM-DD`, `today` injected) and `integrityViolations` with the `IntegritySnapshot` type
    - `integrityViolations` checks `customerId` and `customerName` against the registry and that every set reference id resolves inside the same company
    - _Requirements: 4.10, 4.11, 6.5, 6.8_

  - [x]* 1.3 Write property test for reference issuance
    - File `src/services/__tests__/refCounterCore.property.test.ts`
    - **Property 1: Reference issuance**
    - **Validates: Requirements 1.2, 5.1, 5.2, 5.3, 7.3**

  - [x]* 1.4 Write property test for seed planning
    - File `src/services/__tests__/seedCore.property.test.ts`
    - **Property 16: Seed plan respects user changes**
    - **Validates: Requirements 6.5**

- [x] 2. Transport job creation that is stored and viewable
  - [x] 2.1 Update transport types
    - In `src/types/transport.ts` make `distance` optional and add `Cancelled` to `TransportJobStatus`
    - Add `TransportJobRecord`, `TransportJobView`, `JobOverride`, `JobPatch` types
    - _Requirements: 1.3, 1.14_

  - [x] 2.2 Create `src/services/transportCore.ts`
    - Implement `validateTransportForm`, `mapFormToRecord`, `kindOfType`, `toTransportJobView` (total, never throws), `mergeTransportList`, `sortNewestFirst`, `transportCounters`, `ref13Rows`, `transportJobFromCollection`
    - Persisted jobs newest first, then mock rows (design assumption 2); type map D to Delivery, O to Collection, T and T2 to Transfer (assumption 1); new job takes branch from the matched machine (assumption 6)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 1.13_

  - [x] 2.3 Create `src/store/transportStore.ts`
    - Persisted per-company store with key `fleet-transport-jobs-v1`: `jobs`, `counters`, `seedMarkers`, `overrides`, `legacyImported`, `forOrg`, `issueRef`, `add`, `update`, `seedOrg`
    - Pure total `migrateTransportState` that sets `migrationError` and leaves the raw value in `localStorage` on malformed input
    - `importLegacyTransportJobs` imports `appStore.transportJobs` once, never writes or deletes it, floors counters with `counterFloorFromRefs`
    - _Requirements: 1.2, 1.6, 1.12, 1.14, 9.2, 9.3, 9.4_

  - [x] 2.4 Rewrite `transportService` in `src/services/services.ts` and its React Query hooks
    - Implement `listJobs`, `listNow`, `create` (throws `TransportValidationError` and `TransportRefExhaustedError`), `update`, `updateStatus`, `listDrivers`, `listTrucks` over the store and `transportCore`
    - Fix `s + j.distance` to `s + (j.distance ?? 0)`
    - In the create mutation `onSuccess`, `setQueryData` with `transportService.listNow()` so the board and counters are right on the next render
    - Locate `useTransportJobs`, the create and update hooks and add `useUpdateTransportJob`
    - The `ensureRentalDemo` calls are added later in task 7.4
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.8, 1.10, 1.12, 1.13, 1.14_

  - [x] 2.5 Change `src/features/fleet/collectionWiring.ts`
    - `appCreateTransportJob` writes to `useTransportStore.getState().add(...)` with `cn.orgId` and a fresh `TJ-` reference, using `transportJobFromCollection`
    - Remove the `appStore` write
    - _Requirements: 1.7_

  - [x] 2.6 Update `TransportPage.tsx` and `TransportJobDialog.tsx`
    - Page: remove `slice(0, 8)`, use `useUpdateTransportJob` instead of `useAppStore().updateTransportJob`, replace `(selected as any).*` with `ref13Rows(selected)`, guard `destination?.split('-')[0] ?? '—'` and `distance ?? '—'`, counters from `transportCounters`
    - Dialog: zod schema built from the exported `TRANSPORT_*` constants (`srNo` integer 1 to 9999), `form.reset()` only on success, `toastError` on failure with values kept, double-submit lock through a `useRef` flag plus `isPending`
    - _Requirements: 1.4, 1.5, 1.8, 1.9, 1.10, 1.11, 1.14_

  - [x] 2.7 Make the other transport consumers compile and render
    - Update Kanban, Job Tracking, Truck Tracking and Tripbase pages only where the type change requires it (for example `distance ?? 0`)
    - Run `tsc -b` and fix transport-related errors only
    - _Requirements: 1.14_

  - [x]* 2.8 Write property tests for transport mapping and validation
    - File `src/services/__tests__/transportCore.mapping.property.test.ts`
    - **Property 2: Transport form mapping**
    - **Property 3: Transport form validation**
    - **Validates: Requirements 1.1, 1.3, 1.9, 1.13**

  - [x]* 2.9 Write property tests for transport list and detail rows
    - File `src/services/__tests__/transportCore.list.property.test.ts`
    - **Property 4: Transport list order, completeness and counters**
    - **Property 5: REF-13 detail rows**
    - **Validates: Requirements 1.4, 1.5, 1.7, 1.8**

  - [x]* 2.10 Write property test for transport store isolation and persistence
    - File `src/store/__tests__/transportStore.property.test.ts`
    - **Property 18: Company isolation and persistence round trip** (transport store, including legacy import and `migrateTransportState` on previous-version input)
    - **Validates: Requirements 1.6, 1.12, 9.1, 9.2, 9.3**

  - [x]* 2.11 Write property test for status change round trip
    - File `src/services/__tests__/transportService.status.property.test.ts`
    - **Property 6: Status change round trip** (persisted and mock rows; `listNow` and `listJobs` agree)
    - **Validates: Requirements 1.14**

  - [x]* 2.12 Write component tests for the Transport page and dialog
    - Dialog keeps values on a thrown error, double click creates one job, success toast, new job first on the board, a collection-note job is listed with a `TJ-` reference, no crash on a job without `destination`
    - _Requirements: 1.4, 1.7, 1.10, 1.11_

- [x] 3. CRM four-column pipeline and Status panel
  - [x] 3.1 Create `src/features/crm/statusPanelCore.ts`
    - Implement `statusOptions`, `REASON_MAX`, `validateReason`, `planPhaseRequest`, `panelState`, `columnSummary`, `formatAedWhole`, `cardModel`
    - Value-import only `crmRules`; do not change `crmRules.ts` (assumption 5)
    - _Requirements: 2.2, 2.3, 2.4, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9, 3.13_

  - [x] 3.2 Extract `src/features/crm/PipelineBoard.tsx`
    - Render four columns Awaiting, Tender, Lost, Won with header count and `AED` amount, cards from `cardModel`, per-column empty text, native drag and drop, no per-card move buttons
    - Props: quotations, selected id, `onSelect`, `onDropPhase`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_

  - [x] 3.3 Add the status editor to `QuotationDetail` in `src/features/crm/CrmShared.tsx`
    - Optional `statusEditor` prop: Status select from `statusOptions` (disabled options show the Phase_Rules error), reason `Textarea` when `panelState(...).needsReason`, Save button disabled by `canSave`, field-level reason message, phase history
    - _Requirements: 2.9, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8_

  - [x] 3.4 Wire `CrmPage.tsx` to the board and panel
    - Use `PipelineBoard`, selected card id in page state (one panel, replace on click, close hides it), panel looked up by id so it shows the new phase after save
    - Drop handler uses `planPhaseRequest` (reject toast, Lost or Reopen reason dialog, or apply); `ReasonDialog` submit calls `validateReason`
    - `move()` stays the only caller of `changePhase`; success toast, rejection keeps selection and reason
    - Keep Lost and Won tabs and the Active pipeline KPI (Awaiting plus Tender only)
    - _Requirements: 2.6, 2.7, 2.9, 2.10, 2.11, 3.4, 3.10, 3.11, 3.13, 3.14_

  - [x] 3.5 Migrate `crmStore` to persist version 4
    - Keep every quotation; rewrite `customerName` and `customerId` only for seed ids (`qt-seed-*`, `qt-<org>-seed-*`) whose name still equals a spelling in `DEMO_SPELLING_FIXES`, using `customerCore` (task 4.1)
    - Never touch user-created quotations; total migration function
    - _Requirements: 3.12, 4.3, 4.4, 9.3_

  - [x]* 3.6 Write property tests for phase rules
    - File `src/features/crm/__tests__/statusPanelCore.property.test.ts`
    - **Property 7: Status options follow the phase rules**
    - **Property 8: Reason validation and rejection leave state unchanged**
    - **Property 9: Accepted transition appends one history entry, by either path**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.13**

  - [x]* 3.7 Write property tests for board summaries and cards
    - File `src/features/crm/__tests__/pipelineSummary.property.test.ts`
    - **Property 10: Board summaries and tab consistency**
    - **Property 11: Card content**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

  - [x]* 3.8 Write component tests for the pipeline and panel
    - Four columns in order, empty-column text, no per-card buttons, panel opens, replaces and closes, Save disabled until a different allowed status, blank reason message, success keeps the panel open, drag and drop shares the rejection path
    - _Requirements: 2.1, 2.5, 2.8, 2.9, 2.10, 2.11, 3.1, 3.11_

  - [x]* 3.9 Write property test for CRM store persistence
    - File `src/features/crm/__tests__/crmStore.property.test.ts`
    - **Property 18: Company isolation and persistence round trip** (crm store: phase history, v3 to v4 migration keeps all records, other companies unchanged)
    - **Validates: Requirements 3.12, 3.14, 9.1, 9.2, 9.3**

- [x] 4. Customer registry
  - [x] 4.1 Create `src/services/customerCore.ts`
    - `CANONICAL_DEMO_NAMES`, `CANONICAL_DEMO_CUSTOMERS` (ids `CUST-000125/248/371/419/532` for ABC, DEF, GHI, JKL, MNO; `CUST-000601..000604` for the other four), `normalizeCustomerName`, `findCustomer`, `planFindOrCreate`, `DEMO_SPELLING_FIXES`, `canonicalizeDemoName` (exact match only), `linksForCustomer`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.8, 4.9, 4.12_

  - [x] 4.2 Create `src/store/customerStore.ts`
    - Persisted key `fleet-customers-v1`: `customers`, `seedMarkers`, `forOrg`, `findOrCreate`, `create` (throws `DuplicateCustomerError`), `update`, `remove`, `seedOrg`; ids `cani-<orgId>-<n>` for non-JA, `cani-<n>` for `org-ja`; `customerId` never changes
    - Total `migrateCustomerState`
    - _Requirements: 4.1, 4.5, 4.8, 4.9, 9.2, 9.3_

  - [x] 4.3 Delegate `customerANIService` and `customerService` to the registry in `src/services/services.ts`
    - `customerANIService` list, get, create, update, delete use `customerStore`; switch preset code that uses `customerANIsForOrg(org).splice(0)` and `.length` to the store
    - `customerService.list` returns registry customers mapped to `Customer` plus JA `cu-*` rows whose normalized name is not in the registry
    - _Requirements: 4.1, 4.7, 4.13_

  - [x] 4.4 Add customer links to the Customers detail view
    - Create `src/services/customerLinks.ts` (facade reading `crmStore`, hire agreement store and tax invoice store, using `linksForCustomer`)
    - Locate the Customers detail slide-over in `src/features/customerani` and add Quotations, Hire agreements and Invoices sections
    - _Requirements: 4.7_

  - [x] 4.5 Create customers through `findOrCreate` in `CrmPage.onCreate`
    - Call `useCustomerStore.getState().findOrCreate(orgId, draft.customerName)` and pass the registry `customerId` and canonical `name` into `crmStore.create`
    - _Requirements: 4.5, 4.8, 4.9, 4.13_

  - [x]* 4.6 Write property test for customer find-or-create
    - File `src/services/__tests__/customerCore.property.test.ts`
    - **Property 12: Customer find-or-create**
    - **Validates: Requirements 4.1, 4.5, 4.8, 4.9**

  - [x]* 4.7 Write property test for customer store persistence
    - File `src/store/__tests__/customerStore.property.test.ts`
    - **Property 18: Company isolation and persistence round trip** (customer store)
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [x]* 4.8 Write component tests for customers
    - Customer detail lists linked quotations, agreements and invoices; CRM create with a variant name reuses the customer; duplicate create in the Customers app shows the error
    - _Requirements: 4.7, 4.8, 4.9_

- [ ] 5. Gate pass QR, PDF and unique references
  - [-] 5.1 Create `src/services/gatePassCore.ts`
    - `GATE_QR_PREFIX`, `buildGatePayload`, `parseGatePayload`, `classifyScan`, `resolveGatePassScan` (precedence format, company, lookup by id), `GATE_PASS_SCAN_MESSAGES`, `pngFileName`
    - _Requirements: 5.4, 5.13, 5.14, 5.15, 5.17, 5.7_

  - [ ] 5.2 Migrate `src/store/gateStore.ts` to version 2
    - Add `counters` and `issueRef(orgId, year)` (throws `GateRefExhaustedError`); `migrateGateState` floors counters from existing `GP-YYYY-NNNN` refs and keeps all entries
    - Additive change to `src/types/gate.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.17, 9.3_

  - [ ] 5.3 Use `issueRef` in `gateService.create` (`src/services/services.ts`)
    - `reference = data.reference ?? gateStore.issueRef(orgId, year)`; `id` with a uniqueness check; return the stored record
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 5.4 Create `src/services/gatePassPdf.ts`
    - `GatePassPdfCtx`, pure `gatePassContent` (sections Pass, Machine, Parties, References; `qr` is the payload; `-` for absent links), `gatePassPdf` via `renderPdf`; no store imports
    - _Requirements: 5.8, 5.9, 5.10_

  - [ ] 5.5 Create `src/services/gatePassDocs.ts`
    - `gatePassContext` resolves quotation, agreement and collection note numbers and the company name (Gate IN uses the note whose `collectedByGateId` equals the record id); `printGatePass` downloads `<reference>.pdf`
    - Do not import `gateStore`, `services.ts` or `appStore.ts`
    - _Requirements: 5.8, 5.10_

  - [ ] 5.6 Create `src/features/gate/GatePassPanel.tsx`
    - Detail rows, QR image (`qrDataUrl(buildGatePayload(rec))`), payload text, fleet number, Download PNG (`pngFileName`), Print Gate Pass (`printGatePass`), existing Process Entry
    - QR or PDF failure shows an inline error and `toastError` and never changes the stored pass
    - _Requirements: 5.6, 5.7, 5.8, 5.16, 5.18_

  - [ ] 5.7 Update `GatePassDialog.tsx`
    - Stop building `id` and `reference`; use the record returned by `createMutation.mutateAsync`
    - Success state with QR, reference, Download PNG and Done before closing; side effects (`setMachineStatus`, `markCollectedForMachine`) run before the success state
    - Scan dispatch with `classifyScan`: `GATE` goes to `resolveGatePassScan` and `onOpenPass(id)` or a scan error, creating no record; `FLEET` and `OTHER` use the existing `resolveGateScan` path
    - Update root tests `GatePassDialog.test.tsx` and `GatePassDialog.scan.test.tsx` from `GP-<4 digits>` to `GP-<year>-<4 digits>`
    - _Requirements: 5.1, 5.11, 5.13, 5.14, 5.15, 5.16_

  - [ ] 5.8 Wire `GatePage.tsx`
    - Use `GatePassPanel` in the slide-over, give "Print Gate Pass" a handler, pass `onOpenPass` to the dialog to open the detail of the scanned pass, keep Approve, Complete and Process Entry
    - _Requirements: 5.6, 5.8, 5.13, 5.18_

  - [ ]* 5.9 Write property tests for gate payload and scan routing
    - File `src/services/__tests__/gatePassCore.property.test.ts`
    - **Property 19: Gate payload round trip and scan resolution**
    - **Property 20: Gate scan routing and errors**
    - **Validates: Requirements 5.4, 5.13, 5.14, 5.15, 5.17**

  - [ ]* 5.10 Write property test for QR image round trip
    - File `src/services/__tests__/gatePassQr.property.test.ts`
    - **Property 21: QR image round trip** (`QRCode.create(payload, { errorCorrectionLevel: 'M' }).modules` rasterized to `ImageData`, scale 4, 4-module quiet zone, decoded with `jsqr`, no canvas)
    - **Validates: Requirements 5.12**

  - [ ]* 5.11 Write property test for gate pass PDF content
    - File `src/services/__tests__/gatePassPdf.property.test.ts`
    - **Property 22: Gate pass PDF content**
    - **Validates: Requirements 5.9, 5.10**

  - [ ]* 5.12 Write property test for gate store persistence and counters
    - File `src/store/__tests__/gateStore.property.test.ts`
    - **Property 18: Company isolation and persistence round trip** (gate store v1 to v2 migration keeps entries; payload rebuilt after rehydration equals the original)
    - **Validates: Requirements 5.17, 9.1, 9.2, 9.3**

  - [ ]* 5.13 Write component tests for the gate pass UI
    - Panel shows QR, payload and fleet number; Download PNG file name; Print calls `renderPdf` and `downloadBlob`; success state shows QR and Download before close; failures keep the pass; Approve, Complete and Process Entry still work
    - _Requirements: 5.6, 5.7, 5.8, 5.11, 5.16, 5.18_

- [ ] 6. Hire documents (Delivery Note, hire MQD, hire TPS)
  - [ ] 6.1 Create `src/services/hireDocCore.ts` and `src/types/hireDoc.ts`
    - Types `HireDocument`, `HireSignedFile`; `HireDocType`, `HIRE_DOC_PREFIX`, `statusOf`, `SIGNED_MAX_BYTES`, `SIGNED_MIME`, `validateSignedUpload` (precedence EMPTY, TYPE, SIZE), `resolveHireLinks`, `planGenerate` (existing doc returned unchanged; `NO_AGREEMENT` reported before `NO_MACHINE`), `listHireDocRows`, `canDownloadSigned`, `signedKey`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7, 7.8, 7.11, 7.13_

  - [ ] 6.2 Create `src/store/hireDocStore.ts`
    - Persisted key `fleet-hire-docs-v1`: `docs`, `counters`, `seedMarkers`, `forOrg`, `commit` (doc and counters in one `set()`), `setSigned`, `seedOrg`; total `migrateHireDocState` that floors counters from docs
    - _Requirements: 7.3, 7.12, 9.2, 9.3, 9.4_

  - [ ] 6.3 Create `src/services/hireDocPdf.ts` and export `referenceRows` from `collectionPdf.ts`
    - `hireDocContent` and `hireDocPdf` for DN (reference rows, delivery section, machine QR, three signature lines), HMQD (reuse `mqdContent`) and HTPS (reuse `tpsContent` with empty lines)
    - Additive export only; no behavior change to collection documents or numbering
    - _Requirements: 7.3, 7.5, 7.14_

  - [ ] 6.4 Create `src/services/hireDocs.ts`
    - `useHireDocRows`, `generateHireDoc` (resolve links, `planGenerate`, render PDF, then commit; a render failure creates no record), `downloadHireDoc`, `uploadSigned` (validate, find, confirm replace, `signedFiles.put`, `setSigned`; remove the new blob if `setSigned` throws), `downloadSigned` with `canDownloadSigned`
    - Uploader is the signed-in user's display name; do not import `services.ts` or `appStore.ts`
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.8, 7.9, 7.10, 7.11, 7.13, 7.15_

  - [ ] 6.5 Create `src/features/documents/DeliveryNotePage.tsx` and route it
    - Table with Quotation, Agreement, Customer, Fleet No and a status badge plus actions per type (Generate, Download, Upload signed copy with `accept=".pdf,.png,.jpg,.jpeg"`, Download signed copy); replace confirmation uses the existing dialog
    - In `AppRouter.tsx` replace `DocumentAppPage appId="delivery_note"` at `/docs/delivery-note`
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.8, 7.10, 7.11, 9.6_

  - [ ]* 6.6 Write property tests for hire document core
    - File `src/services/__tests__/hireDocCore.property.test.ts`
    - **Property 23: Signed copy validation**
    - **Property 24: Hire document generation**
    - **Property 25: Hire document list**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.7, 7.8, 7.13**

  - [ ]* 6.7 Write property tests for signed copy storage and access
    - File `src/services/__tests__/hireDocs.property.test.ts` (uses `fake-indexeddb/auto`)
    - **Property 26: Signed status implies a stored file**
    - **Property 27: Signed copy access**
    - **Validates: Requirements 7.6, 7.11, 7.15**

  - [ ]* 6.8 Write property test for hire document store persistence
    - File `src/store/__tests__/hireDocStore.property.test.ts`
    - **Property 18: Company isolation and persistence round trip** (hire document store, counters preserved)
    - **Validates: Requirements 7.12, 9.1, 9.2, 9.3**

  - [ ]* 6.9 Write component tests for the Delivery Note page
    - Lists rows only for quotations with an agreement, Generate, Download, upload accepted, upload rejected by type, size and empty, replace confirm and decline, storage failure leaves no data, persistence after rehydration, no `fetch` calls
    - _Requirements: 7.1, 7.5, 7.8, 7.9, 7.10, 7.12, 9.5_

- [ ] 7. Demo data for every company
  - [ ] 7.1 Use canonical customer spellings and registry ids in mock builders
    - Update `quotations.ts`, `demoHireLink.ts`, hire agreement seeds, `demoCollection` and the demo booking builders (locate with `grep_search` for "ABC Company", "Arabtec Contracting", `CUS-`, `cu-`)
    - Names and ids come from `CANONICAL_DEMO_CUSTOMERS`; keep Awaiting 2, Tender 2, Won 3, Lost 3 quotations per company
    - _Requirements: 4.2, 4.3, 4.6, 6.6_

  - [ ] 7.2 Create `src/services/mock/demoRental.ts` and `src/services/mock/placeholderPdf.ts`
    - Pure builders: `demoDriverId`, `demoTruckId`, `demoDriversForOrg` (2), `demoTrucksForOrg` (2), `demoTransportSeeds` (Delivery `D` of the On Hire machine for the Won MNO quotation, Completed; Collection `O` for the quotation of `CN-2026-0002`, Scheduled, with driver, truck, machine and quotation links; ids `tj-demo-<orgId>-<n>`), `demoHireDocSeeds` (signed DN, generated HMQD, no HTPS per assumption 3), `demoCustomerSeeds`
    - Copy `placeholderPdfBytes` into `placeholderPdf.ts`; add the drivers and trucks to `driversForOrg` and `trucksForOrg` (locate)
    - No stores, clock or randomness in the builders; use `demoDay(today, offset)` for On Hire (started 10 days ago, ends in 20) and upcoming (starts in 7)
    - _Requirements: 6.3, 6.7, 6.8, 6.13, 6.14_

  - [ ] 7.3 Add `ensureRentalDemo(orgId, today)` to `src/services/demoSeed.ts`
    - Extend `DEMO_APPS`; order customers, `ensureHireLinkDemo`, invoice and collection demo, transport (drivers and trucks in memory, jobs into `transportStore`), hire documents with the signed placeholder in `signedFiles`, gate records via `seedGateRecords`
    - Each step in `try/catch` with `console.warn('[demoSeed] skipped <record>: <reason>')`; never throws; record-level markers via `planSeeds`; step flags in `fleet-rental-demo-v1` (unreadable value treated as empty); import the placeholder from `placeholderPdf.ts` and remove the old copy
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.9, 6.10, 6.12, 6.13, 6.14, 9.6_

  - [ ] 7.4 Add seeding triggers
    - `AppLayout.tsx`: `setTimeout(() => ensureRentalDemo(orgId), 0)` in an effect keyed by `orgId`
    - Call `ensureRentalDemo` on first load in `transportService`, `customerANIService`, `machineService`, `bookingService` and `gateService` (`src/services/services.ts`) and in `hireDocs.ts`
    - _Requirements: 6.1, 6.10, 6.11_

  - [ ]* 7.5 Write property tests for seeder idempotence, isolation and integrity
    - File `src/services/__tests__/demoSeed.property.test.ts`
    - **Property 14: Referential integrity of seeded data**
    - **Property 15: Seeder idempotence, isolation and id scoping**
    - **Validates: Requirements 4.6, 4.7, 4.10, 4.11, 6.2, 6.3, 6.4, 6.10**

  - [ ]* 7.6 Write property tests for canonicalization and relative dates
    - File `src/services/__tests__/demoSeed.canonical.property.test.ts`
    - **Property 13: Demo canonicalization leaves user data alone**
    - **Property 17: Relative demo dates**
    - **Validates: Requirements 4.3, 4.4, 6.8**

  - [ ]* 7.7 Write example tests for demo content
    - Nine customers with the fixed ids, one quotation per phase, two transport jobs with driver and truck, two gate passes (IN and OUT), DN signed, MQD generated, no TPS record, first run under 2000 ms for one company, no `console.error`, rehydrate then reseed gives equal counts
    - _Requirements: 4.2, 4.12, 6.6, 6.7, 6.11, 6.12, 6.13, 6.14_

- [ ] 8. Architecture tests for the new dependency rules
  - [ ] 8.1 Extend `src/architecture.test.ts`
    - `refCounterCore`, `seedCore`, `transportCore`, `customerCore`, `gatePassCore`, `hireDocCore` import only types; `statusPanelCore` value-imports only `crmRules`; no `require` or dynamic `import()`
    - `gatePassPdf.ts` and `hireDocPdf.ts` import no store, `services.ts` or `appStore.ts`; `gatePassDocs.ts` and `hireDocs.ts` do not import `services.ts` or `appStore.ts`; `gatePassDocs.ts` does not import `gateStore`
    - `transportStore`, `hireDocStore`, `customerStore` imported only by their allow-lists; `features/documents` and `features/gate` do not import `crmStore`; the `gateStore` allow-list is unchanged
    - _Requirements: 9.7_

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. End-to-end verification suite (workstreams 1 to 6)
  - [ ] 10.1 Create `src/services/__tests__/e2e/harness.ts`
    - Reset all stores, clear `localStorage`, install `fake-indexeddb/auto`, sign in a company, activate all apps, call `ensureRentalDemo`
    - Export a helper so every spec runs `describe.each(['org-ja', 'org-e2e-new'])`
    - _Requirements: 8.9_

  - [ ] 10.2 Write `invoiceNumber.e2e.test.ts` and `invoicing.e2e.test.ts`
    - Won quotation gives invoice number `QT-…/NN`; a non-Won quotation cannot be invoiced in the UI service or the store service; Continuous Hire rejects a period end before the hire start or overlapping the previous period; Off-Hire uses the quotation hire end date
    - _Requirements: 8.2, 8.5, 9.10_

  - [ ] 10.3 Write `hireChain.e2e.test.ts`
    - Quotation to agreement to booking to On Hire to Won; duplicate agreement id rejected; On Hire marks only the linked quotation Won regardless of job state; repeating On Hire adds no second history entry
    - _Requirements: 8.2, 8.4_

  - [ ] 10.4 Write `collectionDocs.e2e.test.ts` and `fleetQr.e2e.test.ts`
    - CN, MQD and TPS share the CN reference, quotation reference, invoice reference, customer and fleet number in their PDF content; fleet QR payload to Collection Note QR to resolved machine
    - _Requirements: 8.2, 8.6_

  - [ ] 10.5 Write `gateIn.e2e.test.ts`
    - Valid QR fills the fleet number; invalid QR shows an error and stores nothing; stored date and time come from the server clock; manual entry works; an `AXLEOPS-GATE` scan opens the existing pass without creating a record
    - _Requirements: 8.2, 8.7, 5.13, 5.15_

  - [ ] 10.6 Write `crmPipeline.e2e.test.ts`
    - Lost leaves the Active pipeline total, appears in the Lost tab, is searchable, reopens only with a reason, and persists after store rehydration
    - _Requirements: 8.3_

  - [ ] 10.7 Write `hireDocs.e2e.test.ts`
    - Status transitions Not Generated, Generated, Signed Copy Uploaded; file validation; duplicate upload with confirm and decline
    - _Requirements: 8.8_

  - [ ] 10.8 Write `rentalChain.e2e.test.ts`
    - Customer to quotation, agreement, booking, machine, invoice, CN, MQD, TPS, transport job and gate pass with `integrityViolations` empty, for `org-ja` and a new company
    - _Requirements: 4.10, 8.9_

  - [ ] 10.9 Fix every gap found by tasks 10.2 to 10.8
    - For each failing or missing behavior, change the minimum source needed and re-run the failing spec; record each gap with the file changed for the traceability matrix
    - Do not weaken a test to make it pass
    - _Requirements: 8.10_

- [ ] 11. Traceability matrix
  - [ ] 11.1 Create `.kiro/specs/rental-flow-integration/traceability.md`
    - One table row per acceptance criterion of PDF workstreams 1 to 6: criterion, implementing source file, test file and test name, state (Pass, Gap-fixed, Gap-open)
    - Include the known gap "Delivery Note, hire-phase MQD and Third-Party Services generate, download and signed upload are missing" as Gap-fixed by Requirement 7
    - No row may stay Gap-open; use the gap list from task 10.9
    - _Requirements: 8.1, 8.10, 8.11_

  - [ ]* 11.2 Write a smoke test for the matrix
    - File `src/services/__tests__/e2e/traceability.test.ts`
    - Fails when a row lacks a source file, a test name or a state, when a referenced file does not exist, when any row is Gap-open, or when the Delivery Note gap row is missing
    - _Requirements: 8.1, 8.10, 8.11_

- [ ] 12. Final verification
  - [ ] 12.1 Run the Quality_Gate and the branch checks
    - Run `tsc -b`, `vitest --run` and `eslint` on the touched files; compare eslint against `HEAD` (git stash is forbidden, use `git show HEAD:<file>` or a worktree) and fix every new error
    - Confirm `git branch --show-current` is `feature/crm-plugin`, `git log` shows no new commit, and `git status -- odoo` shows no change
    - Fix any failure at its cause and re-run
    - _Requirements: 8.12, 9.7, 9.8_

- [ ] 13. Report to the user
  - [ ] 13.1 Write the final report in chat (no new file)
    - What changed for each task 1 to 6 of the brief (Transport, CRM, Customers, Gate, Demo data, Verification) plus the Delivery Note workstream
    - A step-by-step demo walkthrough that works for any company login: sign in, Customers, CRM board and Status panel, Planner and Fleet, Transport job creation, Gate pass QR and PDF, Delivery Note generate and signed upload, Invoice, Collection Note
    - The gap list from `traceability.md` with each gap's state
    - _Requirements: 8.1, 8.10, 8.11_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP. Architecture tests (8.1) and the end-to-end suite (task 10) are not optional because they deliver Requirements 8 and 9.
- Each task references granular requirement clauses for traceability.
- `src/services/services.ts` is edited by tasks 2.4, 5.3, 4.3 and 7.4. They sit in different waves on purpose.
- Property numbers refer to the design's Correctness Properties section. Property 18 is split across the store tests of tasks 2.10, 3.9, 4.7, 5.12, 6.8.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "4.1", "5.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.2", "3.2", "3.5", "3.6", "4.2", "5.2", "5.4", "5.9", "5.10", "6.1"] },
    { "id": 2, "tasks": ["2.3", "2.8", "2.9", "3.3", "3.7", "3.9", "4.6", "4.7", "5.5", "5.11", "5.12", "6.2", "6.3", "6.6", "7.1"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.10", "3.4", "5.6", "6.4", "6.8"] },
    { "id": 4, "tasks": ["2.6", "2.7", "2.11", "4.5", "5.3", "6.5", "6.7", "7.2"] },
    { "id": 5, "tasks": ["2.12", "3.8", "4.3", "5.7", "6.9", "7.3"] },
    { "id": 6, "tasks": ["4.4", "5.8", "7.4", "7.5", "7.6", "7.7"] },
    { "id": 7, "tasks": ["4.8", "5.13", "8.1", "10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.6", "10.7", "10.8"] },
    { "id": 9, "tasks": ["10.9"] },
    { "id": 10, "tasks": ["11.1"] },
    { "id": 11, "tasks": ["11.2"] },
    { "id": 12, "tasks": ["12.1"] },
    { "id": 13, "tasks": ["13.1"] }
  ]
}
```
