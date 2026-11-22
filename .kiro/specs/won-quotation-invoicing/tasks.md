# Implementation Plan: Won Quotation Invoicing

## Overview

Build the feature bottom-up: types and a pure rules module first, then the persisted invoice store, demo data, the facade and service, the CRM changes, and finally the Invoice page. Each step is wired into the previous one. Language: TypeScript. Install dependencies with `npm install --legacy-peer-deps` if needed. Run tests with `npx vitest --run`.

## Tasks

- [x] 1. Domain types and pure invoice rules
  - [x] 1.1 Extend the `TaxInvoice` type
    - In `src/types/taxinvoice.ts` add the optional fields `orgId`, `quotationId`, `quotationNumber`, `invoiceType`, `periodStart`, `periodEnd`, `sequence`, `hireAgreementId` and export `InvoiceType`
    - Keep all existing fields unchanged so legacy invoices still type-check
    - _Requirements: 3.6, 7.5, 9.4_

  - [x] 1.2 Create `src/services/invoiceRulesCore.ts`: dates, selection, numbering, totals
    - Types-only imports. Export `VAT_RATE`, `MAX_SEQUENCE`, `RuleCode`, `RULE_MESSAGES`, `RuleResult`, the lite snapshot types
    - Implement `isDateString`, `addDays`, `compareDates` (UTC arithmetic on `YYYY-MM-DD`)
    - Implement `listInvoiceableQuotations` (Won + active org), `resolveSourceAgreement` (single non-Cancelled agreement in the org, else `NO_AGREEMENT` / `AMBIGUOUS_AGREEMENT`, order independent)
    - Implement `formatInvoiceNo` / `parseInvoiceNo` and `recalcTotals` (formula extracted unchanged from `InvoicePage.recalc`, VAT 5%)
    - _Requirements: 1.1, 1.2, 1.8, 2.1, 2.2, 2.3, 3.1, 3.2, 8.1, 8.2, 8.3, 8.4, 13.1_

  - [x] 1.3 Add request validation, draft building, update and removal rules to `invoiceRulesCore.ts`
    - `validateInvoiceRequest` with the ordered checks from the design (required, CRM active, found, Won, agreement, dates, type, Off-Hire finality, sequence, derived start, `OVERLAP`/`GAP`/`DUPLICATE_PERIOD`, end rules, Off-Hire end)
    - `nextPeriodStart`, `activeInvoices` (Cancelled excluded), `buildInvoiceDraft` (carry-over, hire period text, due date from payment terms, Draft status, orgId)
    - `validateInvoiceUpdate` (protected fields, legacy always allowed) and `validateInvoiceRemoval` (latest active only, legacy always allowed)
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 2.4, 3.3, 3.4, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 9.5, 9.6, 9.7, 9.8, 11.1, 11.2, 11.4_

  - [x]* 1.4 Write property test for the Won gate
    - File `src/services/__tests__/invoicing/p01-won-gate.test.ts`
    - **Property 1: Only Won quotations of the active organisation are invoiceable**
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x]* 1.5 Write property test for agreement resolution
    - File `src/services/__tests__/invoicing/p02-agreement-resolution.test.ts`
    - **Property 2: Source agreement resolution is deterministic**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x]* 1.6 Write property test for the invoice number round trip
    - File `src/services/__tests__/invoicing/p03-invoice-no.test.ts`
    - **Property 3: Invoice number round trip**
    - **Validates: Requirements 3.1, 3.2**

  - [x]* 1.7 Write property test for totals and VAT
    - File `src/services/__tests__/invoicing/p09-totals.test.ts`
    - **Property 9: Totals follow the existing VAT rules**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

  - [x]* 1.8 Write property test for rule messages
    - File `src/services/__tests__/invoicing/p13-messages.test.ts`
    - **Property 13: Every rule code has a reason message**
    - **Validates: Requirements 1.8**

  - [x]* 1.9 Write property test for billing period derivation
    - File `src/services/__tests__/invoicing/p05-period.test.ts`
    - **Property 5: Billing period is derived from the hire dates and previous periods**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4**

  - [x]* 1.10 Write property test for Off-Hire
    - File `src/services/__tests__/invoicing/p06-off-hire.test.ts`
    - **Property 6: Off-Hire uses the hire end date and is final**
    - **Validates: Requirements 5.1, 5.3, 5.4, 5.5, 5.6, 5.7**

  - [x]* 1.11 Write property test for sequence numbers
    - File `src/services/__tests__/invoicing/p04-sequence.test.ts`
    - Model create / cancel / delete operations on an in-memory snapshot
    - **Property 4: Sequence numbers are strictly increasing and never reused**
    - **Validates: Requirements 3.3, 3.4, 11.3**

  - [x]* 1.12 Write property test for contiguous periods
    - File `src/services/__tests__/invoicing/p07-contiguity.test.ts`
    - **Property 7: Active billing periods stay contiguous and within the hire dates**
    - **Validates: Requirements 6.5, 6.6, 6.7, 6.8**

  - [x]* 1.13 Write property test for carry-over
    - File `src/services/__tests__/invoicing/p08-carry-over.test.ts`
    - **Property 8: Carry-over copies source data and links to the quotation**
    - **Validates: Requirements 3.6, 4.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9**

  - [x]* 1.14 Write property test for immutability and legacy edits
    - File `src/services/__tests__/invoicing/p10-immutable.test.ts`
    - **Property 10: Linked invoices keep protected fields, legacy invoices stay editable**
    - **Validates: Requirements 9.5, 9.6, 9.7, 9.8**

  - [x]* 1.15 Write property test for delete and cancel control
    - File `src/services/__tests__/invoicing/p11-removal.test.ts`
    - **Property 11: Only the latest active linked invoice can be deleted or cancelled**
    - **Validates: Requirements 11.1, 11.2, 11.4**

- [x] 2. Persisted invoice store
  - [x] 2.1 Create `src/store/taxInvoiceStore.ts`
    - zustand `persist`, key `fleet-tax-invoices-v1`, `version: 1`, state `invoices`, `seededOrgs`, `demoLinkedOrgs`, `sequenceByQuotation`
    - Actions `ensureSeeded` (existing demo invoices from `mock/taxinvoice.ts`, ids `inv-seed-<orgId>-<n>`, once per org), `forOrg`, `getById`, `insert`, `insertLinked` (bumps the quotation counter), `patch`, `remove` (counter unchanged), `newId`
    - `migrate`: normalise rows (default `orgId`), reset on malformed data with a warning, rebuild counters from stored sequences
    - Model on `src/store/hireAgreementStore.ts`
    - _Requirements: 3.3, 9.1, 9.2, 9.3, 9.4, 11.3_

  - [x]* 2.2 Write property test for store migration
    - File `src/store/__tests__/taxInvoiceStore.migrate.test.ts`
    - **Property 12: Store migration is total and preserves rows**
    - **Validates: Requirements 9.2, 9.4**

  - [x]* 2.3 Write unit tests for the store
    - File `src/store/__tests__/taxInvoiceStore.test.ts`
    - Seeding once per org, persistence round trip, `insertLinked` counter, remove keeps counter
    - _Requirements: 9.1, 9.3, 3.3, 11.3_

- [x] 3. Demo data
  - [x] 3.1 Add the sample linked invoice to the demo seed
    - `src/services/mock/demoHireLink.ts`: `demoInvoiceForQuotation(orgId)` using the seed agreement `ha-seed-<org>-5` and `buildInvoiceDraft`; Continuous Hire, `QT-2026-0010/01`, period `2026-11-14` to `2026-11-30`, status Sent
    - `src/services/demoSeed.ts`: `ensureInvoiceDemo(orgId)` inserts the sample once per org (guarded by `demoLinkedOrgs`), sets the quotation counter to 1, skips when the quotation is missing; call it from `ensureHireLinkDemo` for non-JA orgs
    - Keep demo agreement dates unchanged
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x]* 3.2 Write unit tests for the demo seed
    - File `src/services/__tests__/invoicing/demoInvoice.test.ts`
    - Sample exists for org-ja and for a second org, counter is 1, next invoice gets `/02`, a deleted sample is not re-added
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 4. Facade and tax invoice service
  - [x] 4.1 Create `src/services/quotationInvoicing.ts`
    - Snapshot builder (calls `ensureHireLinkDemo`, `ensureSeeded`, `ensureInvoiceDemo`; reads CRM active flag, quotations, agreements, invoices, counters)
    - Export `InvoiceRuleError`, `listWonQuotations`, `previewInvoice`, `createFromQuotation`, `updateInvoice`, `removeInvoice`, `listInvoices`, `getInvoice`, `invoicesForQuotation`, `useInvoicesForQuotation`, `buildQuotationPrefill`
    - Create validates against a fresh snapshot and inserts synchronously; updates and removals apply the core rules and always recompute totals; do not import `services.ts` or `appStore.ts`
    - Follow `src/services/hireLink.ts`
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 3.6, 6.8, 8.5, 9.5, 9.6, 11.1, 11.2, 13.2, 13.3_

  - [x] 4.2 Switch `taxInvoiceService` to the facade and remove the in-memory dataset
    - `src/services/services.ts`: `list` / `get` read through the facade, `create` requires `quotationId` and calls `createFromQuotation`, `update` and `delete` call the facade; keep `delay(...)` returns so `useQueries.ts` hooks stay unchanged
    - `src/services/mock/orgData.ts`: remove `taxInvoicesForOrg`, its cache and the `demoTaxInvoices` import
    - _Requirements: 1.7, 9.1, 9.4, 9.5, 11.1, 13.3_

  - [x]* 4.3 Write service and facade tests
    - File `src/services/__tests__/invoicing/service.test.ts` with a reset CRM, agreement and invoice store
    - Unlinked and non-Won create rejected and nothing stored; CRM inactive; no agreement; two agreements; two creates in a row get `/01` then `/02` with contiguous periods; Off-Hire after a Continuous invoice to the hire end gives `NOTHING_TO_BILL`; legacy update accepted; linked update of a protected field rejected; `NOT_LATEST_INVOICE`
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 2.2, 2.3, 5.4, 6.8, 9.5, 9.8, 11.2_

  - [x]* 4.4 Add architecture tests
    - `src/architecture.test.ts`: `invoiceRulesCore.ts` imports only types; `quotationInvoicing.ts` does not import `services.ts` or `appStore.ts`; `apps.ts` dependency test stays green
    - _Requirements: 13.1, 13.2, 13.5, 13.6_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. CRM integration
  - [x] 6.1 Extend the invoicing prefill
    - `src/features/crm/crmRules.ts`: `toInvoicePrefill` adds `quotationId: q.id`, existing fields kept
    - `src/features/crm/CrmPage.tsx`: keep `proceedToInvoice` navigation with the new prefill
    - _Requirements: 10.1, 2.6_

  - [x] 6.2 List linked invoices in the quotation detail
    - `src/features/crm/CrmShared.tsx`: "Invoices" section in `QuotationDetail` using `useInvoicesForQuotation` from the facade: number, type, billing period, total, status; "No invoices yet" when empty
    - _Requirements: 10.2, 10.3, 10.4, 13.4_

  - [x]* 6.3 Write CRM tests
    - Extend the existing CRM rules test (or add `src/features/crm/invoicePrefill.test.ts`): prefill shape includes `quotationId`; detail panel lists linked invoices and shows "No invoices yet"
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 7. Invoice page
  - [x] 7.1 Add the "create from quotation" flow to `InvoicePage.tsx`
    - Replace local `recalc` with `recalcTotals`; Won quotation select (facade), prefill preselection (new and old prefill shape), type radio, read-only agreement/hire dates/period start, end date input for Continuous Hire and read-only hire end for Off-Hire
    - Live `previewInvoice` message and Save disabled while invalid; fill the form from the preview; show rule messages on save errors
    - Keep `pickAgreement` for legacy forms only; linked invoices show number, quotation, type and period read-only
    - _Requirements: 1.1, 1.8, 2.5, 2.6, 3.5, 4.1, 4.8, 5.2, 7.8, 8.6, 9.9_

  - [x] 7.2 Update the invoice list
    - `InvoicePage.tsx`: columns Quotation, Type, Billing period (empty for legacy); quotation number click filters the list; delete and cancel show the rule message (`NOT_LATEST_INVOICE`)
    - _Requirements: 10.5, 10.6, 11.2_

  - [x]* 7.3 Write component tests for the Invoice page
    - File `src/features/documents/InvoicePage.test.tsx`: end date input shown only for Continuous Hire, Save disabled on invalid preview, legacy invoice opens and `pickAgreement` fills it, old prefill shape shows the choose-quotation message
    - _Requirements: 2.6, 4.1, 5.2, 9.4, 9.9_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Final verification
  - [x] 9.1 Run the full verification
    - `npx tsc -b` with no errors
    - `npx vitest --run` with all tests passing
    - `npx eslint` on every touched file (types, rules core, store, facade, services, orgData, demo files, CRM files, InvoicePage, new tests)
    - Fix any failure and rerun until clean
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Task 9.1 is required.
- Each task references specific requirements for traceability.
- Property tests use fast-check with at least 100 runs and the tag `Feature: won-quotation-invoicing, Property N: <text>`.
- Each property test has its own file so test tasks can run in parallel.
- Do not change the VAT rate or add charge types.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1", "1.4", "1.5", "1.6", "1.7", "1.8"] },
    { "id": 3, "tasks": ["1.9", "1.10", "1.11", "1.12", "1.13", "1.14", "1.15", "2.2", "2.3", "3.1"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.4", "3.2", "6.1", "6.2"] },
    { "id": 6, "tasks": ["4.3", "6.3", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3"] },
    { "id": 9, "tasks": ["9.1"] }
  ]
}
```
