# Requirements Document

## Introduction

This feature closes the remaining gaps between the apps (plugins) of the equipment-rental project so that one rental can be followed from customer to quotation, hire agreement, planner booking, fleet machine, invoice, collection note, MQD, Third-Party Services document, transport job and gate entry. It covers six user tasks:

1. Transport Job creation that produces a visible, persisted job.
2. A four-column CRM pipeline board (Awaiting, Tender, Lost, Won) with a right-side Status panel.
3. Linked demo data across Customers, CRM, hire agreements, planner, fleet, invoices and documents.
4. A QR code and downloadable Gate Pass PDF for every gate pass (Gate IN and Gate OUT).
5. Per-company, idempotent demo data for every app used by the assignment PDF.
6. A traceability check of PDF workstreams 1 to 6, with automated end-to-end tests and fixes for every gap found.

### Findings from the code investigation (current state)

- **Transport (task 1):** `TransportJobDialog` posts the REF-13 form fields (`fleet`, `from`, `to`, `transport`, `type`, and others) to `transportService.create`. That service pushes the object onto an in-memory per-company array without the fields the page reads (`destination`, `origin`, `assetNumber`, `machineModel`, `distance`, `scheduledTime`, `truckRegistration`). `TransportPage` shows only the first 8 jobs (`slice(0, 8)`), so a new job appended at the end is not visible, and `job.destination.split('-')` throws for a job without `destination`. Jobs are lost on refresh. Collection-generated jobs are written to `useAppStore.transportJobs`, which no transport screen reads.
- **CRM (task 2):** `PipelineBoard` renders only the columns Awaiting and Tender, and each card has per-card move buttons. `crmRules.ALLOWED` permits Awaiting→Tender, Awaiting→Lost, Tender→Won, Tender→Lost and Lost→Awaiting (Reopen with reason). Awaiting→Won, Tender→Awaiting, Lost→Tender and Lost→Won are not allowed. Lost and Won reasons: Lost requires a reason, Reopen requires a reason.
- **Customers (task 3):** Three unrelated customer sources exist. The Johnson Arabia customers (`cu-1..cu-10`, such as Arabtec Construction LLC) in `johnsonArabiaDemo.json`; the Customer ANI set (`CUST-000125..532`, ABC/DEF/GHI/JKL/MNO Company) in `customerani.ts`; and quotation customers (`CUS-0005`-style ids, names such as "ABC Company", "CK Groups", "Administrator", "Damac Properties") in `quotations.ts`. Demo bookings use `cu-1..cu-5` with ABC/DEF/GHI/JKL/MNO names, which do not match the `cu-N` customers. Names differ between sources ("ABC Company" and "ABC Company LLC").
- **Gate (task 4):** The "Print Gate Pass" button in `GatePage` has no handler. `GatePassDialog` builds the reference as `GP-` plus the last four digits of `Date.now()`, which can collide. `GateEntry.qrPayload` stores only a scanned payload. The `qrcode` and `jspdf` packages are already installed.
- **Demo data (task 5):** `ensureHireLinkDemo` seeds quotations, agreements, bookings, machines, invoice, collection documents and gate records for non-JA companies only when `crm`, `planner`, `quotation` or `gate` is active. Customers, transport jobs, drivers and trucks are empty for signed-up companies.
- **Hire documents (workstream 2):** The Delivery Note app (`/docs/delivery-note`) renders the generic placeholder `DocumentAppPage` with an empty state. No Delivery Note generator, no hire-phase MQD or Third-Party Services generator, no status values "Not Generated / Generated / Signed Copy Uploaded" and no upload validation exist. MQD and Third-Party Services documents exist only inside the off-hire Collection Note flow.

## Glossary

- **Company**: A tenant identified by `orgId`. The built-in demo company is `org-ja`. Any other Company is created by sign-up and starts empty.
- **App**: A plugin defined in `src/constants/apps.ts` and activated per Company through `useOrgStore.isAppActive`.
- **Transport_App**: The Transport Dispatch page and its Transport Job creation dialog.
- **Transport_Job**: A dispatch record with reference, type, fleet number, origin, destination, scheduled time, status, driver and truck.
- **Transport_Service**: The service layer that creates, lists and updates Transport_Jobs.
- **CRM_App**: The CRM page with the tabs Pipeline, List, Lost and Won.
- **Pipeline_Board**: The kanban board on the Pipeline tab.
- **Status_Panel**: The right-side panel opened by clicking a quotation card on the Pipeline_Board.
- **Quotation**: A CRM record with phase Awaiting, Tender, Lost or Won, identified by `id` and `number` (for example QT-2026-0010).
- **Phase_Rules**: The functions in `crmRules.ts` (`ALLOWED`, `isAllowed`, `applyTransition`, `applyAutoWon`) that govern phase changes.
- **Reopen**: The Lost→Awaiting transition, which requires a non-blank reason.
- **Customer_Registry**: The single source of Customer records of a Company that the Customers App, CRM, Planner, Hire Agreement, Invoice and document Apps read.
- **Customer**: A record with a stable `customerId` and a canonical `name` in the Customer_Registry.
- **Hire_Agreement**: A record with unique agreement number linked to one Quotation and to planner bookings.
- **Planner_Booking**: A Fleet Planner allocation of a machine to a customer for a date range.
- **Fleet_Machine**: A machine of the Fleet App with `id` and `fleetNo`.
- **Invoice**: A tax invoice linked to a Won Quotation, numbered from the Quotation number.
- **Collection_Note**: The off-hire document with number CN-…, linked to Quotation, Invoice, Customer and Fleet_Machine.
- **MQD**: The Machine Quality Document, as named in the app.
- **TPS**: The Third-Party Services document.
- **Hire_Document**: A Delivery Note, MQD or TPS document generated during the hire phase of a Quotation. Its number uses the prefix `DN-` (Delivery Note), `HMQD-` (MQD) or `HTPS-` (TPS).
- **Document_Status**: One of Not Generated, Generated, Signed Copy Uploaded.
- **Signed_Copy**: The uploaded scan of a signed document, stored in IndexedDB through `signedFiles`.
- **Gate_App**: The Gate Operations page, the Gate Pass dialog and the gate store.
- **Gate_Pass**: A gate entry record with reference, direction IN or OUT, and fleet number.
- **Gate_QR_Payload**: The text `AXLEOPS-GATE:<orgId>:<gateEntryId>:<reference>`.
- **Gate_Pass_PDF**: A one-document PDF of a Gate_Pass that includes the QR image.
- **Demo_Seeder**: The module `src/services/demoSeed.ts` and the mock data builders it calls.
- **Traceability_Matrix**: The document `.kiro/specs/rental-flow-integration/traceability.md` that maps every acceptance criterion of PDF workstreams 1 to 6 to implementing code and to an automated test.
- **Verification_Suite**: The automated end-to-end tests in `src/services/__tests__/e2e/` that exercise the full rental flow against the stores and services without a browser backend.
- **Quality_Gate**: The commands `tsc -b`, `vitest --run` and `eslint`.

## Requirements

### Requirement 1: Create a Transport Job that is stored and viewable (Task 1)

**User Story:** As a transport planner, I want a new Transport Job to appear in the Transport app as soon as I create it, so that I can open and manage it.

#### Acceptance Criteria

1. WHEN the planner submits the Transport Job form with all required fields valid, THE Transport_Service SHALL create one Transport_Job with a unique id, status Scheduled, and the Company's `orgId`. The required fields are Planner Name, Date, Shift (Morning or Evening), Transport Team, Sr. No (integer from 1 to 9999), Fleet, From, To, Transport, Type (D, T, O or T2), Contact, Sales (one of BG, AD, CH, AM, SM, SK, TD, SH, MT, TS), Client and Time. Remarks is optional.
2. WHEN the Transport_Service creates a Transport_Job, THE Transport_Service SHALL assign a reference in the format `TJ-<year>-<4 digits>`. `<year>` is the four-digit calendar year of the creation date. The 4 digits are a zero-padded sequence that starts at 0001 for each Company and year and increases by 1 for each new job. A reference is never reused within the same Company.
3. WHEN the Transport_Service creates a Transport_Job, THE Transport_Service SHALL derive the fields read by the Transport_App from the submitted form fields so that every list and detail view renders without error. The mapping is `from` to `origin`, `to` to `destination`, `fleet` to `assetNumber`, `time` and `date` to `scheduledTime`, `transport` to `truckRegistration`, and `type` to `type`. `machineModel` comes from the Fleet_Machine whose fleet number equals `fleet`. `distance` is empty when no distance is available.
4. WHEN a Transport_Job is created, THE Transport_App SHALL show the new Transport_Job at the top of the Dispatch Board, ahead of every older job, and SHALL show a success message. The Dispatch Board SHALL be ordered by creation time, newest first, and SHALL NOT truncate the list to a fixed number of jobs.
5. WHEN the planner clicks a Transport_Job in the Dispatch Board, THE Transport_App SHALL open the job detail panel showing all 15 REF-13 form fields as entered, with Remarks shown as empty when none was entered.
6. THE Transport_Service SHALL store Transport_Jobs of each Company in persisted storage so that every created job remains listed with unchanged field values after a browser refresh.
7. THE Transport_App SHALL list jobs created by the Collection_Note flow (autoGenerated) together with jobs created in the Transport Job form. Each job SHALL have a reference in the format defined in criterion 2.
8. WHEN a Transport_Job is created or its status changes, THE Transport_App SHALL update the Active, Scheduled, Completed, Deliveries and Collections counters to match the stored jobs before the next screen render.
9. IF a required form field is empty or invalid, THEN THE Transport_App SHALL display a field-level message next to each such field, SHALL NOT create a Transport_Job, and SHALL keep the entered values in the form.
10. IF the Transport_Service fails to store a Transport_Job, THEN THE Transport_App SHALL display an error message, SHALL keep the form open with the entered values, and SHALL leave the stored Transport_Jobs unchanged.
11. WHEN the planner clicks Create Transport Job, THE Transport_App SHALL disable the submit button until the creation succeeds or fails, so that one click creates exactly one job.
12. WHILE a Company other than the creating Company is signed in, THE Transport_Service SHALL return none of the Transport_Jobs of the creating Company.
13. WHEN a Transport_Job is created for a fleet number that belongs to a Fleet_Machine, THE Transport_Service SHALL store the machine id on the Transport_Job.
14. WHEN a Transport_Job status changes in the job detail panel, THE Transport_Service SHALL persist the new status, and the Kanban and Job Tracking pages SHALL show the new status.

### Requirement 2: Four-column CRM Pipeline Board (Task 2)

**User Story:** As a sales user, I want the Pipeline tab to show the columns Awaiting, Tender, Lost and Won, so that I can see every quotation by status on one board.

#### Acceptance Criteria

1. THE Pipeline_Board SHALL render exactly four columns, ordered left to right as Awaiting, Tender, Lost, Won.
2. THE Pipeline_Board SHALL show in each column header the phase name, the count of Quotations whose phase equals the column name, and the sum of their amounts in AED formatted with thousands separators and no decimals.
3. THE Pipeline_Board SHALL show on each quotation card the Quotation number, the opportunity, the customer name, the hire agreement number and the amount in AED.
4. IF a Quotation has no Hire_Agreement, THEN THE Pipeline_Board SHALL show "—" in place of the hire agreement number on its card.
5. IF a column has no Quotations, THEN THE Pipeline_Board SHALL show the count 0, the amount AED 0 and an empty-state text in that column, and SHALL keep the column visible.
6. THE CRM_App SHALL keep the Lost tab and the Won tab, and each tab SHALL list the same Quotations as the Lost column and the Won column of the Pipeline_Board respectively.
7. THE CRM_App SHALL calculate the Active pipeline KPI as the sum of amounts of Awaiting and Tender Quotations only, in AED.
8. THE Pipeline_Board SHALL NOT display per-card move buttons.
9. WHEN the user clicks a quotation card, THE CRM_App SHALL open the Status_Panel on the right side showing the Quotation number, opportunity, customer, hire agreement number, amount in AED, current phase and phase history.
10. WHEN the user clicks a different quotation card while the Status_Panel is open, THE CRM_App SHALL replace the Status_Panel content with the clicked Quotation and SHALL keep one Status_Panel open.
11. WHEN the user closes the Status_Panel, THE CRM_App SHALL hide the Status_Panel and keep all four columns visible.

### Requirement 3: Change the status in the Status Panel (Task 2)

**User Story:** As a sales user, I want to choose a status in the right-side panel and click Save, so that the quotation moves to the matching column.

#### Acceptance Criteria

1. THE Status_Panel SHALL contain a Status selector with the options Awaiting, Tender, Lost and Won and a Save button.
2. WHEN the Status_Panel opens, THE Status_Panel SHALL preselect the current phase of the quotation and SHALL disable the Save button until a status different from the current phase is selected.
3. WHILE a status option is not allowed by Phase_Rules from the current phase, THE Status_Panel SHALL show that option disabled with the Phase_Rules error text (for example "Cannot move quotation from Awaiting to Won").
4. WHEN the user selects an allowed status other than Lost and clicks Save, THE CRM_App SHALL run the Phase_Rules transition, SHALL append one phase history entry containing the previous phase, new phase, user and timestamp, and SHALL show the card in the column of the new phase within the same render cycle.
5. WHEN the user selects Lost and clicks Save, THE Status_Panel SHALL require a reason of 1 to 500 characters that is not blank after trimming before the transition runs, and THE CRM_App SHALL store the reason, date and user on the quotation.
6. WHEN the current phase is Lost and the user selects Awaiting and clicks Save, THE Status_Panel SHALL require a Reopen reason of 1 to 500 characters that is not blank after trimming before the transition runs, and THE Phase_Rules SHALL record the reason in the phase history.
7. IF the user clicks Save for Lost or Reopen with a blank reason, THEN THE Status_Panel SHALL show a field-level message, SHALL keep the quotation phase unchanged and SHALL create no phase history entry.
8. WHILE the current phase is Won, THE Status_Panel SHALL show every option other than Won disabled, because Phase_Rules define no transition out of Won.
9. THE Phase_Rules SHALL keep Awaiting→Won, Tender→Awaiting, Lost→Tender and Lost→Won disallowed, so that Won is reachable from Awaiting only through Tender or through the automatic On Hire rule.
10. IF the Phase_Rules reject a transition, THEN THE CRM_App SHALL show the Phase_Rules error message, SHALL keep the quotation phase unchanged, SHALL create no phase history entry and SHALL keep the Status_Panel open with the selected status and entered reason.
11. WHEN a transition succeeds, THE CRM_App SHALL keep the Status_Panel open showing the new phase as the preselected status and the new history entry, SHALL disable the Save button, and SHALL show a success message.
12. THE CRM_App SHALL persist every phase, reason and history entry so that, after a browser refresh, the board shows each quotation in the same column with the same history.
13. THE Pipeline_Board SHALL keep drag and drop between columns, and WHEN a card is dropped, THE CRM_App SHALL apply the same Phase_Rules transition, reason prompts and rejection behavior as the Status_Panel.
14. WHEN the user clicks Save on a quotation of Company A, THE CRM_App SHALL change no quotation of any other Company.

### Requirement 4: One Customer_Registry linked to all apps (Task 3)

**User Story:** As a sales user, I want customers to be the same records in Customers, CRM, hire agreements, planner and invoices, so that I can follow one customer across the rental flow.

#### Acceptance Criteria

1. THE Customer_Registry SHALL provide one Customer per canonical name for each Company, and each Customer SHALL have a `customerId` that does not change after creation.
2. THE Customer_Registry demo set SHALL contain exactly these canonical names, each spelled identically in every App: "ABC Company LLC", "DEF Company LLC", "GHI Company PJSC", "JKL Company LLC", "MNO Company LLC", "CK Groups", "Damac Properties", "Arabtec Construction LLC" and "Administrator".
3. THE Demo_Seeder SHALL replace the non-canonical demo spellings "ABC Company" and "Arabtec Contracting" with "ABC Company LLC" and "Arabtec Construction LLC" in every demo record.
4. THE Demo_Seeder SHALL NOT rename or change the `customerId` of any Customer or Quotation that a user created.
5. WHEN a Quotation is displayed or created, THE CRM_App SHALL resolve `customerId` and `customerName` from the Customer_Registry of the Company.
6. THE Demo_Seeder SHALL give every demo Quotation, Hire_Agreement, Planner_Booking, Invoice, Collection_Note, MQD and TPS the same `customerId` and `customerName` as its Customer in the Customer_Registry.
7. THE Customers App SHALL list every Customer referenced by a demo Quotation, and each Customer detail SHALL list that Customer's Quotations, Hire_Agreements and Invoices.
8. WHEN a user creates a Quotation for a customer name that matches no Customer in the Customer_Registry, THE CRM_App SHALL create one Customer with that name and SHALL link the Quotation to it.
9. IF the customer name of a new Quotation matches an existing Customer after ignoring letter case, the legal suffixes LLC and PJSC, and leading and trailing spaces, THEN THE CRM_App SHALL link the Quotation to the existing Customer and SHALL NOT create a duplicate Customer.
10. THE Demo_Seeder SHALL link each rental chain from Customer to Quotation, Hire_Agreement, Planner_Booking, Fleet_Machine, Invoice, Collection_Note, MQD, TPS, Transport_Job and Gate_Pass through ids that resolve to existing records of the same Company.
11. FOR ALL demo records of a Company that hold a reference id to another record, THE Demo_Seeder SHALL ensure the referenced record exists in the same Company (referential integrity property).
12. THE Customer_Registry SHALL use the same `customerId` and canonical name as the Customer ANI demo set for ABC, DEF, GHI, JKL and MNO (`CUST-000125`, `CUST-000248`, `CUST-000371`, `CUST-000419`, `CUST-000532`).
13. WHERE the Customers App is not active for a Company, THE CRM_App SHALL still resolve customers from the Customer_Registry.

### Requirement 5: Gate Pass QR code for entry and exit (Task 4)

**User Story:** As a gate operator, I want every gate pass to have a QR code, so that the pass can be printed and scanned at the gate for both entry and exit.

#### Acceptance Criteria

1. WHEN a Gate_Pass is created in the Gate_App, THE Gate_App SHALL assign a reference in the format `GP-<year>-<4 digits>` (for example `GP-2026-0007`), where `<year>` is the four-digit year of creation and the 4 digits are a zero-padded sequence number from 0001 to 9999 that is unique within the Company and year, and SHALL generate a QR code from the Gate_QR_Payload of that Gate_Pass.
2. THE Gate_App SHALL NOT reuse a Gate_Pass reference within a Company, including the reference of a Gate_Pass that has been deleted.
3. IF the sequence for a Company and year has reached 9999, THEN THE Gate_App SHALL show an error indicating that no further references are available and SHALL create no Gate_Pass.
4. THE Gate_App SHALL generate a Gate_QR_Payload of the form `AXLEOPS-GATE:<orgId>:<gateEntryId>:<reference>` for Gate_Passes of direction IN and of direction OUT.
5. WHERE a Gate_Pass was created by the Demo_Seeder with a reference of the form `GP-DEMO-<n>`, THE Gate_App SHALL keep that reference unchanged and SHALL use it in the Gate_QR_Payload.
6. WHEN the user opens a Gate_Pass detail panel, THE Gate_App SHALL display the QR image, the Gate_QR_Payload text and the fleet number of the Gate_Pass.
7. WHEN the user clicks Download PNG in the detail panel, THE Gate_App SHALL download the QR image as a PNG file named after the Gate_Pass reference.
8. WHEN the user clicks Print Gate Pass in the detail panel, THE Gate_App SHALL generate a Gate_Pass_PDF and SHALL download or open it for printing.
9. THE Gate_Pass_PDF SHALL contain the Company name, reference, direction, fleet number, machine make and model, customer name, driver, truck plate, branch, gate date and time, status, and the QR image.
10. WHEN a Gate_Pass is linked to a Quotation, Hire_Agreement or Collection_Note, THE Gate_Pass_PDF SHALL show those reference numbers.
11. WHEN the Gate_App creates a Gate_Pass, THE Gate_App SHALL show the generated QR code and a Download action in the success state of the dialog before the dialog closes.
12. WHEN the QR image of a Gate_Pass is decoded, THE Gate_App SHALL obtain a text equal to the Gate_QR_Payload (round-trip property).
13. WHEN the Gate scanner reads a Gate_QR_Payload whose `<orgId>` equals the current Company and whose `<gateEntryId>` matches an existing Gate_Pass, THE Gate_App SHALL open the detail panel of that Gate_Pass with its Process Entry, Approve and Complete actions available, and SHALL create no new record.
14. WHEN the Gate scanner reads a payload that starts with `AXLEOPS-FLEET:`, THE Gate_App SHALL continue to handle it as before (existing fleet QR behavior unchanged).
15. IF the Gate scanner reads a Gate_QR_Payload whose `<orgId>` differs from the current Company, whose `<gateEntryId>` matches no existing Gate_Pass, or which does not have exactly four colon-separated parts, THEN THE Gate_App SHALL show an error message stating the reason (other Company, pass not found, or unrecognized format) and SHALL create no record.
16. IF the QR image or PDF generation fails, THEN THE Gate_App SHALL show an error message and SHALL keep the Gate_Pass stored.
17. THE Gate_App SHALL persist the reference and Gate_QR_Payload components so that the same QR code is regenerated after a browser refresh.
18. THE Gate_App SHALL keep the existing Process Entry, Approve and Complete actions working.

### Requirement 6: Per-company, idempotent demo data for all apps (Task 5)

**User Story:** As a user of any company, I want demo data in every app used by the assignment, so that I can test the whole flow after login.

#### Acceptance Criteria

1. WHEN a user signs in to a Company, or WHEN the first data load of any of the Apps customers, crm, quotation, planner, fleet, invoice, collection_note, mqd, third_party_services, delivery_note, transport or gate runs for that Company in a browser session, THE Demo_Seeder SHALL ensure that the Company has the minimum demo set defined in criteria 6, 7 and 13 for every one of these Apps that is active for the Company.
2. WHEN the Demo_Seeder runs more than once for a Company, THE Demo_Seeder SHALL leave every store with the same records and counts as after the first run (idempotence property).
3. THE Demo_Seeder SHALL create ids that include the `orgId` for every non-JA Company so that two Companies never share a record id.
4. THE Demo_Seeder SHALL leave Company B's stores unchanged when it seeds Company A.
5. THE Demo_Seeder SHALL NOT re-add a demo record that the user deleted after the first seeding, and SHALL NOT overwrite a record that the user edited.
6. THE Demo_Seeder SHALL provide at least one Quotation in each phase Awaiting, Tender, Lost and Won (at least 4 Quotations in total), so that each column of the Pipeline_Board has a card.
7. THE Demo_Seeder SHALL provide at least 2 Transport_Jobs, one of type Delivery and one of type Collection, each linked to a demo Quotation and a demo Fleet_Machine and each with an assigned driver and an assigned truck, and SHALL provide at least 2 Gate_Passes, one of direction IN and one of direction OUT, each linked to a demo Fleet_Machine.
8. THE Demo_Seeder SHALL produce record dates relative to the current date for hire periods that must be current (On Hire, upcoming), and fixed dates for historical records.
9. IF a demo record cannot be created because a related record is missing, THEN THE Demo_Seeder SHALL skip that record, SHALL log the reason to the console and SHALL continue with the remaining records without throwing.
10. WHEN a Company activates an App later, THE Demo_Seeder SHALL add the demo data of that App on the next call without duplicating existing records.
11. THE Demo_Seeder SHALL run without blocking the first render, SHALL complete seeding of a Company within 2 seconds on first run, and the application SHALL start with no console errors from seeding for the JA Company and for a newly signed-up Company.
12. THE Demo_Seeder SHALL persist its seeded-company flag so that a browser refresh does not reseed the Company.
13. THE Demo_Seeder SHALL provide, for each App, at least the following demo records, all linked through ids of the same Company:
    - customers: the 9 Customers listed in Requirement 4 criterion 2.
    - crm and quotation: the Quotations of criterion 6.
    - planner: at least 1 Planner_Booking linked to the Won Quotation and its Fleet_Machine.
    - fleet: at least 3 Fleet_Machines, including the Fleet_Machines linked to criteria 7 and 13.
    - invoice: at least 1 Invoice linked to the Won Quotation.
    - collection_note: at least 1 Collection_Note linked to the Won Quotation.
    - mqd, third_party_services and delivery_note: the Hire_Documents of criterion 14.
    - transport: the Transport_Jobs of criterion 7, plus at least 1 driver and 1 truck.
    - gate: the Gate_Passes of criterion 7.
14. THE Demo_Seeder SHALL provide, for the Won Quotation, exactly one Hire_Document of each type with these Document_Status values: Delivery Note with Signed Copy Uploaded (including Signed_Copy metadata), MQD with Generated, and TPS with Not Generated.

### Requirement 7: Hire Documents – Delivery Note, MQD and Third-Party Services (PDF workstream 2)

**User Story:** As a hire desk user, I want to generate, download and upload signed copies of the Delivery Note, MQD and Third-Party Services form for a quotation, so that every hire has its signed documents on record.

#### Acceptance Criteria

1. WHEN the user opens the Delivery Note App page at `/docs/delivery-note`, THE Delivery Note App SHALL replace the placeholder with a list of the active Company's Quotations that have a linked Hire_Agreement, showing for each Quotation the quotation number, hire agreement number, customer, fleet number, and one Document_Status for each of Delivery Note, MQD and TPS. Quotations without a linked Hire_Agreement SHALL NOT appear in the list. All Hire_Document actions (Generate, Download, Upload) SHALL be available on this page only.
2. WHEN a Quotation has no Hire_Document of a type, THE Delivery Note App SHALL show Document_Status Not Generated for that type.
3. WHEN the user clicks Generate for a listed Quotation and a type, THE Delivery Note App SHALL create a PDF from Quotation, Customer, Fleet_Machine and Hire_Agreement data, SHALL store the document record linked to the Quotation id and Hire_Agreement id, SHALL set Document_Status to Generated, and SHALL assign a document number in the format `DN-<year>-<4 digits>` for Delivery Note, `HMQD-<year>-<4 digits>` for MQD, and `HTPS-<year>-<4 digits>` for TPS, where `<year>` is the 4-digit year of the generation date and the 4 digits are a sequence from 0001 to 9999 unique per prefix and year within the Company.
4. IF the Quotation has no linked Hire_Agreement or Fleet_Machine, THEN THE Delivery Note App SHALL reject generation, SHALL show an error naming the missing link (Hire_Agreement or Fleet_Machine), and SHALL create no document record.
5. WHEN the user clicks Download on a Generated document, THE Delivery Note App SHALL download the PDF for the stored document.
6. WHEN the user uploads a valid Signed_Copy for a Generated document, THE Delivery Note App SHALL store the file and its metadata (file name, file type, size in bytes, upload date and time, uploader) linked to the document, SHALL record the uploader as the display name of the signed-in user, and SHALL set Document_Status to Signed Copy Uploaded.
7. THE Delivery Note App SHALL accept Signed_Copy files of type PDF, PNG and JPEG with a size from 1 byte to 10 MB (10,485,760 bytes).
8. IF the uploaded file has a type other than PDF, PNG or JPEG, or exceeds 10 MB, or is empty, THEN THE Delivery Note App SHALL reject the file, SHALL show an error naming the violated rule (type, size or empty), and SHALL keep the previous Document_Status and stored file.
9. IF the file storage fails during upload, THEN THE Delivery Note App SHALL show an error message, SHALL keep the previous Document_Status and stored file, and SHALL keep no partial file or metadata.
10. WHEN the user uploads a Signed_Copy for a document that already has one, THE Delivery Note App SHALL ask for confirmation, and on confirmation SHALL replace the stored file and metadata, keeping one Signed_Copy per document. IF the user declines, THEN THE Delivery Note App SHALL keep the existing Signed_Copy unchanged.
11. WHEN the user clicks Download on a Signed_Copy, THE Delivery Note App SHALL download the stored file only for a user of the owning Company with the Delivery Note App active, and otherwise SHALL deny the download and show an error.
12. THE Delivery Note App SHALL persist documents, statuses and metadata so that they remain after a browser refresh.
13. WHEN the user clicks Generate for a type that already has a Hire_Document of that Quotation, THE Delivery Note App SHALL return the existing document with its existing number and SHALL NOT create a second one.
14. THE Delivery Note App SHALL reuse the PDF builders and the Signed_Copy store of the collection documents where the data model fits, SHALL keep Hire_Documents separate from the off-hire MQD and TPS stores, and SHALL NOT alter the Collection_Note, off-hire `MQD-` or off-hire `TPS-` numbering.
15. FOR ALL Hire_Documents, a Document_Status of Signed Copy Uploaded SHALL imply that a stored file exists for the document (invariant).

### Requirement 8: Acceptance-criteria traceability of PDF workstreams 1 to 6 (Task 6)

**User Story:** As a project owner, I want a verified check that PDF workstreams 1 to 6 work end to end and that apps are connected through their ids, so that I can accept the delivery.

#### Acceptance Criteria

1. THE Traceability_Matrix, stored in `.kiro/specs/rental-flow-integration/traceability.md`, SHALL list every acceptance criterion of PDF workstreams 1 to 6, the implementing source file and the test that proves the criterion, with the state Pass, Gap-fixed or Gap-open.
2. THE Verification_Suite, stored in `src/services/__tests__/e2e/`, SHALL contain an automated end-to-end test for each of the following links using real stores and services:
   - Quotation Won → Invoice number uses the Quotation number (`QT-…/NN`).
   - Quotation → Hire_Agreement → Planner_Booking → On Hire → Quotation Won.
   - Collection_Note → MQD and TPS carry the same Collection_Note reference, Quotation reference, Invoice reference, Customer and fleet number.
   - Fleet QR payload → Collection_Note QR → resolved Fleet_Machine.
   - Gate-In scan → fleet number, server time and stored Gate_Pass.
3. WHEN the Verification_Suite runs workstream 1, THE Verification_Suite SHALL check that Lost quotations leave the active pipeline total, appear in the Lost tab, are searchable, reopen only with a reason, and persist after store rehydration.
4. WHEN the Verification_Suite runs workstream 3, THE Verification_Suite SHALL check that a duplicate Hire_Agreement id is rejected, that On Hire marks only the linked Quotation Won regardless of job state, and that repeating On Hire adds no second history entry.
5. WHEN the Verification_Suite runs workstream 4, THE Verification_Suite SHALL check that a non-Won Quotation cannot be invoiced in the UI service and in the store service, that Continuous Hire rejects a period end before the hire start or overlapping the previous period, and that Off-Hire uses the Quotation hire end date.
6. WHEN the Verification_Suite runs workstream 5, THE Verification_Suite SHALL check that the Collection_Note, MQD and TPS PDFs contain the Quotation reference, Invoice reference, Customer and fleet number, and that the Collection_Note QR resolves the correct Fleet_Machine.
7. WHEN the Verification_Suite runs workstream 6, THE Verification_Suite SHALL check that a valid QR fills the fleet number, that an invalid QR shows an error and stores no record, that the stored date and time come from the server clock, and that manual entry works.
8. WHEN the Verification_Suite runs workstream 2, THE Verification_Suite SHALL check the Requirement 7 criteria for status transitions, file validation and duplicate upload.
9. THE Verification_Suite SHALL run for the Company `org-ja` and for a newly signed-up Company with seeded demo data, with identical results.
10. IF the Traceability_Matrix lists a Gap-open criterion, THEN THE App SHALL provide the missing behavior, and the Traceability_Matrix SHALL show the state Gap-fixed with a passing test in the Verification_Suite for that criterion.
11. THE Traceability_Matrix SHALL record the gap "Delivery Note, hire-phase MQD and Third-Party Services generate, download and signed upload are missing" as a known gap resolved by Requirement 7.
12. WHEN the Quality_Gate runs after the implementation, THE project SHALL pass `tsc -b` with no errors, `vitest --run` with no failing test, and `eslint` with no new error compared with the branch start.

### Requirement 9: Cross-cutting behavior for every company (non-functional)

**User Story:** As a user of any company, I want the new behavior to work after any login and to survive refreshes, so that the demo runs smoothly.

#### Acceptance Criteria

1. WHEN any Company user signs in, THE App SHALL show the behavior of Requirements 1 to 8 using only the records whose Company equals the signed-in Company, and SHALL show zero records belonging to any other Company.
2. WHEN a browser refresh occurs, THE App SHALL retain 100% of the new records (Transport_Jobs, Customers, Hire_Documents, Gate_Pass reference data, phase history) that were stored in the persisted per-Company stores or in IndexedDB before the refresh.
3. WHEN persisted state saved by a previous app version is loaded, THE App SHALL migrate it to the current version with zero records lost or altered in their existing field values, and SHALL complete without throwing an error.
4. IF persisted state cannot be migrated, THEN THE App SHALL keep the original persisted state unchanged, SHALL show an error indication to the user, and SHALL continue to load with empty state for the affected store.
5. THE App SHALL run in the browser without a server, and the QR and PDF generation SHALL use the installed `qrcode` and `jspdf` packages with zero network requests.
6. WHILE an App is not active for the signed-in Company, THE route guard SHALL block navigation to that App's pages, and records linked to that App SHALL NOT cause an error or missing data in any active App.
7. THE implementation SHALL add property-based tests with fast-check v4 (no `fc.stringOf`), each running at least 100 generated cases, for the phase transition rules, seeder idempotence, referential integrity, QR payload round trip and file validation.
8. THE implementation SHALL keep all work on the branch `feature/crm-plugin` without creating a commit, and SHALL leave every file under `odoo/` unchanged.
9. THE implementation SHALL install dependencies with `npm install --legacy-peer-deps`.
10. THE implementation SHALL NOT change the existing numbering formats (QT-…, HA-…, INV `QT-…/NN`, CN-…, MQD-…, TPS-…).
