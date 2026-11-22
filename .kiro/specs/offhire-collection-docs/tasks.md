# Implementation Plan: Off-Hire Collection Documents

## Overview

Implementation language is TypeScript (React, zustand, zod, vitest, fast-check). Work stays on branch `feature/crm-plugin` and nothing is committed. The plan builds bottom-up: tooling and types, the pure core, signed-file storage, stores, PDF, demo data, the facade, then UI (Fleet, Collection Note, Third-Party Services, MQD), architecture tests and final verification. Each property test is its own optional sub-task in its own file under `src/services/__tests__/collection/`. Implementation sub-tasks are required.

## Tasks

- [x] 1. Tooling and types
  - [x] 1.1 Install dependencies
    - Run `npm install --legacy-peer-deps jspdf qrcode`
    - Run `npm install -D --legacy-peer-deps @types/qrcode jsqr fake-indexeddb`
    - Only `package.json` and `package-lock.json` change
    - _Requirements: 7.1, 7.5, 11.5_

  - [x] 1.2 Add typed fleet number and collection types
    - Add optional `fleetNo?: string` to `Machine` in `src/types/machine.ts`
    - Create `src/types/collection.ts` with `DocType`, `CollectionStatus`, `SignedStatus`, `ServiceType`, `SERVICE_TYPES`, `MissingLink`, `ReferenceFields`, `SignedFileRef`, `CollectionNote`, `MqdRecord`, `ServiceLine`, `TpsDocument`
    - _Requirements: 4.1, 8.3, 8.4, 9.4_

- [x] 2. Pure core `src/services/collectionCore.ts`
  - [x] 2.1 Implement fleet number, QR, deep link and numbering functions
    - `fleetNumberOf`, `normalizeFleetNo`, `findDuplicateFleetNo`
    - `QR_PREFIX`, `buildQrPayload`, `parseQrPayload`, `resolveQr` (order: OTHER, OTHER_ORG, NOT_FOUND, AMBIGUOUS, MISMATCH), `resolveFleetQuery`
    - `counterKey`, `formatDocNumber`, `parseDocNumber`, `nextSequence`
    - Imports limited to types; no browser APIs, clock or randomness
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 13.1_

  - [x] 2.2 Implement references, initiate plan, service lines, signed validation and counter migration
    - `resolveReferences` (booking preference, agreement, quotation, latest non-cancelled invoice, agreement-number fallback, `missing` and `notes`)
    - `planInitiate`, `canInitiate`, `pickerMachines`
    - `validateServiceLine`, `lineAmount`, `tpsTotal` (integer cents)
    - `ALLOWED_SIGNED_MIME`, `validateSignedFile`, `migrateCounters`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 9.4, 9.5, 9.6, 9.9, 9.10, 11.4, 13.1_

  - [x]* 2.3 Write property test for fleet number selection
    - File: `src/services/__tests__/collection/fleetNumber.property.test.ts`
    - **Property 1: Fleet number selection**
    - **Validates: Requirements 4.2**

  - [x]* 2.4 Write property test for fleet number uniqueness
    - File: `src/services/__tests__/collection/fleetDuplicate.property.test.ts`
    - **Property 2: Fleet number uniqueness is per organisation and normalised**
    - **Validates: Requirements 4.3, 4.4, 4.5**

  - [x]* 2.5 Write property test for QR payload round trip
    - File: `src/services/__tests__/collection/qrRoundTrip.property.test.ts`
    - **Property 3: QR payload round trip** (payload parse and `qrcode` module bitmap decoded with `jsqr`)
    - **Validates: Requirements 5.1, 5.2, 7.5**

  - [x]* 2.6 Write property test for QR resolver success
    - File: `src/services/__tests__/collection/qrResolveSuccess.property.test.ts`
    - **Property 4: QR resolver success**
    - **Validates: Requirements 5.5**

  - [x]* 2.7 Write property test for QR resolver errors
    - File: `src/services/__tests__/collection/qrResolveErrors.property.test.ts`
    - **Property 5: QR resolver errors**
    - **Validates: Requirements 5.6, 5.7, 5.8, 5.9, 5.10**

  - [x]* 2.8 Write property test for deep link resolution
    - File: `src/services/__tests__/collection/deepLink.property.test.ts`
    - **Property 6: Deep link resolution**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x]* 2.9 Write property test for document number format
    - File: `src/services/__tests__/collection/docNumber.property.test.ts`
    - **Property 7: Document number format round trip**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x]* 2.10 Write property test for reference chain resolution
    - File: `src/services/__tests__/collection/referenceChain.property.test.ts`
    - **Property 11: Reference chain resolution**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [x]* 2.11 Write property test for refresh idempotence
    - File: `src/services/__tests__/collection/refreshReferences.property.test.ts`
    - **Property 12: Refresh is idempotent and equals a fresh resolve**
    - **Validates: Requirements 3.7**

  - [x]* 2.12 Write property test for initiate plan
    - File: `src/services/__tests__/collection/initiatePlan.property.test.ts`
    - **Property 13: Initiate plan**
    - **Validates: Requirements 1.1, 1.2, 1.8, 1.9, 1.12**

  - [x]* 2.13 Write property test for picker and action visibility
    - File: `src/services/__tests__/collection/pickerVisibility.property.test.ts`
    - **Property 14: Picker and action visibility**
    - **Validates: Requirements 1.3, 1.5, 1.6, 1.7**

  - [x]* 2.14 Write property test for service line validation
    - File: `src/services/__tests__/collection/serviceLineValidation.property.test.ts`
    - **Property 15: Service line validation**
    - **Validates: Requirements 9.4, 9.10**

  - [x]* 2.15 Write property test for totals
    - File: `src/services/__tests__/collection/tpsTotals.property.test.ts`
    - **Property 16: Totals**
    - **Validates: Requirements 9.5, 9.6, 9.9**

  - [x]* 2.16 Write property test for signed file type validation
    - File: `src/services/__tests__/collection/signedFileType.property.test.ts`
    - **Property 19: Signed file type validation**
    - **Validates: Requirements 11.4**

- [x] 3. Signed file storage `src/services/signedFiles.ts`
  - [x] 3.1 Implement IndexedDB storage with in-memory fallback
    - `createSignedFiles(idb?)`, `signedFiles`, `put`, `get`, `remove`, `backend`
    - Database `axleops-signed-files`, store `files`, key `${orgId}/${type}/${docId}`; photo keys `${orgId}/MQD/${docId}/photo-${n}`
    - Fall back to a `Map` when `indexedDB` is missing or `open` fails
    - _Requirements: 10.2, 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x]* 3.2 Write property test for signed copy store round trip
    - File: `src/services/__tests__/collection/signedFilesRoundTrip.property.test.ts`
    - **Property 18: Signed copy store round trip** (memory backend and `fake-indexeddb`)
    - **Validates: Requirements 11.1, 11.3, 11.5, 11.6**

- [x] 4. Stores
  - [x] 4.1 Implement `src/store/collectionStore.ts`
    - Key `fleet-collection-notes-v1`, `notes`, `counters`, `demoSeededOrgs`
    - `forOrg`, `getById`, `issueNumber`, `insert`, `patch` (id, orgId, number, createdAt immutable), `remove` (counters untouched), `newId`
    - Exported total `migrateCollectionState` using `migrateCounters`
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 8.6_

  - [x] 4.2 Implement `src/store/mqdStore.ts`
    - Key `fleet-mqd-v1`, same shape with `records`, MQD numbering
    - Exported total `migrateMqdState`
    - _Requirements: 2.2, 2.4, 2.5, 2.6, 10.1_

  - [x] 4.3 Implement `src/store/thirdPartyStore.ts`
    - Key `fleet-third-party-v1`, same shape with `documents`, TPS numbering
    - Exported total `migrateThirdPartyState`
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 9.7_

  - [x] 4.4 Add `attachSigned` to `src/services/signedFiles.ts`
    - Validate with `validateSignedFile`, store with `put`, then set `signedStatus: 'Signed'` and `signedFile` on the document in the owning store
    - Reject invalid types with an error message and leave status unchanged
    - _Requirements: 11.1, 11.3, 11.4_

  - [x]* 4.5 Write property test for sequences
    - File: `src/services/__tests__/collection/sequences.property.test.ts`
    - **Property 8: Sequences are independent and increment by one**
    - **Validates: Requirements 2.4, 2.5**

  - [x]* 4.6 Write property test for numbers never reused
    - File: `src/services/__tests__/collection/numbersNeverReused.property.test.ts`
    - **Property 9: Numbers are never reused**
    - **Validates: Requirements 2.6**

  - [x]* 4.7 Write property test for migrate totality
    - File: `src/services/__tests__/collection/migrateTotality.property.test.ts`
    - **Property 10: Migrate totality and counter floor**
    - **Validates: Requirements 2.5, 2.6**

- [x] 5. PDF generation `src/services/collectionPdf.ts`
  - [x] 5.1 Implement content builders and renderers
    - Pure `collectionNoteContent`, `mqdContent`, `tpsContent`
    - `renderPdf` (jspdf), `qrDataUrl` (qrcode), `collectionNotePdf`, `mqdPdf`, `tpsPdf`
    - Dynamic `import()` for `jspdf` and `qrcode`; no import of `services.ts` or `appStore.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 13.2_

  - [x]* 5.2 Write property test for PDF content completeness
    - File: `src/services/__tests__/collection/pdfContent.property.test.ts`
    - **Property 17: PDF content completeness**
    - **Validates: Requirements 7.4, 7.6, 7.7, 7.8**

- [x] 6. Demo data
  - [x] 6.1 Implement `src/services/mock/demoCollection.ts`
    - Pure `demoCollectionForOrg(orgId, ctx)` builders for CN-2026-0001, MQD-2026-0001, TPS-2026-0001 (Gulf Haulage LLC 1,200 and Al Rafi Cranes 2,500) and CN-2026-0002
    - Ids `cn-demo-<orgId>-1|2`, `mqd-demo-<orgId>-1`, `tps-demo-<orgId>-1`, machines from `demoMachineId(orgId, 4|5)`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.8_

  - [x] 6.2 Add `ensureCollectionDemo` to `src/services/demoSeed.ts`
    - Once-per-org flag in the three stores, skip missing machines, insert only absent ids, raise counters, put placeholder PDF for CN-2026-0002
    - Call from `ensureHireLinkDemo` (including org-ja before its early return); wrap in `try/catch` and log with `console.error('[demoSeed]', err)`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_

  - [x]* 6.3 Write property test for demo seed idempotence
    - File: `src/services/__tests__/collection/demoSeed.property.test.ts`
    - **Property 21: Demo seed idempotence and org-specific ids**
    - **Validates: Requirements 12.1, 12.8, 12.9, 12.10**

- [x] 7. Facade `src/services/collectionDocs.ts`
  - [x] 7.1 Implement `collectionDocs.ts`
    - `initiateOffHire` (injected `MachineResolver` and `TransportJobCallback`, notices for skipped documents and transport failure), `refreshReferences`, `listPickerMachines`, `resolveQrForCurrentOrg`, `mergedMqdList`, `deleteDocument`
    - Read `orgStore.isAppActive` for `mqd`, `third_party_services`, `transport`
    - No import of `services.ts` or `appStore.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 1.9, 1.10, 1.11, 1.12, 3.1, 3.7, 5.5, 10.3, 13.2_

  - [x]* 7.2 Write property test for MQD persistence and merge
    - File: `src/services/__tests__/collection/mqdPersistence.property.test.ts`
    - **Property 20: MQD persistence round trip and merge**
    - **Validates: Requirements 10.1, 10.3, 10.4**

  - [x]* 7.3 Write unit tests for the initiate flow
    - File: `src/services/__tests__/collection/initiateFlow.test.ts`
    - Transport callback success, failure (documents kept, error notice) and Transport inactive (callback not called); MQD or TPS inactive notices
    - _Requirements: 1.8, 1.9, 1.10, 1.11_

- [x] 8. Fleet changes
  - [x] 8.1 Add duplicate fleet number check to `machineService` in `src/services/services.ts`
    - Call `findDuplicateFleetNo` in `create` and `update`; throw `DuplicateFleetNoError` without changing data
    - Additive edit only
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 8.2 Update `src/features/fleet/MachineFormDialog.tsx`
    - Save both `fleetNo` and `assetNumber`; reject duplicates with the form error "Duplicate fleet number"
    - _Requirements: 4.1, 4.3, 4.5_

  - [x] 8.3 Create QR panel and Initiate dialog components
    - `src/features/fleet/MachineQrPanel.tsx` showing the QR of `buildQrPayload(machine)`
    - `src/features/collection/InitiateDialog.tsx` with picker from `listPickerMachines` showing fleet numbers, preselect support, notices display
    - Do not import `crmStore`
    - _Requirements: 1.1, 1.3, 1.4, 1.8, 1.9, 1.10, 1.11, 5.4, 13.3_

  - [x] 8.4 Update `src/features/fleet/FleetPage.tsx`
    - Read `fleet`, `id` and `qr` query params through `resolveFleetQuery`; open detail on success, show error code or not-found message otherwise
    - Show `MachineQrPanel` in the detail panel
    - Show "Initiate Off-Hire / Collection" only when `canInitiate(effectiveStatus, isAppActive('collection_note'))`
    - Pass `{ list, statusOf }` resolver and `addTransportJob` callback from the page
    - _Requirements: 1.5, 1.6, 1.7, 5.4, 6.1, 6.2, 6.3, 6.4_

- [x] 9. Collection Note app
  - [x] 9.1 Create `src/features/collection/CollectionDetail.tsx`
    - Editable non-reference fields, read-only reference fields, Refresh references, QR preview, links to linked MQD and TPS, Download PDF, signed copy upload and view, save through `collectionStore.patch`
    - Do not import `crmStore`
    - _Requirements: 3.6, 3.7, 5.3, 7.1, 8.2, 8.3, 8.4, 8.5, 8.6, 11.1, 11.2, 11.3, 11.4_

  - [x] 9.2 Create `src/features/collection/CollectionNotePage.tsx`
    - List with number, fleet number, customer, quotation, invoice, date, collection status, signed status
    - Initiate dialog and detail view wiring
    - _Requirements: 1.1, 8.1, 8.2, 8.5, 13.3_

  - [x] 9.3 Route `/docs/collection-note` to `CollectionNotePage` in `src/app/AppRouter.tsx`
    - Replace the placeholder `DocumentAppPage` for `collection_note`
    - _Requirements: 8.1_

- [x] 10. Third-Party Services app
  - [x] 10.1 Add `third_party_services` entry to `src/services/apps.ts`
    - Documents category, path `/docs/third-party-services`, `depends: []`, existing edges unchanged
    - _Requirements: 9.1, 13.4_

  - [x] 10.2 Create `src/features/thirdparty/ServiceLineTable.tsx`
    - Editable provider, Service_Type select, description, date, reference or PO, quantity, rate; computed amount; add and remove line; inline validation via `validateServiceLine`
    - _Requirements: 9.3, 9.4, 9.5, 9.9, 9.10_

  - [x] 10.3 Create `src/features/thirdparty/ThirdPartyServicesPage.tsx`
    - List with number, collection note number, fleet number, customer, total, signed status
    - Detail form with every field editable, notes, approvedBy, signature, total from `tpsTotal`, Download PDF, signed copy upload and view
    - Do not import `crmStore`
    - _Requirements: 7.3, 9.2, 9.6, 9.7, 9.8, 11.1, 11.2, 11.3, 11.4, 13.3_

  - [x] 10.4 Route `/docs/third-party-services` in `src/app/AppRouter.tsx`
    - _Requirements: 9.1_

- [x] 11. MQD persistence, list, edit and PDF
  - [x] 11.1 Update `src/features/inspections/MQDDialog.tsx`
    - Optional `record` prop (edit mode) and `onSaved`; on submit create or patch an `MqdRecord` in `mqdStore` and save photos through `signedFiles.put`
    - All fields editable when opening a persisted MQD
    - _Requirements: 10.1, 10.2, 10.4_

  - [x] 11.2 Update `src/features/inspections/InspectionPage.tsx`
    - For `type="MQD"` list `mergedMqdList(mockList)` with reference, fleet number, hirer, Collection Note number, signed status
    - Title "Machine Quality Document", Download MQD PDF, signed copy upload and view
    - _Requirements: 7.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.4_

- [x] 12. Architecture tests
  - [x] 12.1 Extend `src/architecture.test.ts`
    - `collectionCore.ts` imports only types, no `require` or dynamic import
    - `collectionDocs.ts` and `collectionPdf.ts` do not import `services.ts` or `appStore.ts`
    - `features/collection` and `features/thirdparty` do not import `crmStore`
    - Existing `apps.ts` edge tests still pass; smoke check for `third_party_services` and `Machine.fleetNo`
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Final verification
  - [x] 14.1 Run type check, tests and lint
    - `npx tsc -b` with no errors
    - `npx vitest --run` with all tests passing
    - `npx eslint` on every touched file
    - Fix any failures before continuing
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 14.2 Verify `src/services/services.ts` against HEAD
    - Compare line and export counts with `git show HEAD:src/services/services.ts`
    - Confirm the diff is additive (duplicate fleet number check only) with no lost content
    - _Requirements: 4.3_

  - [x] 14.3 Verify git state
    - Confirm current branch is `feature/crm-plugin`
    - Confirm no commits were made during the work (`git log` HEAD unchanged, changes uncommitted)
    - _Requirements: 13.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each property test is a separate sub-task in its own file under `src/services/__tests__/collection/` and carries the tag comment `Feature: offhire-collection-docs, Property <n>: <title>` with at least 100 runs
- Task 14 is required and covers `tsc -b`, `vitest --run`, eslint on touched files, the `services.ts` comparison and the branch check
- Do not commit; stay on `feature/crm-plugin`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "3.2"] },
    { "id": 3, "tasks": ["2.10", "2.11", "2.12", "2.13", "2.14", "2.15", "2.16", "4.1", "4.2", "4.3", "5.1", "6.1"] },
    { "id": 4, "tasks": ["4.4", "4.5", "4.6", "4.7", "5.2", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1", "8.1", "8.2", "10.1", "10.2"] },
    { "id": 6, "tasks": ["7.2", "7.3", "8.3", "9.1", "10.3", "11.1"] },
    { "id": 7, "tasks": ["8.4", "9.2", "11.2"] },
    { "id": 8, "tasks": ["9.3"] },
    { "id": 9, "tasks": ["10.4"] },
    { "id": 10, "tasks": ["12.1"] },
    { "id": 11, "tasks": ["14.1", "14.2"] },
    { "id": 12, "tasks": ["14.3"] }
  ]
}
```
