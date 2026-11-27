# Implementation Plan: Hire Agreement ↔ Planner Link

## Overview

The plan is ordered bottom-up. It starts with test tooling and types, then builds each plugin's part (CRM, Quotation/Hire Agreement), then the shared Hire_Link_Service, then the Planner and Fleet triggers. Every task states its plugin in brackets.

- **[Shared]**: tooling, types, `hireLinkCore.ts`, `hireLink.ts`
- **[CRM]**: `crmRules.applyAutoWon`, `crmStore.autoWon`
- **[Quotation]**: `hireAgreementStore`, `hireAgreementService`, `HireAgreementPage`
- **[Planner]**: `bookingStore`, `bookingRecord.ts`, `BookingFormDialog`
- **[Fleet]**: `appStore.setMachineStatus`

Work happens on the git branch `feature/crm-plugin`. Do not create commits as part of these tasks.

Language: TypeScript (the design uses TypeScript). Property tests use `fast-check` with at least 100 runs and the tag comment `// Feature: hire-agreement-planner-link, Property <n>: <text>`.

Ordering note: `hireAgreementService` guards, the quotation options hook and the page error handling call `hireLink`. They are wired in section 6, after `hireLink.ts` exists, so every step compiles. Sections 4 and 5 leave no orphaned code, because the store, service CRUD and form field work without those calls.

## Tasks

- [x] 1. Types and test tooling [Shared]
  - [x] 1.1 Install and configure vitest, fast-check and jsdom
    - Run `npm view vitest peerDependencies` and choose a vitest release whose `vite` peer range includes Vite 8 (vitest 5.1.x lists `^8.0.0`). Add it, `fast-check` and `jsdom` to `devDependencies`.
    - Add `@testing-library/react` and `@testing-library/user-event` for the few dialog example tests.
    - Add the script `"test": "vitest --run"` to `package.json`.
    - Create `vitest.config.ts` with default `environment: 'node'`, the `@` alias taken from `vite.config.ts`, and `include: ['src/**/*.test.{ts,tsx}']`.
    - Add one smoke test `src/smoke.test.ts` that imports `describe/it/expect` from `vitest` and a trivial `fast-check` property. Confirm `npx vitest --run` passes and `npx tsc -b` still passes (test files import vitest functions explicitly, no globals).
    - Stay on branch `feature/crm-plugin`. Do not commit.
    - _Requirements: supports all test sub-tasks (design: Testing Strategy, Tooling to add)_

  - [x] 1.2 Extend the types
    - In `src/types/hireagreement.ts` add `orgId: string` and `quotationId: string` to `HireAgreement`, and export `SeedHireAgreement = Omit<HireAgreement, 'orgId' | 'quotationId'>`.
    - In `src/types/booking.ts` add optional `orgId?: string` and `hireAgreementId?: string` to `Booking`.
    - Change `src/services/mock/hireagreement.ts` to declare `SeedHireAgreement[]` without changing its content.
    - Fix any compile errors that these type changes cause outside the files listed in later tasks by keeping the code compiling (later tasks replace the logic).
    - _Requirements: 1.4, 2.3, 3.1, 4.5, 6.1, 6.4_

- [x] 2. CRM plugin: automatic Won transition [CRM]
  - [x] 2.1 Add `applyAutoWon` and `AUTO_WON_REASON` to `src/features/crm/crmRules.ts`
    - Export `AUTO_WON_REASON = 'Auto: machine On Hire'` and `AutoWonResult`.
    - Implement `applyAutoWon(q, user, now)` as in the design: `Won` returns `unchanged/ALREADY_WON`, `Lost` returns `unchanged/QUOTATION_LOST`, `Awaiting` and `Tender` return `changed` with phase `Won`, `updatedAt = now` and one appended `PhaseHistoryEntry` carrying `fromPhase`, `toPhase: 'Won'`, the timestamp, the user and the reason.
    - Leave `ALLOWED`, `isAllowed` and `applyTransition` unchanged. The function takes no Job_State input.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.5, 11.1, 15.1_

  - [x]* 2.2 Write property test for `applyAutoWon`
    - File: `src/features/crm/crmRules.test.ts`.
    - **Property 9: `applyAutoWon` transition rule** (including the equality with manual `applyTransition(q, 'Won', …)` for Tender except the entry's `reason` and `user`, and the unchanged `ALLOWED` table)
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.5, 11.1, 15.1**

  - [x] 2.3 Add `autoWon` action to `src/store/crmStore.ts`
    - Signature `autoWon(orgId, id, user)` returning `{ ok: true; result: AutoWonResult } | { ok: false; error: 'QUOTATION_NOT_FOUND' | 'QUOTATION_ORG_MISMATCH' }`.
    - Find the quotation by `id` only, reject a different `orgId`, call `applyAutoWon` with `new Date().toISOString()`, and replace only that quotation with a single `set`.
    - Keep persist `version` at 2 and do not change `changePhase`.
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 12.1, 12.5, 14.1_

  - [x]* 2.4 Write unit tests for `crmStore.autoWon`
    - File: `src/store/crmStore.test.ts` (`// @vitest-environment jsdom`).
    - Cover: Awaiting and Tender become Won with one history entry; Won and Lost stay unchanged; unknown id returns `QUOTATION_NOT_FOUND`; other-org quotation returns `QUOTATION_ORG_MISMATCH`; other quotations are untouched; the manual `changePhase` rules still reject Awaiting → Won.
    - _Requirements: 9.1, 9.2, 9.5, 10.1, 11.1, 12.1, 12.5, 15.1_

- [x] 3. Checkpoint - CRM plugin
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Quotation plugin: agreement store, service and form [Quotation]
  - [x] 4.1 Create `src/store/hireAgreementStore.ts`
    - Persisted zustand store, key `fleet-hire-agreements-v1`, `version: 1`, `partialize` to `agreements` and `seededOrgs`.
    - Implement `ensureSeeded(orgId)` (idempotent, seed ids `ha-seed-<orgId>-<n>`, `orgId` set, `quotationId: ''`), `forOrg`, `getById`, `insert`, `patch` (strips `id`, `orgId`, `createdAt`), `remove` and `newId()` (`ha-<base36 time>-<4 random base36>`, retried until unique across all rows).
    - Implement `migrate` with `normalizeAgreement`: `quotationId ?? ''`, `orgId ?? JA_ORG_ID`, keep all other fields; a missing or malformed array yields empty lists and logs `console.warn`.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 3.1, 3.2, 3.3_

  - [x] 4.2 Rewrite `hireAgreementService` in `src/services/services.ts` to use the store
    - Keep exported signatures and `delay`. `list` and `get` call `ensureSeeded(orgId)` then `forOrg(orgId)`.
    - `create` builds the record with `id: store.newId()`, `orgId` from the active org, `quotationId: data.quotationId ?? ''`, timestamps, and strips `id`, `orgId`, `createdAt`, `updatedAt` from the input.
    - `update` requires `record.orgId === orgId` (otherwise throws `Hire agreement not found`) and patches via `store.patch` with `id`, `orgId`, `createdAt` stripped.
    - `delete` removes the record from the store (the in-use guard is added in task 6.1).
    - Remove `hireAgreementsForOrg` and its cache from `src/services/mock/orgData.ts` and fix remaining references. The React Query hooks in `useQueries.ts` stay unchanged.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2_

  - [x]* 4.3 Write property test for agreement identity and ownership
    - File: `src/store/hireAgreementStore.test.ts` (`// @vitest-environment jsdom`; reset store and `localStorage` in `beforeEach`).
    - **Property 1: Agreement identity and ownership are stable and unique**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.7**

  - [x] 4.4 Add the Quotation dropdown to `HireAgreementPage`
    - Add a `quotationId` field to the form state and a **Quotation** `<select>` in the header block, using the page's existing plain-HTML input style. The empty option saves `quotationId: ''`; a selected option saves its `Quotation.id`.
    - Render the select disabled with the notice "CRM app is inactive" when the options source reports `active: false`, and keep the stored `quotationId` unchanged on save.
    - Make the options source a prop-free local constant `{ active: true, options: [] }` placeholder only until task 6.2 replaces it. Do not read `crmStore` from the page.
    - Do not clear `quotationId` when the customer changes.
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.7, 3.2_

- [x] 5. Shared Hire_Link_Service [Shared]
  - [x] 5.1 Create `src/services/hireLinkCore.ts` (pure, types-only imports)
    - Export `SkipReason`, `ValidationCode`, `AllocationLite`, `AgreementLite`, `QuotationLite`, `Snapshot`, `OnHireEvent`, `Plan`.
    - Implement `companyKey`, `isActiveAllocation` (`startDate <= today <= endDate`, status not `Cancelled` or `Returned`), `resolveActiveAllocation`, `validateAgreementRef` (trim, id-only lookup, the four messages), `orderAgreementOptions` (stable partition), `traceAllocation`, `allocationsForQuotation` and `evaluateOnHire` using the documented check order (apps first, then allocation, org, agreement, quotation, phase).
    - Quotations and agreements are resolved by `id` equality only. Never read `hireAgreementNo`, `agreementNo`, company, machine or job to resolve a quotation. Treat a missing `orgId` on an allocation as `JA_ORG_ID`.
    - _Requirements: 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.6, 6.7, 7.2, 7.3, 8.3, 8.4, 8.5, 8.6, 8.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 13.1, 13.2, 13.3, 13.4, 15.2, 15.3, 15.5_

  - [x]* 5.2 Write property test for reference validation
    - File: `src/services/hireLinkCore.validation.test.ts`.
    - **Property 4: Hire agreement reference validation** (oracle function; include `agreementNo` values equal to other ids, padded whitespace, other-org ids)
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**

  - [x]* 5.3 Write property test for option list content and order
    - File: `src/services/hireLinkCore.options.test.ts`.
    - **Property 5: Agreement option list content and order**
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [x]* 5.4 Write property test for the trace round trip
    - File: `src/services/hireLinkCore.trace.test.ts`.
    - **Property 7: Allocation to quotation trace round trip** (the persist and rehydrate leg is covered with the real stores in task 7.7)
    - **Validates: Requirements 6.6, 6.7, 6.8, 14.2, 15.5**

  - [x]* 5.5 Write property test for active allocation resolution
    - File: `src/services/hireLinkCore.active.test.ts`.
    - **Property 8: Active allocation resolution** (dates on the start and end boundaries, all statuses)
    - **Validates: Requirements 8.3, 8.4, 8.5**

  - [x]* 5.6 Write property test for chain validity and skip conditions
    - File: `src/services/hireLinkCore.evaluate.test.ts`.
    - **Property 12: Chain validity and skip conditions** (the "facade leaves the CRM store unchanged on skip" leg is covered in task 5.10)
    - **Validates: Requirements 7.2, 8.6, 8.8, 12.5, 12.6, 12.7, 13.1, 13.2, 13.3, 13.4, 15.2, 15.3**

  - [x] 5.7 Create the facade `src/services/hireLink.ts`
    - Export `HireLinkValidationError`, `HireAgreementInUseError`, `HireLinkResult`, `validateAgreementRef`, `listAgreementOptions`, `describeLink`, `handleOnHire`, `listQuotationOptions`, `assertQuotationMatchesCompany`, `findAllocationsForAgreement`, `resolveAllocation`, `allocationsForQuotation`.
    - `handleOnHire`: read the active org from `useAuthStore` (fallback `JA_ORG_ID`), read app flags from `useOrgStore.isAppActive`, call `ensureSeeded`, build the snapshot from `useBookingStore.userBookings`, `useHireAgreementStore` and `useCrmStore.quotations`, run `evaluateOnHire`, call `useCrmStore.autoWon(orgId, quotationId, 'System')` on `win`, show the notice from the design's notice table via `@/lib/toast-helper`, and return `HireLinkResult`.
    - Wrap the body in `try/catch` that logs `console.error('[hireLink]', err)`, shows `toastError('Could not update the linked quotation')` and returns `INTERNAL_ERROR`. Wrap each notice call in its own `try/catch`. Keep no queue, so skipped events are never replayed.
    - `hireLink.ts` must not import `services.ts`, `appStore.ts` or any component. It is the only module that imports stores of more than one plugin. Do not add any `depends` entry in `src/constants/apps.ts`.
    - _Requirements: 5.1, 6.5, 6.6, 6.7, 7.3, 7.4, 8.3, 8.4, 8.5, 8.6, 8.8, 9.7, 11.2, 12.1, 12.2, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 15.5_

  - [x]* 5.8 Write property test for quotation options and company check
    - File: `src/services/hireLink.options.test.ts`.
    - **Property 3: Quotation options and company check** (including `companyKey` idempotence and the empty `quotationId` case)
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.6**

  - [x]* 5.9 Write property test for idempotence across trigger paths
    - File: `src/services/hireLink.idempotence.test.ts` (`// @vitest-environment jsdom`, real stores, toasts mocked).
    - **Property 10: Idempotence across trigger paths** (booking path, machine path, both in any order, optional rehydrate between events)
    - **Validates: Requirements 10.2, 10.3, 10.4, 14.3**

  - [x]* 5.10 Write property test that only the linked quotation changes
    - File: `src/services/hireLink.isolation.test.ts` (`// @vitest-environment jsdom`). Also assert that a skip plan leaves the CRM store unchanged.
    - **Property 11: Only the linked quotation changes** (decoys: same company, same `hireAgreementNo`, other orgs, Lost; duplicate `agreementNo`)
    - **Validates: Requirements 7.3, 12.1, 12.2, 12.3, 12.4, 12.8**

  - [x]* 5.11 Write unit tests for notices and no replay
    - File: `src/services/hireLink.notices.test.ts`.
    - One assertion per row of the notice table, including the success text naming reference and phase (9.7), the Lost warning naming the reference (11.2), and the inactive-app notices. Assert that a skipped event while CRM is inactive, followed by CRM activation, leaves the CRM store unchanged (13.7).
    - _Requirements: 9.7, 11.2, 13.2, 13.3, 13.4, 13.7_

- [x] 6. Quotation plugin: wire the Hire_Link_Service [Quotation]
  - [x] 6.1 Add guards to `hireAgreementService`
    - In `create` and `update` call `hireLink.assertQuotationMatchesCompany(orgId, …)` before writing, so a mismatch throws `HireLinkValidationError` and nothing is saved.
    - In `delete` call `hireLink.findAllocationsForAgreement(id)` and throw `HireAgreementInUseError` with the references when the list is not empty, leaving the store unchanged.
    - _Requirements: 2.6, 2.7, 3.4_

  - [x] 6.2 Replace the dropdown placeholder with real options and error handling
    - Add `useQuotationOptions(companyName)` to `src/hooks/useQueries.ts`, calling `hireLink.listQuotationOptions(orgId, companyName)`, with key `[...queryKeys.hireAgreements, 'quotation-options', companyName]`.
    - In `HireAgreementPage` use the hook for the select's options and `active` flag. Catch `HireLinkValidationError` in `handleSave` and show its message. Add `onError` to `handleDelete` so `HireAgreementInUseError` shows "Cannot delete: used by bookings BK-…, BK-…".
    - _Requirements: 2.2, 2.5, 2.6, 3.4_

  - [x]* 6.3 Write property test for the agreement delete guard
    - File: `src/services/hireAgreementService.test.ts` (`// @vitest-environment jsdom`).
    - **Property 13: Agreement delete guard**
    - **Validates: Requirements 3.4**

  - [x]* 6.4 Write example tests for `HireAgreementPage`
    - File: `src/features/documents/HireAgreementPage.test.tsx` (`// @vitest-environment jsdom`; use the existing page location if it differs).
    - Cover: the select is disabled with the notice when CRM is inactive (2.5); a company mismatch shows the error (2.6); saving with no selection stores an empty `quotationId` (2.4); a blocked delete shows the referencing bookings (3.4).
    - _Requirements: 2.4, 2.5, 2.6, 3.4_

- [x] 7. Planner plugin: booking link, validation and trigger (a) [Planner]
  - [x] 7.1 Migrate `src/store/bookingStore.ts`
    - Bump `persist` to `version: 1` with an identity `migrate` that returns `{ userBookings }` unchanged, so legacy rows load as unlinked.
    - Make `updateBooking` ignore `id` in the patch (`const { id: _ignored, ...rest } = data`).
    - _Requirements: 4.6, 6.1, 6.2, 6.3, 15.2_

  - [x] 7.2 Create `src/features/planner/bookingRecord.ts`
    - Implement the pure `buildBookingRecord({ mode, data, existing, orgId, now, names, status, totalValue, idSeed })`.
    - `create`: `id: bk-user-<idSeed>`, `reference: BK-<year>-<last 4 of idSeed>`, `orgId`, `createdAt = updatedAt = now`. `edit`: copy `id`, `reference`, `createdAt`, `orgId` from `existing` (fall back to the active org only when `existing.orgId` is absent), `updatedAt = now`.
    - In both modes set `hireAgreementId` to the trimmed value and omit the key when empty.
    - _Requirements: 4.5, 4.6, 4.8, 6.4, 15.4_

  - [x]* 7.3 Write property test for the booking record builder
    - File: `src/features/planner/bookingRecord.test.ts`.
    - **Property 6: Booking record builder**
    - **Validates: Requirements 4.5, 4.6, 4.8, 6.4, 15.4**

  - [x] 7.4 Add the Hire Agreement field and validation to `BookingFormDialog`
    - Add `useHireAgreementOptions(customerName)` to `src/hooks/useQueries.ts` wrapping `hireLink.listAgreementOptions`, keyed under `queryKeys.hireAgreements`.
    - Add `hireAgreementId: z.string().optional()` to the schema, defaulting to `booking.hireAgreementId` on edit. Add an `Input` with `list="hire-agreement-options"` and a `<datalist>` whose `<option value={agreement.id}>` label is `agreementNo · customerName · id`. Order the list by the selected customer so that company agreements come first.
    - Show a read-only line `Agreement No · Hire Agreement ID · Quotation number` from `hireLink.describeLink` when the value resolves.
    - Disable the input with the helper text "Demo bookings cannot be linked" when `booking` is set but absent from `useBookingStore.userBookings`.
    - In `onSubmit` call `hireLink.validateAgreementRef` first. On failure call `form.setError('hireAgreementId', { message })` and return before touching the store, so the dialog stays open.
    - Replace the inline record construction with `buildBookingRecord`, so edit keeps `id` and `reference`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.4, 6.5_

  - [x] 7.5 Add trigger (a) to `BookingFormDialog`
    - After `addBooking` or `updateBooking` and the existing success toast, call `hireLink.handleOnHire({ source: 'booking', allocationId: record.id })` only when the computed status is `On Hire` and a valid `hireAgreementId` exists. Keep this call outside the `try/catch` that reports "Failed to save booking". Then `form.reset()` and `onClose()`.
    - Raise no event for other statuses, and none for an empty field.
    - _Requirements: 4.8, 7.1, 7.2, 7.3, 7.4_

  - [x]* 7.6 Write example tests for `BookingFormDialog`
    - File: `src/features/planner/BookingFormDialog.test.tsx` (`// @vitest-environment jsdom`; mock `hireLink` and toasts).
    - Cover: invalid id keeps the dialog open and leaves `userBookings` unchanged (5.9); `handleOnHire` runs after the store write and only for status `On Hire` (7.1, 7.2); edit pre-fills the stored id (4.7); a demo booking disables the field; the datalist shows number, company and id (4.1, 4.2); an empty field saves without a link and calls nothing (4.8).
    - _Requirements: 4.1, 4.2, 4.7, 4.8, 5.9, 7.1, 7.2_

  - [x]* 7.7 Write property test for persistence round trip and legacy migration
    - File: `src/store/persistence.test.ts` (`// @vitest-environment jsdom`). Also assert that the same `traceAllocation` result is obtained before and after rehydrating the stores.
    - **Property 2: Persistence round trip and legacy migration** (agreements, bookings and quotations with auto-won history; legacy rows without `quotationId`, `orgId` or `hireAgreementId`)
    - **Validates: Requirements 3.1, 3.2, 3.3, 6.1, 6.2, 6.3, 14.1, 14.2, 15.2**

- [x] 8. Fleet plugin: trigger (b) [Fleet]
  - [x] 8.1 Add the On Hire trigger to `appStore.setMachineStatus`
    - After the existing `set(...)`, add `if (status === 'On Hire') { hireLink.handleOnHire({ source: 'machine', machineId }); }`. Import only `@/services/hireLink`.
    - Do not change `GatePassDialog`, so Gate OUT raises the event once through `setMachineStatus`. Leave `getActiveBookingForMachine` unchanged.
    - Add a code comment next to `useUpdateMachineStatus` stating that any future On Hire caller must route through `hireLink.handleOnHire`.
    - _Requirements: 8.1, 8.2, 8.3, 8.7, 8.9, 11.3_

  - [x]* 8.2 Write property test for failure isolation
    - File: `src/store/appStore.isolation.test.ts` (`// @vitest-environment jsdom`; failures injected with `vi.spyOn` on store reads, `autoWon` and toasts).
    - **Property 14: Failure isolation** (the saved booking and the machine override stay present; any status other than `On Hire` calls no `handleOnHire` and leaves the CRM store unchanged)
    - **Validates: Requirements 7.4, 8.7, 8.9, 11.3, 13.5**

  - [x]* 8.3 Write example tests for the Fleet triggers
    - Files: `src/store/appStore.test.ts` and `src/features/gate/GatePassDialog.test.tsx` (use the existing dialog location if it differs).
    - Cover: `setMachineStatus(id, 'On Hire')` calls `handleOnHire` once (8.1); Gate OUT calls it once per action (8.2); Gate IN and other statuses call it zero times (8.7).
    - _Requirements: 8.1, 8.2, 8.7_

- [x] 9. Checkpoint - all plugins wired
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Structure check and final verification
  - [x]* 10.1 Write the architecture test
    - File: `src/architecture.test.ts`.
    - Fail if any file under `src/features/planner`, `src/features/gate` or `src/features/documents` imports `@/store/crmStore`. Fail if `src/constants/apps.ts` gains a `depends` entry between `planner`, `fleet`, `quotation` and `crm` beyond the existing ones. Fail if `hireLinkCore.ts` imports anything but types, or if `hireLink.ts` imports `services.ts` or `appStore.ts`.
    - _Requirements: 9.4, 13.6_

  - [x] 10.2 End-to-end verification
    - Run `npx tsc -b` and fix every type error.
    - Run `npx vitest --run` and fix every failing test (optional test files that exist must pass).
    - Run `npm run lint` and fix new lint errors in the touched files.
    - Confirm `git branch --show-current` prints `feature/crm-plugin` and that nothing was committed.
    - Manual check from the design (CRM quotation, linked agreement, booking with today's dates, Gate OUT, reload, CRM off) is for the user and is not part of this task.
    - _Requirements: 1.1–15.5 (all)_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Only the tooling task 1.1 and the end-to-end verification task 10.2 among test-related work are required.
- Property tests for `hireLinkCore` and `hireLink` use one file per property (instead of the single files named in the design) so that they can run in parallel waves. Test content is unchanged.
- Each task references granular acceptance criteria for traceability.
- Property tests validate universal correctness properties. Unit tests validate examples and edge cases.
- Work stays on branch `feature/crm-plugin`. No commits.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1", "5.1", "7.1"] },
    { "id": 3, "tasks": ["2.4", "4.2", "4.4", "5.2", "5.3", "5.4", "5.5", "5.6", "7.2"] },
    { "id": 4, "tasks": ["4.3", "5.7", "7.3"] },
    { "id": 5, "tasks": ["5.8", "5.9", "5.10", "5.11", "6.1", "6.2", "8.1"] },
    { "id": 6, "tasks": ["6.3", "6.4", "7.4", "7.7", "8.2", "8.3"] },
    { "id": 7, "tasks": ["7.5"] },
    { "id": 8, "tasks": ["7.6", "10.1"] },
    { "id": 9, "tasks": ["10.2"] }
  ]
}
```
