# Implementation Plan: CRM Plugin

## Overview

Implementation language: TypeScript (React 18, Vite, Zustand, TanStack Query). Work proceeds bottom-up: types and pure rules first, then the persisted store, service and hooks, then app registration and UI, then the invoice handoff and Odoo mapping documentation. Each step is wired into the previous ones.

## Tasks

- [ ] 1. Set up types, test tooling and seed data
  - [ ] 1.1 Add `vitest` and `fast-check` dev dependencies and a `test` script (`vitest --run`) in `package.json`
    - Add a minimal vitest config if none exists
    - _Requirements: 2.1_
  - [ ] 1.2 Create `src/types/quotation.ts`
    - Define `QuotationPhase`, `PHASES`, `PhaseHistoryEntry`, `Quotation`, `QuotationDraft`, `DEFAULT_LOST_REASONS`
    - Export from the types index if one exists
    - _Requirements: 2.1, 4.2_
  - [ ] 1.3 Create `src/services/mock/quotations.ts` seed data
    - At least one quotation per phase, with valid history satisfying the design invariants
    - _Requirements: 9.5_

- [ ] 2. Implement pure CRM rules
  - [ ] 2.1 Create `src/features/crm/crmRules.ts`
    - Implement `ALLOWED`, `isAllowed`, `transitionError`, `applyTransition` (blank-reason rejection, lost fields, history append)
    - Implement `pipelineOf`, `byPhase`, `pipelineTotals`, `searchLost`, `filterList`, `toInvoicePrefill`, and a Lost row model helper
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.3, 4.4, 5.2, 5.3, 5.4, 6.2, 6.3, 7.2, 7.3, 8.4, 10.3_
  - [ ]* 2.2 Write property tests for transitions
    - **Property 2: Allowed transitions set the target phase**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 5.2**
  - [ ]* 2.3 Write property test for disallowed transitions
    - **Property 3: Disallowed transitions are rejected without change**
    - **Validates: Requirements 3.5**
  - [ ]* 2.4 Write property test for rejection messages
    - **Property 4: Rejection message names both phases**
    - **Validates: Requirements 3.6**
  - [ ]* 2.5 Write property test for blank reasons
    - **Property 5: Blank reasons are rejected**
    - **Validates: Requirements 4.3, 5.3**
  - [ ]* 2.6 Write property test for history entries
    - **Property 6: Successful transitions append a consistent history entry**
    - **Validates: Requirements 3.7, 4.4, 5.4**
  - [ ]* 2.7 Write property test for phase partition
    - **Property 7: Phase views partition quotations**
    - **Validates: Requirements 5.5, 6.1, 6.2, 7.1, 8.1, 8.2**
  - [ ]* 2.8 Write property test for pipeline totals
    - **Property 8: Pipeline totals exclude Lost and Won**
    - **Validates: Requirements 6.3**
  - [ ]* 2.9 Write property test for Lost search
    - **Property 9: Lost search matches case-insensitively**
    - **Validates: Requirements 7.3**
  - [ ]* 2.10 Write property test for Lost row fields
    - **Property 10: Lost rows expose required fields**
    - **Validates: Requirements 7.2**
  - [ ]* 2.11 Write property test for list filter
    - **Property 11: List filter combines phase and text**
    - **Validates: Requirements 10.3**
  - [ ]* 2.12 Write property test for invoice prefill
    - **Property 12: Invoice prefill carries quotation data**
    - **Validates: Requirements 8.4**

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement store, service and query hooks
  - [ ] 4.1 Create `src/store/crmStore.ts`
    - Zustand `persist` store, key `fleet-crm-v1`, version 1, seed initial state, `create`, `changePhase`, `resetToSeed`
    - Custom storage that warns and loads seed on parse failure
    - _Requirements: 2.2, 9.1, 9.2, 9.3, 9.5_
  - [ ] 4.2 Add `quotationService` to `src/services/services.ts`
    - `list` (filtered by current org), `get`, `create`, `changePhase`, all via the store only; resolve acting user from auth store; return `{ ok: false, error }` for rejections including unknown id
    - _Requirements: 2.2, 3.5, 3.6, 9.4_
  - [ ] 4.3 Add `useQuotations`, `useCreateQuotation`, `useChangePhase` to `src/hooks/useQueries.ts`
    - Invalidate the quotations query on success so views update without refresh
    - _Requirements: 6.1, 8.2_
  - [ ]* 4.4 Write property test for creation
    - **Property 1: New quotations start Awaiting**
    - **Validates: Requirements 2.2**
  - [ ]* 4.5 Write property test for persistence round trip
    - **Property 13: Store persistence round trip**
    - **Validates: Requirements 9.1, 9.2**
  - [ ]* 4.6 Write property test for corrupt data fallback
    - **Property 14: Corrupt persisted data falls back to seed**
    - **Validates: Requirements 9.3**
  - [ ]* 4.7 Write unit tests for seed contents and service
    - Seed has all four phases; service rejects unknown id; service does not access localStorage directly
    - _Requirements: 9.4, 9.5_

- [ ] 5. Register the CRM app
  - [ ] 5.1 Add the `crm` entry to `src/constants/apps.ts`
    - id, name, summary, icon, category, `depends: ['customer_ani', 'invoice']`, paths `/crm`, `/crm/lost`, `/crm/won`, labels
    - _Requirements: 1.1, 1.5_
  - [ ] 5.2 Add `DEFAULT_SCHEMAS.crm` to `src/constants/appSchemas.ts` and presets to `src/constants/appPresets.ts`
    - Blank and "Demo pipeline" presets; optional `quotations` key in `AppPreset.records`
    - _Requirements: 1.4_
  - [ ]* 5.3 Write property test for deactivation
    - **Property 15: Deactivation keeps quotations**
    - **Validates: Requirements 1.3**
  - [ ]* 5.4 Write unit tests for registration
    - Required fields, dependencies, schema and presets exist; sidebar items appear on activate and disappear on deactivate
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 6. Build the CRM UI
  - [ ] 6.1 Create dialogs and detail drawer
    - `LostReasonDialog.tsx` (default reasons, free text for Other, submit blocked when blank), `ReopenDialog.tsx` (reason required), `QuotationDetail.tsx` (key details and Phase_History)
    - _Requirements: 4.1, 4.2, 5.2, 5.3, 7.4_
  - [ ] 6.2 Create `PipelineBoard.tsx`
    - Awaiting and Tender columns with counts and totals, HTML5 drag-and-drop calling `changePhase`, card actions (Move to Tender, Mark Won, Mark Lost), error toast using the rejection message, phase badge on each card
    - _Requirements: 2.3, 2.4, 3.6, 6.1, 6.2, 6.3, 10.1, 10.2_
  - [ ] 6.3 Create `QuotationList.tsx`
    - List with phase select (All plus four phases) and text search
    - _Requirements: 2.3, 2.4, 10.3_
  - [ ] 6.4 Create `LostTab.tsx`
    - Table with number, customer, amount, reason, date lost, lost by; search; row click opens detail; Reopen action for every user; empty-state message
    - _Requirements: 5.1, 5.5, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [ ] 6.5 Create `WonView.tsx`
    - List of Won quotations with "Proceed to invoicing" navigating to `/docs/invoice` with `state.prefill`; disabled with "Activate the Invoice app" message when the invoice app is inactive
    - _Requirements: 8.1, 8.3, 8.4, 8.5_
  - [ ] 6.6 Create `CrmPage.tsx` and add lazy routes `/crm`, `/crm/lost`, `/crm/won` in `src/app/AppRouter.tsx` under `AppGuard`
    - Route-driven tabs: Pipeline, List, Lost, Won; create-quotation action
    - _Requirements: 1.2, 2.3, 2.4, 10.1_
  - [ ]* 6.7 Write unit tests for UI behaviour
    - Lost empty state, disabled invoicing action, drag-drop handler calls the service, blank Lost reason blocked
    - _Requirements: 4.3, 7.5, 8.5, 10.2_

- [ ] 7. Invoice handoff and Odoo mapping
  - [ ] 7.1 Update `InvoicePage` to read optional `location.state?.prefill` once on mount
    - Seed customer, amount and reference; unchanged behaviour with no state
    - _Requirements: 8.4_
  - [ ] 7.2 Create `.kiro/specs/crm-plugin/odoo-mapping.md` from the design's Odoo mapping section
    - Field mapping, phase-to-stage table (including Lost_Reason to `lost_reason_id`), default reasons; leave `odoo/addons` unchanged
    - _Requirements: 11.1, 11.2_
  - [ ]* 7.3 Write unit test for prefill handoff
    - Navigating with prefill state populates the invoice form
    - _Requirements: 8.4_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties; unit tests cover examples and edge cases
- Requirements 10.4 (no Odoo code copied) and 11.2 (no addon changes) are verified by review and `git diff`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "4.1", "5.1"] },
    { "id": 3, "tasks": ["2.3", "4.2", "5.2"] },
    { "id": 4, "tasks": ["2.4", "4.3", "7.1"] },
    { "id": 5, "tasks": ["2.5", "4.4", "6.1", "7.2"] },
    { "id": 6, "tasks": ["2.6", "4.5", "6.2", "7.3"] },
    { "id": 7, "tasks": ["2.7", "4.6", "6.3"] },
    { "id": 8, "tasks": ["2.8", "4.7", "6.4"] },
    { "id": 9, "tasks": ["2.9", "5.3", "6.5"] },
    { "id": 10, "tasks": ["2.10", "5.4", "6.6"] },
    { "id": 11, "tasks": ["2.11", "6.7"] },
    { "id": 12, "tasks": ["2.12"] }
  ]
}
```
