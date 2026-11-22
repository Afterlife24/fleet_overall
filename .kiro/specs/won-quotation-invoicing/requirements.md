# Requirements Document

## Introduction

This feature restricts invoice creation to quotations in the Won phase and links every new invoice to its source quotation. An invoice is created as either a Continuous Hire invoice (periodic billing, billing period end date entered by the user) or an Off-Hire invoice (final invoice, billing period end date taken from the hire end date). Hire start and end dates come from the Hire Agreement linked to the quotation, because quotations carry no hire dates. A quotation can have several invoices. Invoice numbers are the quotation number plus a two-digit sequence suffix (for example `QT-2026-0003/01`). Billing periods of one quotation are sequential and never overlap.

Dates, totals and VAT follow the existing invoice rules (VAT 5%, as in `recalc()` of the Invoice page). No new tax rates or charge types are introduced. Existing invoices without a quotation remain loadable and editable.

The feature touches the Invoice plugin (primary), the CRM plugin (Won tab, quotation detail), and the Hire Agreement data. The Planner and Fleet plugins are not changed.

## Glossary

- **Invoice_System**: The Invoice plugin (Invoice page, tax invoice service and tax invoice store) that creates, stores and edits tax invoices.
- **Invoice_Rules**: The pure rules module (`invoiceRulesCore`) that validates invoice requests and derives billing periods, numbers and totals. It has no store, React or toast dependencies.
- **Invoicing_Facade**: The module (`quotationInvoicing`) that reads the CRM, Hire Agreement, organisation and Invoice stores, builds a snapshot, and calls Invoice_Rules.
- **Invoice_Store**: The persisted store of tax invoices, per organisation.
- **CRM_UI**: The CRM page, including the Won tab and the quotation detail panel.
- **Quotation**: A CRM quotation (`Quotation`) with a `number`, a `phase` and an `orgId`.
- **Quotation_Number**: The `number` field of a Quotation, for example `QT-2026-0003`. This is the quotation identifier carried onto invoices.
- **Won_Quotation**: A Quotation whose phase is Won.
- **Source_Agreement**: The single Hire Agreement used to supply hire dates and charge details for a Quotation.
- **Hire_Start_Date**: The `hireStartDate` of the Source_Agreement.
- **Hire_End_Date**: The `hireEndDate` of the Source_Agreement.
- **Invoice_Type**: Either `Continuous Hire` or `Off-Hire`.
- **Continuous_Hire_Invoice**: An invoice of type `Continuous Hire`; the user enters the Billing_Period_End.
- **Off_Hire_Invoice**: An invoice of type `Off-Hire`; the final invoice of a Quotation, with Billing_Period_End equal to the Hire_End_Date.
- **Billing_Period**: The inclusive date range from Billing_Period_Start to Billing_Period_End covered by one invoice.
- **Billing_Period_Start**: The first day of a Billing_Period. For the first active invoice of a Quotation this is the Hire_Start_Date; otherwise the day after the Billing_Period_End of the latest active invoice of that Quotation.
- **Billing_Period_End**: The last day of a Billing_Period.
- **Active_Invoice**: An invoice whose status is not Cancelled.
- **Sequence_Number**: The per-quotation two-digit counter (01 to 99) used as the invoice number suffix. A Sequence_Number is never reused.
- **Legacy_Invoice**: An invoice stored without a quotation link.
- **Date_String**: A calendar date in `YYYY-MM-DD` format that represents a real calendar day.

## Requirements

### Requirement 1: Won-only invoice creation

**User Story:** As an accounts user, I want invoices to be creatable only from Won quotations, so that I never bill a customer for a deal that is not confirmed.

#### Acceptance Criteria

1. WHEN a user creates a new invoice in the Invoice page, THE Invoice_System SHALL require the user to select one Quotation from the list of Won_Quotations of the active organisation.
2. THE Invoice_System SHALL list only Quotations with phase Won and the active organisation's `orgId` as selectable quotations for a new invoice.
3. WHEN an invoice creation request references a Quotation whose phase is not Won, THE Invoice_System SHALL reject the request with the error code `NOT_WON` and store no invoice.
4. WHEN an invoice creation request references no Quotation, THE Invoice_System SHALL reject the request with the error code `QUOTATION_REQUIRED` and store no invoice.
5. WHEN an invoice creation request references a Quotation that does not exist in the active organisation, THE Invoice_System SHALL reject the request with the error code `QUOTATION_NOT_FOUND` and store no invoice.
6. IF the CRM app is inactive for the active organisation, THEN THE Invoice_System SHALL reject invoice creation with the error code `CRM_INACTIVE` and store no invoice.
7. THE Invoice_System SHALL apply requirements 1.3 to 1.6 in the tax invoice service, independent of the state of the Invoice page.
8. WHEN a request is rejected, THE Invoice_System SHALL show the user a message naming the reason.

### Requirement 2: Source hire agreement

**User Story:** As an accounts user, I want hire dates and charges to come from the hire agreement of the quotation, so that billing periods are checked against the agreed hire.

#### Acceptance Criteria

1. WHEN an invoice creation request references a Won_Quotation, THE Invoicing_Facade SHALL resolve the Source_Agreement from Hire Agreements of the active organisation whose `quotationId` equals the Quotation `id` and whose status is not Cancelled.
2. IF no Hire Agreement resolves for the Quotation, THEN THE Invoice_System SHALL reject the request with the error code `NO_AGREEMENT` and the message "No hire agreement is linked to this quotation".
3. IF more than one Hire Agreement resolves for the Quotation, THEN THE Invoice_System SHALL reject the request with the error code `AMBIGUOUS_AGREEMENT` and list the agreement numbers in the message.
4. IF the Source_Agreement has a Hire_Start_Date or Hire_End_Date that is not a Date_String, or a Hire_End_Date earlier than the Hire_Start_Date, THEN THE Invoice_System SHALL reject the request with the error code `AGREEMENT_DATES_INVALID`.
5. WHILE the Invoice page form shows a selected Won_Quotation, THE Invoice_System SHALL display the Source_Agreement number, the Hire_Start_Date and the Hire_End_Date as read-only values.
6. WHEN a user opens the Invoice page from the CRM_UI action "Proceed to invoicing", THE Invoice_System SHALL preselect the Quotation passed by the CRM_UI.

### Requirement 3: Invoice numbering

**User Story:** As an accounts user, I want the invoice number to be built from the quotation number, so that every invoice can be traced to its quotation.

#### Acceptance Criteria

1. WHEN an invoice is created from a Quotation, THE Invoice_System SHALL set the invoice number to the Quotation_Number, a slash, and the two-digit Sequence_Number (for example `QT-2026-0003/01`).
2. WHEN the first invoice is created for a Quotation, THE Invoice_System SHALL assign the Sequence_Number 01.
3. WHEN a further invoice is created for a Quotation, THE Invoice_System SHALL assign a Sequence_Number one greater than the highest Sequence_Number ever assigned to that Quotation, including Sequence_Numbers of deleted or Cancelled invoices.
4. IF the highest assigned Sequence_Number of a Quotation is 99, THEN THE Invoice_System SHALL reject a new invoice with the error code `SEQUENCE_EXHAUSTED`.
5. THE Invoice_System SHALL display the invoice number as read-only on invoices linked to a Quotation.
6. THE Invoice_System SHALL store the Quotation `id`, the Quotation_Number and the Sequence_Number on each invoice created from a Quotation.

### Requirement 4: Continuous Hire invoices

**User Story:** As an accounts user, I want to invoice a long hire period by period, so that I can bill a six-month hire monthly.

#### Acceptance Criteria

1. WHEN a user creates an invoice, THE Invoice_System SHALL require the user to choose the Invoice_Type, either `Continuous Hire` or `Off-Hire`.
2. WHEN the Invoice_Type is `Continuous Hire`, THE Invoice_System SHALL require the user to enter the Billing_Period_End as a Date_String.
3. IF the Invoice_Type is `Continuous Hire` and the Billing_Period_End is missing, THEN THE Invoice_System SHALL reject the request with the error code `END_DATE_REQUIRED`.
4. IF the Invoice_Type is `Continuous Hire` and the Billing_Period_End is not a Date_String, THEN THE Invoice_System SHALL reject the request with the error code `INVALID_DATE`.
5. IF the Invoice_Type is `Continuous Hire` and the Billing_Period_End is earlier than the Billing_Period_Start, THEN THE Invoice_System SHALL reject the request with the error code `END_BEFORE_START`.
6. IF the Invoice_Type is `Continuous Hire` and the Billing_Period_End is later than the Hire_End_Date, THEN THE Invoice_System SHALL reject the request with the error code `END_AFTER_HIRE_END`.
7. WHEN a Continuous_Hire_Invoice is created, THE Invoice_System SHALL store the entered Billing_Period_End as the invoice Billing_Period_End.
8. WHEN the Invoice_Type is `Continuous Hire` and a Source_Agreement resolves, THE Invoice_System SHALL display the computed Billing_Period_Start as a read-only value next to the Billing_Period_End input.
9. IF the Invoice_Type is not `Continuous Hire` or `Off-Hire`, THEN THE Invoice_System SHALL reject the request with the error code `INVALID_TYPE`.

### Requirement 5: Off-Hire invoices

**User Story:** As an accounts user, I want an Off-Hire invoice to close the hire using the agreed end date, so that I do not re-enter the end date.

#### Acceptance Criteria

1. WHEN the Invoice_Type is `Off-Hire`, THE Invoice_System SHALL set the Billing_Period_End to the Hire_End_Date of the Source_Agreement.
2. WHILE the Invoice_Type is `Off-Hire`, THE Invoice_System SHALL display the Billing_Period_End as a read-only value and offer no input for it.
3. IF an Off-Hire request carries a Billing_Period_End different from the Hire_End_Date, THEN THE Invoice_System SHALL reject the request with the error code `END_DATE_NOT_ALLOWED`.
4. IF the Billing_Period_End of the latest Active_Invoice of the Quotation is equal to or later than the Hire_End_Date, THEN THE Invoice_System SHALL reject an Off-Hire request with the error code `NOTHING_TO_BILL` and the message "The hire period is already fully invoiced".
5. WHEN an Off_Hire_Invoice is created for a Quotation, THE Invoice_System SHALL treat the Quotation as fully invoiced.
6. IF an Active_Invoice of type `Off-Hire` exists for the Quotation, THEN THE Invoice_System SHALL reject any further invoice request for that Quotation with the error code `ALREADY_OFF_HIRED`.
7. WHEN an Off_Hire_Invoice is Cancelled or deleted, THE Invoice_System SHALL accept new invoice requests for that Quotation again.

### Requirement 6: Sequential billing periods

**User Story:** As an accounts user, I want billing periods to be sequential and non-overlapping, so that no hire day is billed twice or skipped.

#### Acceptance Criteria

1. WHEN the Quotation has no Active_Invoice, THE Invoice_System SHALL set the Billing_Period_Start to the Hire_Start_Date.
2. WHEN the Quotation has at least one Active_Invoice, THE Invoice_System SHALL set the Billing_Period_Start to the day after the Billing_Period_End of the Active_Invoice with the latest Billing_Period_End.
3. IF a request carries a Billing_Period_Start earlier than the computed Billing_Period_Start, THEN THE Invoice_System SHALL reject the request with the error code `OVERLAP`.
4. IF a request carries a Billing_Period_Start later than the computed Billing_Period_Start, THEN THE Invoice_System SHALL reject the request with the error code `GAP`.
5. IF a request carries a Billing_Period identical to the Billing_Period of an Active_Invoice of the same Quotation, THEN THE Invoice_System SHALL reject the request with the error code `DUPLICATE_PERIOD`.
6. THE Invoice_System SHALL ensure that the Billing_Periods of the Active_Invoices of one Quotation do not overlap and lie within the Hire_Start_Date and Hire_End_Date.
7. WHEN an invoice is Cancelled, THE Invoice_System SHALL exclude the Billing_Period of that invoice from the Active_Invoice checks.
8. WHEN two creation requests for the same Quotation are processed one after the other, THE Invoice_System SHALL validate the second request against the state that includes the first invoice.

### Requirement 7: Carry-over of details

**User Story:** As an accounts user, I want customer, fleet, hire and charge details carried over automatically, so that I do not retype agreed data.

#### Acceptance Criteria

1. WHEN an invoice is created from a Quotation, THE Invoice_System SHALL copy the customer id, customer name, customer TRN, attention, contact number, customer email and billing address from the Source_Agreement to the invoice.
2. WHEN an invoice is created from a Quotation, THE Invoice_System SHALL copy the Source_Agreement number, delivery location, payment terms, payment method and security deposit to the invoice.
3. WHEN an invoice is created from a Quotation, THE Invoice_System SHALL build the equipment description from the Source_Agreement equipment model, equipment name, serial number, working height and capacity, using the same text format as the existing agreement pick.
4. WHEN an invoice is created from a Quotation, THE Invoice_System SHALL set the equipment quantity to 1, the equipment rate to the Source_Agreement monthly rental, the transportation quantity to 1 and the transportation rate to the Source_Agreement transportation charges.
5. WHEN an invoice is created from a Quotation, THE Invoice_System SHALL store the Billing_Period_Start, the Billing_Period_End, the Invoice_Type and the Source_Agreement id on the invoice.
6. WHEN an invoice is created from a Quotation, THE Invoice_System SHALL set the hire period text to the Billing_Period in the form "Billing_Period_Start – Billing_Period_End".
7. WHEN an invoice is created from a Quotation, THE Invoice_System SHALL set the invoice date to the current local date, the due date to the invoice date plus the payment terms in days (30 days when the payment terms hold no number), and the status to Draft.
8. WHERE the user edits equipment or transportation quantity and rate on the form before saving, THE Invoice_System SHALL apply the edited values to the saved invoice.
9. WHEN the Invoice_System stores an invoice, THE Invoice_System SHALL set the orgId of the invoice to the active organisation.

### Requirement 8: Totals and tax

**User Story:** As a finance controller, I want totals and tax calculated with the existing rules, so that new invoices stay consistent with current invoices.

#### Acceptance Criteria

1. THE Invoice_Rules SHALL calculate equipment amount as equipment quantity multiplied by equipment rate, and transportation amount as transportation quantity multiplied by transportation rate.
2. THE Invoice_Rules SHALL calculate subtotal as the sum of the equipment amount and the transportation amount.
3. THE Invoice_Rules SHALL calculate VAT as 5% of the subtotal, rounded to two decimal places.
4. THE Invoice_Rules SHALL calculate the total amount as subtotal plus VAT, rounded to two decimal places, and set the amount due equal to the total amount.
5. WHEN the Invoice_System stores or updates an invoice, THE Invoice_System SHALL recompute equipment amount, transportation amount, subtotal, VAT, total amount and amount due from the stored quantities and rates, and ignore client-supplied values for those fields.
6. THE Invoice page SHALL calculate form totals with the same Invoice_Rules function used by the tax invoice service.

### Requirement 9: Legacy invoices and persistence

**User Story:** As an accounts user, I want existing invoices to keep working, so that no historic data is lost.

#### Acceptance Criteria

1. THE Invoice_Store SHALL persist invoices of all organisations in browser storage and restore them on page load.
2. WHEN the Invoice_Store loads persisted data of an older version or malformed data, THE Invoice_Store SHALL migrate rows by filling missing fields with defaults and SHALL reset to an empty list when the data is not an array of rows.
3. WHEN the Invoice_Store holds no rows for an organisation that was not seeded, THE Invoice_Store SHALL insert the existing demo invoices for that organisation once.
4. THE Invoice_System SHALL load, list and open Legacy_Invoices that carry no quotation id, Invoice_Type, Billing_Period or Sequence_Number.
5. WHEN a user edits and saves a Legacy_Invoice, THE Invoice_System SHALL accept the update without applying the Won rule, the numbering rule or the Billing_Period rules.
6. WHEN a user edits an invoice that is linked to a Quotation, THE Invoice_System SHALL keep the quotation id, Quotation_Number, invoice number, Sequence_Number, Invoice_Type, Billing_Period_Start, Billing_Period_End and Source_Agreement id unchanged.
7. WHEN a user edits an invoice that is linked to a Quotation, THE Invoice_System SHALL allow changes to status, dates other than the Billing_Period, quantities, rates, payment fields and notes.
8. IF an update request for a linked invoice changes a field named in requirement 9.6, THEN THE Invoice_System SHALL reject the update with the error code `IMMUTABLE_FIELD`.
9. WHEN the existing agreement pick is used on a Legacy_Invoice form, THE Invoice_System SHALL fill the form fields as it does today.

### Requirement 10: Invoice visibility in CRM

**User Story:** As a sales user, I want to see the invoices raised for a quotation, so that I can follow the billing status from CRM.

#### Acceptance Criteria

1. WHEN a user selects "Proceed to invoicing" on a Won quotation in the CRM_UI, THE CRM_UI SHALL navigate to the Invoice page with a prefill holding the Quotation id, Quotation_Number, customer id, customer name and amount.
2. WHEN the quotation detail panel of the CRM_UI opens a Quotation, THE CRM_UI SHALL list the invoices linked to that Quotation, each with invoice number, Invoice_Type, Billing_Period, total amount and status.
3. IF a Quotation has no linked invoice, THEN THE CRM_UI SHALL show the text "No invoices yet" in the invoice list of the quotation detail panel.
4. WHEN an invoice is created, Cancelled or deleted, THE CRM_UI SHALL show the updated invoice list without a page reload.
5. THE Invoice page list SHALL show the Quotation_Number, Invoice_Type and Billing_Period of linked invoices, and show an empty value for Legacy_Invoices.
6. WHEN a user selects the Quotation_Number of a linked invoice in the Invoice page list, THE Invoice_System SHALL open the Invoice page filtered to the invoices of that Quotation.

### Requirement 11: Delete and cancel control

**User Story:** As an accounts user, I want deletions and cancellations of linked invoices controlled, so that the billing sequence stays gap-free.

#### Acceptance Criteria

1. WHEN a user deletes or cancels an invoice linked to a Quotation, THE Invoice_System SHALL accept the request only IF the invoice is the Active_Invoice with the latest Billing_Period_End of that Quotation.
2. IF a delete or cancel request targets a linked invoice that is not the latest Active_Invoice of its Quotation, THEN THE Invoice_System SHALL reject the request with the error code `NOT_LATEST_INVOICE`.
3. WHEN a linked invoice is deleted, THE Invoice_System SHALL keep the highest assigned Sequence_Number of its Quotation unchanged.
4. WHEN a Legacy_Invoice is deleted, THE Invoice_System SHALL remove the invoice without further checks.

### Requirement 12: Demo data

**User Story:** As a demo presenter, I want sample data that shows the feature, so that I can demonstrate Won-only invoicing.

#### Acceptance Criteria

1. THE Invoice_System SHALL seed, for Johnson Arabia, one Continuous_Hire_Invoice for the Won demo quotation `qt-seed-10` (Quotation_Number `QT-2026-0010`) with Sequence_Number 01, Billing_Period_Start equal to the Hire_Start_Date of its Source_Agreement, and a Billing_Period_End within the hire period.
2. WHEN another organisation receives the demo CRM data, THE Invoice_System SHALL seed the same sample invoice for that organisation's copy of the quotation, using the organisation-specific quotation id.
3. THE Invoice_System SHALL seed the sample invoice once per organisation and SHALL NOT add the sample again after the user deletes the sample.
4. THE demo seed SHALL record a Sequence_Number of 1 for `qt-seed-10` so that the next invoice for that Quotation receives the suffix 02.
5. THE demo seed SHALL keep demo Hire Agreement dates unchanged and use them as the hire dates of the demo quotations.

### Requirement 13: Plugin boundaries

**User Story:** As a maintainer, I want cross-plugin access to go through one module, so that plugin boundaries stay intact.

#### Acceptance Criteria

1. THE Invoice_Rules SHALL import only types and SHALL NOT import stores, React, toast helpers or services.
2. THE Invoicing_Facade SHALL NOT import `services.ts` or `appStore.ts`.
3. THE Invoice page, the Invoice_Store and the tax invoice service SHALL read CRM and Hire Agreement data only through the Invoicing_Facade.
4. THE CRM_UI SHALL read invoice data only through the Invoicing_Facade.
5. THE files under `src/features/documents` SHALL NOT import `crmStore`.
6. THE Invoice_System SHALL keep the app dependency list in `constants/apps.ts` unchanged.
