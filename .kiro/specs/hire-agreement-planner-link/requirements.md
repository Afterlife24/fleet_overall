# Requirements Document

## Introduction

This feature links a Fleet Planner allocation to a Hire Agreement and, through the agreement, to a CRM quotation. When the allocated machine goes On Hire, the Linked_Quotation moves to the Won phase automatically. The transition does not depend on job state.

The link chain is: Planner_Allocation (booking) → `hireAgreementId` → `HireAgreement.id` → `HireAgreement.quotationId` → `Quotation.id`.

Three plugins and the CRM plugin take part. Requirements are grouped per plugin:

- Quotation plugin (app id `quotation`, `/docs/quotation`, HireAgreementPage): stable unique agreement ID, `quotationId` field, persistence.
- Planner plugin (app id `planner`, `/planner`, BookingFormDialog): Hire Agreement field, validation, persistence of the link.
- Fleet plugin (app id `fleet`, machine status, GatePassDialog): On Hire trigger via `appStore.setMachineStatus` and Gate OUT, machine-to-booking-to-agreement traceability.
- CRM plugin (app id `crm`): force-Won rule, history entry, idempotency, organisation check.

Existing facts that shape the requirements:

- `HireAgreement.agreementNo` is editable and not unique. `Quotation.hireAgreementNo` is a company-level shared string. Neither may be used to resolve a quotation.
- Hire agreements are currently in memory only, and every organisation seeds the same five agreements (ha-1 to ha-5).
- Bookings are persisted in `useBookingStore` (`fleet-bookings-v1`) and have no organisation ID. Editing a booking currently overwrites its `id` and `reference`.
- CRM allowed transitions have no Awaiting → Won or Tender → Won path, so a new rule is needed.
- Only `GatePassDialog` currently sets a machine to On Hire, via `appStore.setMachineStatus`. No code moves a booking to On Hire after save.
- The apps are independent. No app declares a dependency on another.

Out of scope: unifying the two booking sources (`bookingService` and `useBookingStore`) and the two machine status sources (appStore overrides and `machineService`). The design phase decides how the trigger copes with both.

## Glossary

- **Hire_Agreement**: A record in the Quotation plugin describing a hire contract for one organisation.
- **Hire_Agreement_ID**: The immutable, unique `HireAgreement.id` (for example `ha-1`). It is the only key used to resolve an agreement from a Planner_Allocation. It differs from `agreementNo`.
- **Agreement_No**: The human-readable, editable, non-unique `HireAgreement.agreementNo` (for example `HA-2026-001`). It is display data only.
- **Quotation_Id**: The `HireAgreement.quotationId` field, holding the `Quotation.id` of the Linked_Quotation.
- **Linked_Quotation**: The single CRM Quotation whose `id` equals the Hire_Agreement's Quotation_Id.
- **Planner_Allocation**: A booking record created or edited in the Fleet Planner that assigns a machine to a hire period. Stored in `useBookingStore`.
- **Planner_Plugin**: The app with id `planner`, including BookingFormDialog and the booking store.
- **Fleet_Plugin**: The app with id `fleet`, including `appStore.setMachineStatus` and GatePassDialog.
- **Quotation_Plugin**: The app with id `quotation`, including HireAgreementPage and the Hire_Agreement store.
- **CRM_Plugin**: The app with id `crm`, including `crmStore` and `crmRules`.
- **Hire_Link_Service**: The shared module that validates Hire_Agreement_IDs, resolves the Linked_Quotation, and performs the Won transition.
- **On_Hire_Event**: Either (a) saving a Planner_Allocation whose computed status is `On Hire`, or (b) `appStore.setMachineStatus` setting a machine to `On Hire`, including Gate OUT.
- **Active_Allocation**: The Planner_Allocation of a machine whose period contains the current date and whose status is not Cancelled or Completed. Used to resolve the booking for path (b).
- **Quotation_Phase**: The CRM phase of a Quotation: Awaiting, Tender, Won, or Lost.
- **Auto_Won_Transition**: The change of a Linked_Quotation's phase to Won caused by an On_Hire_Event.
- **Phase_History**: The list of phase-change entries stored on a Quotation.
- **Active_Org**: The organisation currently selected in `orgStore`.
- **App_Active**: The state in which `orgStore.isAppActive` returns true for an app id in the Active_Org.
- **Job_State**: Any state of the job linked to the quotation or booking. It is never an input to the Auto_Won_Transition.

## Requirements

### Requirement 1: Unique Hire Agreement identity (Quotation plugin)

**User Story:** As a hire controller, I want every Hire Agreement to have a stable unique ID, so that other plugins can reference it without ambiguity.

#### Acceptance Criteria

1. WHEN a Hire_Agreement is created, THE Quotation_Plugin SHALL assign it a Hire_Agreement_ID that is unique across all organisations.
2. WHEN a Hire_Agreement is edited, THE Quotation_Plugin SHALL keep its Hire_Agreement_ID unchanged.
3. WHEN a user edits the Agreement_No of a Hire_Agreement, THE Quotation_Plugin SHALL leave the Hire_Agreement_ID and all existing Planner_Allocation links unchanged.
4. THE Quotation_Plugin SHALL store the organisation ID on every Hire_Agreement.
5. WHEN the seed Hire_Agreements are loaded for an organisation, THE Quotation_Plugin SHALL give each seeded Hire_Agreement a Hire_Agreement_ID that does not collide with the seeded IDs of any other organisation.

### Requirement 2: Quotation link on the Hire Agreement form (Quotation plugin)

**User Story:** As a hire controller, I want to choose the CRM quotation a Hire Agreement belongs to, so that the agreement resolves to exactly one quotation.

#### Acceptance Criteria

1. THE Quotation_Plugin SHALL provide a Quotation dropdown on the Hire_Agreement form.
2. WHILE the Active_Org has App_Active for `crm`, THE Quotation_Plugin SHALL list in the dropdown only CRM quotations that belong to the company of the Hire_Agreement and to the Active_Org.
3. WHEN a user saves a Hire_Agreement with a selected quotation, THE Quotation_Plugin SHALL store the selected `Quotation.id` as the Quotation_Id of the Hire_Agreement.
4. WHEN a user saves a Hire_Agreement with no quotation selected, THE Quotation_Plugin SHALL save it with an empty Quotation_Id.
5. WHILE the Active_Org does not have App_Active for `crm`, THE Quotation_Plugin SHALL disable the Quotation dropdown and display a notice that the CRM app is inactive.
6. IF a selected quotation does not belong to the company of the Hire_Agreement, THEN THE Quotation_Plugin SHALL reject the save and display a validation error naming the mismatch.
7. WHEN a user changes the Quotation_Id of a Hire_Agreement that already has Planner_Allocations, THE Quotation_Plugin SHALL keep the existing allocations linked to the same Hire_Agreement_ID.

### Requirement 3: Hire Agreement persistence (Quotation plugin)

**User Story:** As a hire controller, I want Hire Agreements to survive a page refresh, so that planner links do not break.

#### Acceptance Criteria

1. THE Quotation_Plugin SHALL persist all Hire_Agreements, including Hire_Agreement_ID, Quotation_Id and organisation ID, in browser storage.
2. WHEN the application reloads, THE Quotation_Plugin SHALL restore the Hire_Agreements exactly as saved, including the Quotation_Id.
3. WHEN a persisted Hire_Agreement store from an earlier version without Quotation_Id is loaded, THE Quotation_Plugin SHALL load each agreement with an empty Quotation_Id and without data loss.
4. IF a user deletes a Hire_Agreement that is referenced by one or more Planner_Allocations, THEN THE Quotation_Plugin SHALL reject the deletion and list the referencing allocations.

### Requirement 4: Hire Agreement field on the booking form (Planner plugin)

**User Story:** As a planner, I want to enter or select the Hire Agreement when I create or assign a machine, so that the allocation is tied to a contract.

#### Acceptance Criteria

1. THE Planner_Plugin SHALL provide a Hire Agreement field on BookingFormDialog that accepts a typed Hire_Agreement_ID or a selection from a list.
2. THE Planner_Plugin SHALL populate the selection list with the Hire_Agreements of the Active_Org, showing the Agreement_No, company name and Hire_Agreement_ID of each entry.
3. WHEN a user selects an entry from the list, THE Planner_Plugin SHALL set the field value to that entry's Hire_Agreement_ID, not its Agreement_No.
4. WHERE a booking is created from a company context, THE Planner_Plugin SHALL list agreements of that company first.
5. WHEN a Planner_Allocation is saved, THE Planner_Plugin SHALL store the validated Hire_Agreement_ID as `hireAgreementId` on the allocation.
6. WHEN a user edits an existing Planner_Allocation, THE Planner_Plugin SHALL keep the allocation's `id` and `reference` unchanged.
7. WHEN a user edits an existing Planner_Allocation, THE Planner_Plugin SHALL pre-fill the Hire Agreement field with the stored `hireAgreementId`.
8. WHERE a booking is saved with an empty Hire Agreement field, THE Planner_Plugin SHALL save the allocation without a link and without triggering any Auto_Won_Transition.

### Requirement 5: Hire Agreement ID validation (Planner plugin)

**User Story:** As a planner, I want invalid agreement IDs rejected with a clear message, so that I never link a machine to the wrong contract.

#### Acceptance Criteria

1. WHEN a user saves a Planner_Allocation with a non-empty Hire Agreement value, THE Hire_Link_Service SHALL look up the value by Hire_Agreement_ID only.
2. IF the Hire Agreement value matches no Hire_Agreement_ID, THEN THE Planner_Plugin SHALL reject the save and display the error "Hire Agreement ID not found".
3. IF the Hire Agreement value matches an Agreement_No but no Hire_Agreement_ID, THEN THE Planner_Plugin SHALL reject the save and display the error "Hire Agreement ID not found".
4. IF the matched Hire_Agreement belongs to an organisation other than the Active_Org, THEN THE Planner_Plugin SHALL reject the save and display the error "Hire Agreement belongs to another organisation".
5. IF the matched Hire_Agreement has an empty Quotation_Id, THEN THE Planner_Plugin SHALL reject the save and display the error "Hire Agreement has no linked quotation".
6. WHILE the Active_Org has App_Active for `crm`, IF the Quotation_Id of the matched Hire_Agreement matches no CRM quotation in the Active_Org, THEN THE Planner_Plugin SHALL reject the save and display the error "Linked quotation not found".
7. WHILE the Active_Org does not have App_Active for `crm`, THE Planner_Plugin SHALL accept an agreement that passes criteria 2 to 4 and SHALL store the link.
8. WHEN the Hire Agreement value has leading or trailing whitespace, THE Planner_Plugin SHALL trim it before lookup.
9. WHEN validation fails, THE Planner_Plugin SHALL keep the dialog open and SHALL leave the booking store unchanged.

### Requirement 6: Planner allocation persistence and traceability (Planner plugin)

**User Story:** As an auditor, I want to trace any allocation to its agreement and quotation, so that I can explain why a quotation was marked Won.

#### Acceptance Criteria

1. THE Planner_Plugin SHALL persist `hireAgreementId` on every linked Planner_Allocation in the `fleet-bookings-v1` store.
2. WHEN the application reloads, THE Planner_Plugin SHALL restore each allocation with its `hireAgreementId` unchanged.
3. WHEN a persisted booking store from an earlier version without `hireAgreementId` is loaded, THE Planner_Plugin SHALL load each booking as unlinked and without data loss.
4. THE Planner_Plugin SHALL store the organisation ID on each Planner_Allocation created after this feature ships.
5. WHEN a user opens a linked Planner_Allocation, THE Planner_Plugin SHALL display the Agreement_No, the Hire_Agreement_ID, and the Linked_Quotation reference.
6. THE Hire_Link_Service SHALL expose a function that, given a Planner_Allocation ID, returns the Hire_Agreement and the Linked_Quotation, or a reason code when either is missing.
7. THE Hire_Link_Service SHALL expose a function that, given a Quotation ID, returns every Planner_Allocation linked to it through its Hire_Agreements.
8. FOR ALL linked Planner_Allocations, resolving allocation → agreement → quotation and then resolving the quotation back to its allocations SHALL include the original allocation (round-trip property).

### Requirement 7: On Hire from a saved booking (Planner plugin)

**User Story:** As a planner, I want a saved booking that is already On Hire to win its quotation, so that planning and CRM agree.

#### Acceptance Criteria

1. WHEN a Planner_Allocation with a valid `hireAgreementId` is saved and its computed status is `On Hire`, THE Planner_Plugin SHALL raise an On_Hire_Event for that allocation after the booking is persisted.
2. WHEN a Planner_Allocation is saved and its computed status is not `On Hire`, THE Planner_Plugin SHALL raise no On_Hire_Event.
3. WHEN an On_Hire_Event is raised, THE Hire_Link_Service SHALL resolve the Linked_Quotation using the allocation's `hireAgreementId` only.
4. IF the booking save succeeds and the Auto_Won_Transition fails or is skipped, THEN THE Planner_Plugin SHALL keep the saved booking and display the reason.

### Requirement 8: On Hire from machine status and Gate OUT (Fleet plugin)

**User Story:** As a fleet operator, I want Gate OUT to win the quotation of the machine's booking, so that dispatch updates sales without extra steps.

#### Acceptance Criteria

1. WHEN `appStore.setMachineStatus` sets a machine to `On Hire`, THE Fleet_Plugin SHALL raise an On_Hire_Event for that machine.
2. WHEN a user completes Gate OUT in GatePassDialog and the machine becomes `On Hire`, THE Fleet_Plugin SHALL raise an On_Hire_Event for that machine exactly once for that action.
3. WHEN an On_Hire_Event is raised for a machine, THE Hire_Link_Service SHALL resolve the Active_Allocation of that machine and use its `hireAgreementId`.
4. IF a machine has no Active_Allocation, THEN THE Fleet_Plugin SHALL complete the status change, skip the Auto_Won_Transition and display the notice "No active booking linked to this machine".
5. IF a machine has more than one Active_Allocation, THEN THE Hire_Link_Service SHALL select none, skip the Auto_Won_Transition and display the notice "Multiple active bookings; link cannot be resolved".
6. IF the Active_Allocation has no `hireAgreementId`, THEN THE Fleet_Plugin SHALL complete the status change, skip the Auto_Won_Transition and display the notice "Booking has no Hire Agreement".
7. WHEN `appStore.setMachineStatus` sets a machine to any status other than `On Hire`, THE Fleet_Plugin SHALL raise no On_Hire_Event and SHALL change no quotation.
8. IF a machine belongs to an organisation other than the Active_Org, THEN THE Hire_Link_Service SHALL skip the Auto_Won_Transition.
9. THE Fleet_Plugin SHALL complete the machine status change regardless of the outcome of the Auto_Won_Transition.

### Requirement 9: Automatic Won transition rule (CRM plugin)

**User Story:** As a sales manager, I want the quotation to become Won when the machine goes On Hire, so that the pipeline reflects reality.

#### Acceptance Criteria

1. WHEN an On_Hire_Event resolves a Linked_Quotation in phase Awaiting, THE CRM_Plugin SHALL change its phase to Won.
2. WHEN an On_Hire_Event resolves a Linked_Quotation in phase Tender, THE CRM_Plugin SHALL change its phase to Won.
3. WHEN the CRM_Plugin performs an Auto_Won_Transition, THE CRM_Plugin SHALL append one Phase_History entry with the previous phase, the new phase Won, the timestamp, and the reason "Auto: machine On Hire".
4. THE CRM_Plugin SHALL perform the Auto_Won_Transition without reading Job_State.
5. THE CRM_Plugin SHALL allow the Awaiting → Won and Tender → Won changes through a dedicated automatic action, leaving the manual transition rules in `crmRules` unchanged.
6. WHEN the CRM_Plugin performs an Auto_Won_Transition, THE CRM_Plugin SHALL apply the same side effects as a manual change to Won, including recording the win date where the manual path records it.
7. WHEN the Auto_Won_Transition completes, THE CRM_Plugin SHALL display a notice naming the quotation reference and the new phase.

### Requirement 10: Idempotency (CRM plugin)

**User Story:** As a sales manager, I want repeated On Hire updates to be harmless, so that history stays clean.

#### Acceptance Criteria

1. WHEN an On_Hire_Event resolves a Linked_Quotation already in phase Won, THE CRM_Plugin SHALL leave the quotation unchanged and add no Phase_History entry.
2. WHEN the same On_Hire_Event is raised N times in sequence for the same allocation, THE CRM_Plugin SHALL produce exactly one Auto_Won_Transition and one Phase_History entry.
3. WHEN both trigger paths (booking save and machine status) raise On_Hire_Events for the same allocation, THE CRM_Plugin SHALL produce exactly one Auto_Won_Transition.
4. FOR ALL sequences of On_Hire_Events on one Linked_Quotation, the final phase SHALL be Won and the count of automatic Phase_History entries SHALL be at most one (idempotence property).
5. WHEN a Linked_Quotation was manually moved to Won before the On_Hire_Event, THE CRM_Plugin SHALL add no Phase_History entry.

### Requirement 11: Lost quotations (CRM plugin)

**User Story:** As a sales manager, I want a Lost quotation to stay Lost, so that an operational event does not override a sales decision.

#### Acceptance Criteria

1. IF an On_Hire_Event resolves a Linked_Quotation in phase Lost, THEN THE CRM_Plugin SHALL leave the quotation unchanged and add no Phase_History entry.
2. IF an On_Hire_Event resolves a Linked_Quotation in phase Lost, THEN THE Hire_Link_Service SHALL display a warning naming the quotation reference and stating that it is Lost and was not changed.
3. IF an On_Hire_Event resolves a Linked_Quotation in phase Lost, THEN THE Fleet_Plugin SHALL still complete the machine status change.

### Requirement 12: No unrelated quotation updates

**User Story:** As a sales manager, I want only the correct quotation to change, so that other quotations of the same company are never affected.

#### Acceptance Criteria

1. WHEN an Auto_Won_Transition runs, THE Hire_Link_Service SHALL change at most one quotation, namely the one whose `id` equals the Quotation_Id of the Hire_Agreement.
2. THE Hire_Link_Service SHALL NOT resolve a quotation by `Quotation.hireAgreementNo`, Agreement_No, company, machine, or job.
3. WHEN several quotations of the same company exist, THE Hire_Link_Service SHALL leave every quotation other than the Linked_Quotation unchanged after an On_Hire_Event.
4. WHEN two Hire_Agreements share the same Agreement_No, THE Hire_Link_Service SHALL resolve each allocation to the quotation of its own Hire_Agreement_ID.
5. IF the Linked_Quotation belongs to an organisation other than the Active_Org, THEN THE Hire_Link_Service SHALL skip the Auto_Won_Transition and display the error "Linked quotation belongs to another organisation".
6. IF the Hire_Agreement referenced by an allocation no longer exists, THEN THE Hire_Link_Service SHALL skip the Auto_Won_Transition and display the notice "Hire Agreement not found".
7. IF the Quotation_Id references a quotation that no longer exists, THEN THE Hire_Link_Service SHALL skip the Auto_Won_Transition and display the notice "Linked quotation not found".
8. FOR ALL On_Hire_Events, the set of quotations whose phase or history changed SHALL be a subset of the singleton set containing the Linked_Quotation (metamorphic property).

### Requirement 13: Behaviour when apps are inactive

**User Story:** As an administrator, I want On Hire updates to keep working when CRM or Quotation is switched off, so that fleet operations are never blocked.

#### Acceptance Criteria

1. WHEN an On_Hire_Event is raised, THE Hire_Link_Service SHALL check App_Active for `crm` and `quotation` in the Active_Org before resolving any record.
2. IF the Active_Org lacks App_Active for `crm`, THEN THE Hire_Link_Service SHALL skip the Auto_Won_Transition, display the notice "CRM app is inactive; quotation not updated" and leave the CRM store unchanged.
3. IF the Active_Org lacks App_Active for `quotation`, THEN THE Hire_Link_Service SHALL skip the Auto_Won_Transition and display the notice "Quotation app is inactive; quotation not updated".
4. IF the Auto_Won_Transition is skipped for any reason, THEN THE Hire_Link_Service SHALL return a result that names the reason code.
5. IF the Hire_Link_Service throws an error, THEN THE Hire_Link_Service SHALL catch it, log it, display an error notice, and leave the On_Hire_Event's originating booking save or machine status change committed.
6. THE Hire_Link_Service SHALL import the stores of other plugins only through the Hire_Link_Service module, and no plugin SHALL declare a dependency on another in the app registry.
7. WHEN the CRM app is reactivated after being inactive, THE Hire_Link_Service SHALL NOT replay On_Hire_Events that were skipped.

### Requirement 14: Persistence across refresh

**User Story:** As a user, I want links and phase changes to survive a refresh, so that the data stays consistent.

#### Acceptance Criteria

1. WHEN the application reloads after an Auto_Won_Transition, THE CRM_Plugin SHALL show the Linked_Quotation in phase Won with its Phase_History entry.
2. WHEN the application reloads, THE Hire_Link_Service SHALL resolve each persisted Planner_Allocation to the same Hire_Agreement and Linked_Quotation as before the reload.
3. WHEN an On_Hire_Event is raised after a reload for a Linked_Quotation that is already Won, THE CRM_Plugin SHALL add no Phase_History entry.

### Requirement 15: Existing data and non-regression

**User Story:** As a maintainer, I want existing data and flows to keep working, so that the feature adds no regressions.

#### Acceptance Criteria

1. THE Hire_Link_Service SHALL leave manual phase changes in the CRM plugin and their rules in `crmRules` unchanged.
2. WHEN a Planner_Allocation without `hireAgreementId` exists, THE Hire_Link_Service SHALL treat it as unlinked and raise no error.
3. WHEN a Hire_Agreement without Quotation_Id exists, THE Hire_Link_Service SHALL treat it as unlinked and raise no error.
4. WHEN the Planner_Plugin saves a booking, THE Planner_Plugin SHALL generate the booking `id` and `reference` only on creation.
5. THE Hire_Link_Service SHALL return the same result for the same inputs and store state (deterministic behaviour).
