# Implementation Plan: Gate-In QR Scan

## Overview

The plan builds the feature bottom-up: dependency and types, the server clock, the pure `gateCore.ts` module, the collection-note helpers, the gate service identity test, the `QrScanner` component, the `GatePassDialog` wiring, the Gate page detail rows, and architecture tests. Each property-based test is a separate optional sub-task in its own file under `src/services/__tests__/gate/`, tagged `// Feature: gate-in-qr-scan, Property <n>: <title>` and run with at least 100 cases.

Conventions for every task:

- The implementation language is TypeScript. The project uses React, zustand, vitest and fast-check v4.
- Install packages with `npm install --legacy-peer-deps`.
- fast-check v4 has no `fc.stringOf`. Build strings with `fc.array(fc.constantFrom(...chars)).map(a => a.join(''))`, `fc.string()` or `fc.stringMatching`.
- Work on branch `feature/crm-plugin`. Do not commit. Do not touch anything under `odoo/`.
- `pickNoteToCollect` lives in `collectionCore.ts` (pure), as the design says, although the requirements glossary names `collectionDocs.ts`.

## Tasks

- [x] 1. Dependency and shared types
  - [x] 1.1 Move `jsqr` from `devDependencies` to `dependencies` in `package.json`
    - Run `npm install --legacy-peer-deps` so `package-lock.json` stays consistent.
    - _Requirements: 13.1_

  - [x] 1.2 Add capture types and optional fields to the gate record types
    - In `src/types/gate.ts` add `TimeSource` (`'server' | 'device'`) and `CaptureMethod` (`'QR' | 'Manual'`).
    - Add optional `fleetNo`, `gateDate`, `gateTime`, `gateTimeZone`, `captureMethod`, `timeSource`, `qrPayload` to `GateEntry`, and keep `timestamp` as an ISO date.
    - In `src/store/appStore.ts` add the same optional fields (including `fleetNo` and `timestamp`) to `StoredGateEntry`.
    - _Requirements: 9.1_

- [x] 2. Server clock service
  - [x] 2.1 Implement `src/services/serverClock.ts`
    - Export `computeOffset`, `serverNow(deps?)`, `resetServerClock`, and the `ServerTime` and `ClockDeps` types.
    - Send a same-origin `HEAD` request with `cache: 'no-store'` and a 2-second abort timeout, read the `Date` header, and cache the offset for 300 seconds.
    - Share one in-flight promise between concurrent callers.
    - Fall back to device time with `source: 'device'` on any failure, without caching and without throwing.
    - Import only types from `@/types/gate`, and import nothing from any store.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x]* 2.2 Write property test for clock offset round trip and accuracy
    - File: `src/services/__tests__/gate/serverClockOffset.property.test.ts`
    - **Property 5: Clock offset round trip and accuracy**
    - **Validates: Requirements 7.3, 7.7, 7.10**

  - [x]* 2.3 Write property test for cached offset producing server time
    - File: `src/services/__tests__/gate/serverClockCache.property.test.ts`
    - **Property 6: Cached offset produces server time**
    - **Validates: Requirements 7.4**

  - [x]* 2.4 Write property test for clock failure falling back to device time
    - File: `src/services/__tests__/gate/serverClockFailure.property.test.ts`
    - Cover rejected request, 2-second timeout with fake timers, missing `Date` header and unparseable `Date` header.
    - **Property 7: Clock failure falls back to device time**
    - **Validates: Requirements 7.5**

  - [x]* 2.5 Write unit test for concurrent `serverNow()` calls
    - File: `src/services/__tests__/gate/serverClockConcurrency.test.ts`
    - Assert that several concurrent calls trigger exactly one `HEAD` request and all resolve from it, and that `resetServerClock` forces a new request.
    - _Requirements: 7.6, 7.8_

- [x] 3. Pure gate core
  - [x] 3.1 Create `src/services/gateCore.ts` with scan, camera and direction logic
    - Implement `resolveGateScan` as a direct wrapper over `resolveQr`, `GATE_SCAN_MESSAGES` (one distinct 1 to 200 character message per scan error), `CAMERA_MESSAGES`, `mapCameraError` with the precedence insecure, missing `getUserMedia`, then error name, and `directionFor`.
    - Import values only from `@/services/collectionCore`. Every other import is `import type`.
    - _Requirements: 2.9, 2.10, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 10.1, 10.2_

  - [x] 3.2 Add `buildGateRecordFields` to `gateCore.ts`
    - Build `fleetNo` with `fleetNumberOf`, `timestamp` as `toISOString()`, and `gateDate` and `gateTime` with `Intl.DateTimeFormat` using the passed `timeZone` and `hourCycle: 'h23'`.
    - Set `gateTimeZone`, `captureMethod` and `timeSource` from the inputs, and set `qrPayload` only for method `QR`.
    - Throw `RangeError` for an invalid instant or zone. Read no default zone, clock or randomness.
    - _Requirements: 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

  - [x] 3.3 Add `formatGateWhen` and `dashIfMissing` to `gateCore.ts`
    - Use stored `gateDate` and `gateTime` when both exist and the zone is recognised, otherwise derive from `timestamp`, then `createdAt`.
    - Use UTC with label `UTC` when the zone is missing or unrecognised, label `Unknown` for stored values with no usable instant and an unrecognised zone, and return `available: false` when nothing parses.
    - `dashIfMissing` returns `-` for undefined, null or empty and the value unchanged otherwise.
    - _Requirements: 9.6, 12.2, 12.3, 12.4, 12.5_

  - [x]* 3.4 Write property test for the scan round trip
    - File: `src/services/__tests__/gate/scanRoundTrip.property.test.ts`
    - **Property 1: Scan round trip**
    - **Validates: Requirements 2.1, 2.11**

  - [x]* 3.5 Write property test for scan error classification
    - File: `src/services/__tests__/gate/scanErrors.property.test.ts`
    - Include equality with `resolveQr` for arbitrary strings and per-error generators, including duplicate fleet numbers that differ only by case or whitespace.
    - **Property 2: Scan errors are classified and match `resolveQr`**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.9**

  - [x]* 3.6 Write property test for scan messages
    - File: `src/services/__tests__/gate/scanMessages.property.test.ts`
    - **Property 3: Scan messages are complete and distinct**
    - **Validates: Requirements 3.6**

  - [x]* 3.7 Write property test for camera error precedence
    - File: `src/services/__tests__/gate/cameraErrors.property.test.ts`
    - **Property 4: Camera error precedence**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

  - [x]* 3.8 Write property test for record fields
    - File: `src/services/__tests__/gate/recordFields.property.test.ts`
    - **Property 8: Record fields are consistent and deterministic**
    - **Validates: Requirements 8.5, 8.6, 8.7, 8.8, 8.9, 8.10**

  - [x]* 3.9 Write property test for the local date and time round trip
    - File: `src/services/__tests__/gate/recordRoundTrip.property.test.ts`
    - Use an independent oracle in the test and skip daylight-saving ambiguous local times.
    - **Property 9: Local date and time round trip**
    - **Validates: Requirements 8.11**

  - [x]* 3.10 Write property test for direction
    - File: `src/services/__tests__/gate/direction.property.test.ts`
    - **Property 10: Direction follows machine status**
    - **Validates: Requirements 10.1, 10.2**

  - [x]* 3.11 Write property test for dash rendering
    - File: `src/services/__tests__/gate/dash.property.test.ts`
    - **Property 12: Missing values render as a dash**
    - **Validates: Requirements 9.6**

  - [x]* 3.12 Write property test for gate display fallback order
    - File: `src/services/__tests__/gate/gateWhen.property.test.ts`
    - **Property 13: Gate display fallback order**
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5**

- [x] 4. Collection note helpers
  - [x] 4.1 Add `pickNoteToCollect` to `src/services/collectionCore.ts`
    - Export the `NoteLite` type and the pure function. Filter by org, machine and open status (neither `Collected` nor `Closed`), pick the latest `createdAt`, and keep the first element on ties.
    - Keep the module types-only.
    - _Requirements: 11.4, 11.7, 11.8_

  - [x] 4.2 Add `markCollectedForMachine` to `src/services/collectionDocs.ts`
    - Select the note with `pickNoteToCollect` and apply `collectionStore.patch(id, { status: 'Collected' })`. Return the updated note, or `undefined` when none is open.
    - Do not import `services.ts` or `appStore`.
    - _Requirements: 11.1, 11.3, 11.5, 11.6, 11.7_

  - [x]* 4.3 Write property test for picking and collecting a note
    - File: `src/services/__tests__/gate/pickNote.property.test.ts`
    - **Property 14: Picking and collecting a note**
    - **Validates: Requirements 11.1, 11.4, 11.6, 11.8**

  - [x]* 4.4 Write property test for idempotent collecting
    - File: `src/services/__tests__/gate/markCollected.property.test.ts`
    - Exercise `markCollectedForMachine` against the real collection store, including the case of two or more open notes.
    - **Property 15: Collecting is idempotent with at most one open note**
    - **Validates: Requirements 11.9**

- [x] 5. Gate service identity
  - [x]* 5.1 Write property test for gate service identity and status
    - File: `src/services/__tests__/gate/gateService.property.test.ts`
    - Call the real `gateService.create` with generated `id`, `reference` and `status`. No production change in `services.ts` is expected. If the test fails, fix `create` so supplied `id` and `reference` win and status is forced to `Pending`.
    - **Property 11: Gate service honours supplied identity and forces Pending**
    - **Validates: Requirements 9.7, 9.8, 9.9**

- [x] 6. QR scanner component
  - [x] 6.1 Implement `src/features/gate/QrScanner.tsx`
    - Props: `active`, `onDecode`, `onError`.
    - Check `isSecureContext` first, then `getUserMedia` availability, then call `getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })` and map rejections with `mapCameraError`.
    - Decode with a dynamically imported `jsqr` every 200 ms from a canvas, call `onDecode` exactly once with the unmodified text, and stop all tracks on decode, on `active` false and on unmount.
    - Stop tracks immediately when `getUserMedia` resolves after cleanup, and report `OTHER` when a track ends after start.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x]* 6.2 Write component tests for `QrScanner`
    - File: `src/features/gate/QrScanner.test.tsx` with `getUserMedia`, `isSecureContext` and `jsqr` mocked and fake timers.
    - Cover rear-camera request, preview after stream, decode within 250 ms with a single unmodified `onDecode`, track stop on decode, unmount and `active` false, every camera error message and the precedence cases, and a late `getUserMedia` resolution after unmount.
    - Add a smoke test that renders a QR image generated with `qrcode` into `ImageData` and checks that `jsqr` returns the payload.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. Gate dialog wiring
  - [x] 7.1 Wire Scan_Mode and Manual_Mode into `src/features/gate/GatePassDialog.tsx`
    - Add `mode`, `scan`, `scanError`, `cameraError`, `inlineError` and `scanKey` state. Open in Scan_Mode. Show the mode switch control always enabled.
    - On decode call `resolveGateScan` against `appMachineResolver.list(orgId)`. On error show `GATE_SCAN_MESSAGES` text with the code and a "Scan again" control, and keep `machineId` empty. On success read `getMachineCurrentStatus` in `try/catch`, call `serverNow()` once, validate the date, set `machineId`, show Fleet Number, make and model, and show a non-blocking warning when the machine is not On Hire.
    - Disable submit and block Enter-submit in Scan_Mode until a valid scan exists. Clear scan state on "Scan again" and on mode switches as Requirement 4 states.
    - In Manual_Mode show the org machine dropdown with an empty-list item, show no date or time fields, and keep the existing validation messages.
    - On submit read the status once, compute the direction with `directionFor`, take the capture time from the scan or call `serverNow()` once in Manual_Mode, read the zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`, and call `buildGateRecordFields`. Block the save with an inline error when the time or status is unavailable.
    - Generate one `id` and one `reference`. Call `gateService.create` through the mutation first, then `appStore.addGateEntry` with the same `id` and `reference`, then set machine status (IN: `PHI`, OUT: `On Hire`).
    - For direction IN call `markCollectedForMachine` in its own `try/catch`. Toast the note number on success, show no toast when no note is open, and show an error toast without discarding the saved record on failure. Skip it when the save fails or the direction is OUT.
    - _Requirements: 1.1, 1.6, 1.7, 1.9, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 11.1, 11.2, 11.3, 11.5, 11.10, 11.11_

  - [x] 7.2 Update the existing `src/features/gate/GatePassDialog.test.tsx`
    - Mock `./QrScanner` to render nothing and mock `@/services/serverClock` so `serverNow` resolves a fixed server time.
    - Make `submitGateEntry` click the manual-entry control first. Keep both existing assertions unchanged.
    - _Requirements: 13.4_

  - [x]* 7.3 Write new dialog tests in `src/features/gate/GatePassDialog.scan.test.tsx`
    - Mock `QrScanner` with a button that simulates a decode, and mock `serverNow`.
    - Valid scan fills Fleet Number, make and model, saves a record with `captureMethod: 'QR'` and the stored `qrPayload`.
    - Invalid payload and other-org payload show the mapped message and code, keep submit disabled, and save nothing.
    - Enter in a field does not submit without a valid scan, and "Scan again" and mode switches clear scan state.
    - Manual submission saves `captureMethod: 'Manual'` with the server time and shows no date or time fields.
    - Gate IN marks the open Collection Note Collected and toasts its number, Gate OUT does not, and no open note gives no toast.
    - Clock failure (rejected or invalid date) and a throwing status read block the save and keep the entered data.
    - One `id` and one `reference` reach both `gateService.create` and `addGateEntry`.
    - _Requirements: 3.1, 3.2, 3.7, 4.1, 4.2, 4.3, 4.5, 4.6, 6.3, 6.4, 6.5, 8.1, 8.2, 8.3, 9.3, 10.3, 10.7, 11.1, 11.2, 11.3, 11.5_

- [x] 8. Gate page detail rows
  - [x] 8.1 Update the detail panel in `src/features/gate/GatePage.tsx`
    - Replace the Timestamp row with labelled rows for Fleet No., Gate Date, Gate Time with zone label, Capture Method and Time Source, using `formatGateWhen` and `dashIfMissing`.
    - Show "Device time" next to the gate time when `timeSource` is `device`. Show the full `qrPayload` in its own row only when the capture method is `QR`, or "Not available" when it is empty. Show "Not available" in both date and time rows when no value can be derived.
    - _Requirements: 6.8, 9.6, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x]* 8.2 Write component tests for the Gate page detail panel
    - File: `src/features/gate/GatePage.test.tsx`
    - Cover a record with all fields, a legacy record with none, a device time source, a QR record with and without payload, and unparseable dates.
    - Add a table test that `hasPageAccess('/gate')` is true for exactly Security, Ops Executive, Operations Manager, Executive Manager and Managing Director.
    - _Requirements: 6.8, 9.6, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 9. Architecture tests
  - [x] 9.1 Extend `src/architecture.test.ts`
    - Fail when `gateCore.ts` has a non-type import from any module other than `collectionCore.ts`, a `require(` call, or a dynamic `import(`.
    - Fail when `collectionCore.ts` has a non-type import.
    - Fail when `serverClock.ts` imports from any store module.
    - Check that `jsqr` is under `dependencies` and not under `devDependencies` in `package.json`.
    - Keep the existing rule that `collectionDocs.ts` does not import `services.ts` or `appStore`.
    - _Requirements: 13.1, 13.2, 13.3_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Final verification
  - [x] 11.1 Run the final verification commands and fix any failures
    - Run `tsc -b` and confirm exit code 0.
    - Run `npx vitest --run` and confirm zero failures, including `GatePassDialog.test.tsx`.
    - Run ESLint on the files touched by this feature and compare against the baseline from `HEAD` (stash-free: lint the `HEAD` versions with `git show HEAD:<path>` or compare error counts). No new errors are allowed.
    - Run `git status --short` in `c:\Users\koush\Project 1-11\fleet_overall` and confirm the branch is `feature/crm-plugin` and no commit was added.
    - Run `git -C "c:\Users\koush\Project 1-11\odoo" status --short` and confirm this work added no changes. Do not touch anything under `odoo/`.
    - _Requirements: 13.4, 13.5, 13.6_

- [x] 12. Walkthrough for the user
  - [x] 12.1 Write a plain step-by-step walkthrough of the Gate-In QR flow and report it in chat
    - Do not write a file. Cover: opening the dialog, camera permission, scanning the Collection Note QR, what a valid or failed scan shows, the non-hire warning, the manual fallback, automatic server time and the device-time fallback, submit and the Gate-In or Gate-Out direction rule, the Collection Note being marked Collected on Gate-In, and where to see the captured data on the Gate page.
    - _Requirements: 1.1, 2.7, 3.7, 4.3, 5.7, 6.3, 7.4, 8.1, 10.1, 11.1, 12.1_

- [x] 13. Gate record types and Collection_Gate_Link
  - [x] 13.1 Add the `GateRecord` type in `src/types/gate.ts`
    - `GateRecord` extends `GateEntry` with `orgId: string` and optional `machineId`, `truckPlate`, `arrivingFrom`, `seedKey`.
    - Add the `GateStoreState` type (`entries`, `seedMarkers: Record<string, string[]>`, `legacyImported`).
    - _Requirements: 14.1, 14.2, 15.1_

  - [x] 13.2 Add the gate link fields to `CollectionNote` in `src/types/collection.ts`
    - Add optional `collectedByGateId`, `collectedByGateRef` and `collectedAt` (ISO UTC). Leave `collectionStore` and `normalizeNote` unchanged, since old rows stay valid.
    - Keep `Collected` in `CollectionStatus`.
    - _Requirements: 11.1, 16.6_

  - [x] 13.3 Change `markCollectedForMachine` to take the gate link and update its caller
    - In `src/services/collectionDocs.ts` change the signature to `markCollectedForMachine(orgId, machineId, gate: { id, reference, timestamp })`.
    - Patch the picked note with `{ status: 'Collected', collectedByGateId: gate.id, collectedByGateRef: gate.reference, collectedAt: gate.timestamp }`. Return `undefined` and change nothing when no open note exists.
    - In `GatePassDialog.tsx` pass the saved record's `id`, `reference` and `timestamp`. Keep the existing error handling and toast.
    - _Requirements: 11.1, 11.5, 11.6, 11.7, 16.6, 16.7_

  - [x] 13.4 Update the existing tests for the new `markCollectedForMachine` signature
    - Update `pickNote.property.test.ts` and `markCollected.property.test.ts` in `src/services/__tests__/gate/` and any `GatePassDialog` test assertion on the call, so they pass the gate argument and check the three-argument call.
    - _Requirements: 11.1, 16.6_

  - [x]* 13.5 Write property test for collecting with the gate link
    - File: `src/services/__tests__/gate/markCollectedLink.property.test.ts`
    - Use the real collection store. When a note is picked, it ends Collected with `collectedByGateId`, `collectedByGateRef` and `collectedAt` equal to the gate values, and every other note is deep-equal to before. When no note is picked, the store is unchanged and the result is `undefined`.
    - **Property 25: Collecting stores the gate link on exactly one note**
    - **Validates: Requirements 11.1, 11.6, 11.7, 16.6**

- [x] 14. Pure helpers for the gate list, migration, seeding and status control
  - [x] 14.1 Add the list, migration and seed helpers to `src/services/gateCore.ts`
    - `mergeGateList(records, mock, orgId)`: records of that org sorted by `createdAt` descending with ties in input order (rows with unparseable `createdAt` sort last), then seed records (rows with a `seedKey`) in input order, then mock rows whose id is not present. Each id appears once and a persisted record shadows a mock row with the same id.
    - `migrateGateRecords(raw)`: total over arbitrary input. Keep objects with a non-empty string `id`, set `orgId` to `org-ja` when missing or empty, apply defaults for `driver`, `destination` (from `arrivingFrom`) and `timestamp` (from `createdAt`), leave other fields unchanged, and be idempotent.
    - `migrateGateState(raw)`: return a valid `GateStoreState`, reset to empty with a `console.warn` when the value is malformed.
    - `planGateSeeds(markers, existingIds, seeds)` and `linkNoteToGate(note, gate)` as in the design. `linkNoteToGate` returns the three link fields only when `collectedByGateId` is empty, otherwise `{}`.
    - Keep value imports only from `@/services/collectionCore`. Use `import type` for everything else.
    - _Requirements: 14.3, 14.4, 14.6, 14.9, 14.10, 15.4, 15.8, 15.9, 15.10_

  - [x] 14.2 Add `collectionStatusControl` to `src/services/collectionCore.ts`
    - Export `StatusControl` and `collectionStatusControl(current)`.
    - `Collected` returns `{ readOnly: true, options: ['Closed'] }`. `Draft` and `Scheduled` return `{ readOnly: false, options: ['Draft', 'Scheduled'] }`. `Closed` returns `{ readOnly: true, options: [] }`. The result never contains `Collected` in `options`.
    - Keep the module types-only.
    - _Requirements: 16.1, 16.3, 16.4_

  - [x]* 14.3 Write property test for gate list isolation
    - File: `src/services/__tests__/gate/gateListIsolation.property.test.ts`
    - Generate records of 1 to 3 orgs, mock rows and an org id. No returned row has another `orgId`, and every persisted record of the org appears exactly once.
    - **Property 16: Gate list isolation**
    - **Validates: Requirements 14.4, 14.10**

  - [x]* 14.4 Write property test for gate list order and shadowing
    - File: `src/services/__tests__/gate/gateListOrder.property.test.ts`
    - Use ids from a small pool so shadowing occurs, and `createdAt` values with ties.
    - **Property 17: Gate list order and shadowing**
    - **Validates: Requirements 14.3, 14.7**

  - [x]* 14.5 Write property test for legacy migration
    - File: `src/services/__tests__/gate/gateMigration.property.test.ts`
    - Generate arbitrary values (objects with and without `orgId`, numbers, `null`, strings). Assert no throw, only records with non-empty `id` and `orgId`, `org-ja` for missing org, other fields unchanged, and idempotence.
    - **Property 18: Legacy migration is total and assigns org-ja**
    - **Validates: Requirements 14.9**

  - [x]* 14.6 Write property test for gate state persistence round trip
    - File: `src/services/__tests__/gate/gateStateRoundTrip.property.test.ts`
    - **Property 19: Gate state persistence round trip**
    - **Validates: Requirements 14.2, 14.6**

  - [x]* 14.7 Write property test for writing the gate link only into an empty link
    - File: `src/services/__tests__/gate/gateLinkEmpty.property.test.ts`
    - **Property 24: Gate link is written only into an empty link**
    - **Validates: Requirements 15.4**

  - [x]* 14.8 Write property test for the status control
    - File: `src/services/__tests__/gate/statusControl.property.test.ts`
    - Enumerate the four statuses with `fc.constantFrom`. `Collected` is never in `options`, `readOnly` is true exactly for `Collected` and `Closed`, `Collected` offers only `Closed`, and `Draft` and `Scheduled` offer only `Draft` and `Scheduled`.
    - **Property 26: Collected is never selectable**
    - **Validates: Requirements 16.1, 16.3, 16.4**

- [x] 15. Gate store
  - [x] 15.1 Create `src/store/gateStore.ts`
    - Persisted zustand store under `fleet-gate-entries-v1` (version 1) with `entries`, `seedMarkers` and `legacyImported`, using `migrateGateState` on load.
    - Actions: `forOrg(orgId)`, `add(record)`, `update(id, patch)`, `upsert(record)` and `seedOrg(orgId, records)`. `seedOrg` inserts the rows and adds their ids to `seedMarkers[orgId]` in one `set` call.
    - On first load import rows from `localStorage['fleet-app-store-v1']` `gateEntries` through `migrateGateRecords` (missing `orgId` becomes `org-ja`), set `legacyImported`, and never modify `appStore`. A malformed or unreadable legacy value must not throw and leaves the flag false.
    - Add `@deprecated` comments to `gateEntries`, `addGateEntry`, `updateGateEntry` and `getAllGateEntries` in `appStore.ts` without changing behaviour.
    - _Requirements: 14.2, 14.6, 14.7, 14.9, 15.1_

  - [x]* 15.2 Write unit tests for `gateStore`
    - File: `src/store/gateStore.test.ts`
    - A legacy row without `orgId` is imported once with `org-ja`, a second load does not import again, `appStore` rows stay unchanged, and a malformed legacy value does not throw.
    - Records and seed markers survive a rebuild from the serialised state.
    - _Requirements: 14.2, 14.9_

- [x] 16. Gate service on the gate store
  - [x] 16.1 Rewrite `gateService` in `src/services/services.ts` as a thin wrapper over `gateStore`
    - `list()` calls `ensureGateDemo(currentOrgId())`, then returns `mergeGateList(store.forOrg(orgId), mockRows, orgId)`.
    - `create` stamps the current `orgId` (ignoring any `orgId` in the payload), honours a supplied `id` and `reference`, generates them otherwise, and forces status `Pending`.
    - `approve` and `complete` update the store record, or copy a seed or mock row into the store with the current `orgId` and the new status. Unknown ids throw.
    - Any signed-in company may use every method, and `org-ja` is not required.
    - _Requirements: 9.7, 9.8, 9.9, 14.1, 14.3, 14.4, 14.6, 14.7, 14.8_

  - [x] 16.2 Add the orgId to the `useGateEntries` query key in `src/hooks/useQueries.ts`
    - Make the three gate mutation hooks invalidate that key, so lists differ per company.
    - _Requirements: 14.3, 14.4_

  - [x] 16.3 Stop writing gate records to `appStore` in `GatePassDialog.tsx`
    - Remove the `appStore.addGateEntry` call. The record is stored once through `gateService.create` with the generated `id` and `reference`.
    - Keep the machine status change and the Collection Note step after a successful save.
    - _Requirements: 9.3, 14.1, 14.8_

  - [x] 16.4 Update the dialog tests to assert on `gateStore`
    - In `GatePassDialog.test.tsx` and `GatePassDialog.scan.test.tsx` reset `useGateStore` in setup instead of `appStore.gateEntries`.
    - Replace the `addGateEntry` spy with an assertion that `useGateStore.getState().entries` holds one record with the `id` and `reference` that the mutation received and the current `orgId`.
    - _Requirements: 9.3, 13.4, 14.1_

  - [x] 16.5 Guard `GatePage.tsx` search and rendering against rows with missing fields
    - Search must not throw for rows without `driver`, `destination`, `truckPlate` or `fleetNo`.
    - _Requirements: 14.3, 14.9_

  - [x]* 16.6 Update the gate service identity property test for the new storage
    - File: `src/services/__tests__/gate/gateService.property.test.ts`
    - Reset `gateStore` in `beforeEach` and read the stored record from it.
    - **Property 11: Gate service honours supplied identity and forces Pending**
    - **Validates: Requirements 9.7, 9.8, 9.9**

  - [x]* 16.7 Write property test for status change persistence
    - File: `src/services/__tests__/gate/gateStatusPersist.property.test.ts`
    - Set `useAuthStore` to a generated org and pick a store record or mock row, then `approve` or `complete`. The merged list has exactly one row with that id, its status is new, the other rows are unchanged, and the state survives a rebuild from `JSON.parse(JSON.stringify(state))`.
    - **Property 20: Status change persists and lists once**
    - **Validates: Requirements 14.6, 14.7**

  - [x]* 16.8 Write unit tests for `gateService`
    - File: `src/services/__tests__/gate/gateServiceOrg.test.ts`
    - With two companies, `list` for one never returns rows of the other. `create` with an `orgId` in the payload stores the current org. A user without `orgId` uses `org-ja`. A company other than `org-ja` can create, approve and complete.
    - _Requirements: 14.1, 14.4, 14.8_

- [x] 17. Per-company demo gate data
  - [x] 17.1 Create the pure builder `src/services/mock/demoGate.ts`
    - Export `DemoGateCtx`, `gateSeedId(orgId, n)` returning `ge-demo-<orgId>-<n>`, and `demoGateSeedsForOrg(orgId, ctx)`. References are `GP-DEMO-<n>`.
    - Resolve machines with `demoMachineId(orgId, n)` (`mc-<N>` for `org-ja`, `mc-demo-<N>` otherwise) for J105, J104 and J101, and skip a record whose machine is missing.
    - Row 1: J105, OUT, Completed, Manual, delivery to MNO Company LLC under `bk-demo-5` at the booking site, `Asia/Dubai`, fixed `timestamp` 1 to 7 days before the booking start. Skip the row when the start date is missing or unparseable.
    - Row 2: J104, IN, Completed, QR with `qrPayload` from `buildQrPayload`, `timeSource` `server`, `Asia/Dubai`, `gateDate` 2026-11-28, `gateTime` and `timestamp` from `buildGateRecordFields` at `2026-11-28T10:20:00.000Z`.
    - Row 3: J101, OUT, Pending, `Asia/Dubai`, fixed `timestamp` `2026-12-01T05:00:00.000Z`.
    - Set `orgId`, `seedKey = id`, `createdAt = updatedAt = timestamp`, `branchId`, `branchName` and `fleetNo` on every row. Never change a machine status.
    - Import only `gateCore`, `collectionCore`, `demoHireLink` and types.
    - _Requirements: 15.2, 15.3, 15.5, 15.6, 15.7, 15.10_

  - [x] 17.2 Add `ensureGateDemo(orgId)` to `src/services/demoSeed.ts`
    - Idempotent, never throws, logs errors with the `[demoSeed]` prefix, and returns when `orgId` is empty.
    - Call `ensureHireLinkDemo(orgId)`, build the context from the company machines and the `bk-demo-5` booking, plan with `planGateSeeds`, and insert with `gateStore.seedOrg`. A skipped seed gets no marker, and a deleted seed keeps its marker and is not re-created.
    - When seed row 2 exists and note `cn-demo-<orgId>-2` (CN-2026-0002) is Collected with all three link fields empty, patch it with `linkNoteToGate`. Leave it unchanged when any link field is non-empty.
    - Never change the status of J105 or any field of CN-2026-0001.
    - _Requirements: 15.1, 15.4, 15.5, 15.8, 15.9, 15.10, 15.11_

  - [x] 17.3 Wire the seeder into the gate list and the demo app set
    - Call `ensureGateDemo(orgId)` at the end of `ensureHireLinkDemo` for every company, without a call cycle, and from `gateService.list()`.
    - Add `'gate'` to `DEMO_APPS` in `demoSeed.ts` so a company with only the Gate app active gets the demo machines, bookings and Collection Notes the seeds need.
    - _Requirements: 15.1, 14.8_

  - [x]* 17.4 Write property test for seeding idempotence
    - File: `src/services/__tests__/gate/gateSeedIdempotent.property.test.ts`
    - Starting from any Gate_Store state, company and machine set, applying the seeder twice (plan, insert, record markers) equals applying it once, and inserted seed ids are in `seedMarkers[orgId]`.
    - **Property 21: Seeding is idempotent**
    - **Validates: Requirements 15.1, 15.8**

  - [x]* 17.5 Write property test for markers, missing machines and user records
    - File: `src/services/__tests__/gate/gateSeedMarkers.property.test.ts`
    - Use any subset of marked seed ids, user records and subsets of the five demo machines. Exactly the unmarked seeds with an existing machine are inserted, marked seeds (including deleted ones) are never re-created, skipped seeds get no marker, and earlier records stay unchanged and in place.
    - **Property 22: Seeding respects markers, missing machines and user records**
    - **Validates: Requirements 15.9, 15.10, 15.11**

  - [x]* 17.6 Write property test for well-formed seed records
    - File: `src/services/__tests__/gate/gateSeedRecords.property.test.ts`
    - Check ids `ge-demo-<orgId>-<n>` and references `GP-DEMO-<n>`, uniqueness per company, disjoint ids across companies, the row 1 to 3 field rules, the J105 timestamp 1 to 7 days before the start date, and the J104 fields equal to `buildGateRecordFields` in `Asia/Dubai`.
    - **Property 23: Seed records are well formed**
    - **Validates: Requirements 15.2, 15.3, 15.6, 15.7**

  - [x]* 17.7 Write unit tests for the demo seeder
    - File: `src/services/__tests__/gate/demoSeedGate.test.ts`
    - For `org-ja` and a freshly signed-up company such as `org-test-xyz` with only the Gate app active, `ensureGateDemo` creates the three rows, and J101, J104 and J105 exist for that company.
    - `resolveGateScan(buildQrPayload(J105), 'org-test-xyz', machines)` resolves to J105.
    - J105 stays On Hire and CN-2026-0001 stays open. CN-2026-0002 receives the link once. A second call creates nothing, a deleted seed does not return, and a company without J104 gets the other two rows.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.8, 15.9, 15.10_

  - [x]* 17.8 Write the end-to-end scan test for the demo flow
    - Add to `src/features/gate/GatePassDialog.scan.test.tsx`. After `ensureGateDemo`, scanning the payload of CN-2026-0001 for J105 saves an IN record, sets J105 to `PHI`, sets CN-2026-0001 to Collected with `collectedByGateId`, `collectedByGateRef` and `collectedAt` taken from the new record, and the toast contains `CN-2026-0001`.
    - _Requirements: 11.1, 11.2, 15.5, 16.6_

- [x] 18. Collection Note detail status control
  - [x] 18.1 Update `src/features/collection/CollectionDetail.tsx`
    - Replace the `STATUSES` constant with `collectionStatusControl(note.status)`. Show only `options` in the `Select` when not read-only.
    - For a Collected note show a static `Collected` badge and a `Select` with `Closed` as the only option. For a Closed note show only the badge.
    - Show the hint "Collected is set automatically at Gate-In in Gate Operations" next to the status control.
    - When the note is Collected and `collectedByGateRef` is present, show "Gate reference" and "Collected at" (`formatGateWhen` with the device time zone). A legacy Collected note without the link shows neither row.
    - The form must never write `Collected` on Save.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x]* 18.2 Write component tests for `CollectionDetail`
    - File: `src/features/collection/CollectionDetail.test.tsx`
    - Draft and Scheduled offer only Draft and Scheduled, with no `Collected` and no `Closed`. Collected offers only `Closed`. All states show the hint text. Link rows show only when the link is present.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [x] 19. Architecture tests for gate-only operations
  - [x] 19.1 Extend `src/architecture.test.ts`
    - Fail when a file outside `src/features/gate` imports `GatePassDialog`, `useCreateGateEntry`, `useApproveGateEntry` or `useCompleteGateEntry`, or calls `addGateEntry(` or `updateGateEntry(`. Exclude test files, `src/hooks/useQueries.ts`, `src/services/services.ts` and the store file that defines `addGateEntry` and `updateGateEntry`.
    - Fail when a file outside `src/features/gate` and `src/services` sets a Collection_Note status to Collected (`status: 'Collected'` or a `patch(`/`set(` call with `'Collected'`). Inside `src/services` allow only `collectionDocs.ts`, `demoSeed.ts` and files under `src/services/mock`. Exclude test files.
    - Fail when a file other than `src/store/gateStore.ts`, `src/services/services.ts`, `src/services/demoSeed.ts`, a file under `src/features/gate` or a test imports `@/store/gateStore`.
    - Fail when `src/services/mock/demoGate.ts` imports anything but `gateCore`, `collectionCore`, `demoHireLink` and types.
    - Fail when `CollectionDetail.tsx` contains the literal array `['Draft', 'Scheduled', 'Collected', 'Closed']` or when `src/types/collection.ts` no longer declares `Collected`.
    - If a legitimate hit appears, add a commented allow-list entry for that file. Do not loosen the patterns.
    - _Requirements: 16.1, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12_

- [x] 20. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Final verification for the Requirement 14 to 16 work
  - [x] 21.1 Run the final verification commands and fix any failures
    - Run `tsc -b` and confirm exit code 0.
    - Run `npx vitest --run` and confirm zero failures.
    - Run ESLint on the files touched by tasks 13 to 19 and compare with the baseline from `HEAD` (lint `git show HEAD:<path>` versions or compare error counts). No new errors are allowed.
    - Run `git status --short` in `c:\Users\koush\Project 1-11\fleet_overall`, confirm the branch is `feature/crm-plugin` and that no commit was added.
    - Run `git -C "c:\Users\koush\Project 1-11\odoo" status --short`. That repository already had unrelated uncommitted changes dated 18-11-2026. Confirm this work added none, and do not touch anything under `odoo/`.
    - _Requirements: 13.4, 13.5, 13.6_

- [x] 22. Demo walkthrough for the user
  - [x] 22.1 Write a step-by-step demo walkthrough and report it in chat
    - Do not write a file. Cover the flow for any company login: sign up a new company or use an existing one, activate the apps, open Gate Operations, and see the three seeded records `GP-DEMO-1` (J105 Out, Completed), `GP-DEMO-2` (J104 In, Completed, QR) and `GP-DEMO-3` (J101 Out, Pending).
    - Then scan the QR of Collection Note CN-2026-0001 in the Gate dialog, and show that the note becomes Collected with the gate link, J105 becomes PHI, and the Collection Note detail shows the gate reference and time.
    - Then approve and complete `GP-DEMO-3`, and note that Collected cannot be set from the Collection Note screen.
    - _Requirements: 14.8, 15.1, 15.5, 15.6, 16.2, 16.5_

## Notes

- Tasks 13 to 22 cover Requirements 14 to 16 and the Requirement 11 gate link. Seed ids follow the requirements (`ge-demo-<orgId>-<n>`, `GP-DEMO-<n>`), not the earlier `ge-seed-` wording in the design.
- The requirements decide the status control: a Collected note offers only Closed, and Draft or Scheduled offer only Draft and Scheduled. This replaces the design's `['Draft', 'Scheduled', 'Closed']` and empty-options rule for Collected.
- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Property tests validate the universal correctness properties from the design. Unit and component tests validate examples and edge cases.
- Tasks 1.1, 1.2 and 3.1 to 3.3 are the foundation for later tasks and should not be skipped.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.2", "3.4", "3.5", "3.6", "3.7", "3.10", "4.2", "4.3", "6.1"] },
    { "id": 3, "tasks": ["3.3", "3.8", "3.9", "4.4", "6.2"] },
    { "id": 4, "tasks": ["3.11", "3.12", "7.1", "8.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "8.2", "9.1"] },
    { "id": 6, "tasks": ["11.1"] },
    { "id": 7, "tasks": ["12.1"] },
    { "id": 8, "tasks": ["13.1", "13.2"] },
    { "id": 9, "tasks": ["13.3", "14.1", "14.2"] },
    { "id": 10, "tasks": ["13.4", "13.5", "14.3", "14.4", "14.5", "14.6", "14.7", "14.8", "15.1"] },
    { "id": 11, "tasks": ["15.2", "16.1", "17.1", "18.1"] },
    { "id": 12, "tasks": ["16.2", "16.3", "16.5", "17.2", "18.2"] },
    { "id": 13, "tasks": ["16.4", "16.6", "16.7", "16.8", "17.3", "17.4", "17.5", "17.6"] },
    { "id": 14, "tasks": ["17.7", "17.8", "19.1"] },
    { "id": 15, "tasks": ["21.1"] },
    { "id": 16, "tasks": ["22.1"] }
  ]
}
```
