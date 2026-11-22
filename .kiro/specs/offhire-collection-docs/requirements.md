# Requirements Document

## Introduction

This feature generates three downloadable PDF documents when an off-hire or collection of a hired machine starts: a Collection Note, a Machine Quality Document (MQD) for off-hire, and a Third-Party Services document. Each document carries the quotation and invoice references, customer details and fleet details. The Collection Note shows a QR code built from the stored unique fleet number, and decoding that QR code resolves exactly one machine in the organisation. Signed copies of each document can be uploaded and persisted in the browser. A single "Initiate Off-Hire / Collection" action creates the Collection Note and linked MQD and Third-Party Services drafts. The feature includes a new Documents app, Third-Party Services, and demo data across the connected apps.

## Glossary

- **Collection_System**: The set of features covering collection initiation, document generation, QR resolution, signed-copy storage and numbering described in this document.
- **Collection_Note_App**: The existing Collection Note app that replaces its placeholder with list, initiate dialog and detail views.
- **MQD_App**: The existing Machine Quality Document app.
- **TPS_App**: The new Documents app `third_party_services`, routed at `/docs/third-party-services`.
- **Fleet_App**: The existing Fleet app, including the machine detail view.
- **Collection_Note**: A record describing the collection of one On Hire machine from a customer.
- **MQD**: A Machine Quality Document recording the condition of a machine at off-hire.
- **TPS_Document**: A Third-Party Services record listing outside services used for one collection.
- **Service_Line**: One row of a TPS_Document with provider, service type, description, date, reference or PO, quantity, rate and amount.
- **Service_Type**: One of Transport, Crane, Escort, Inspection, Cleaning or Other.
- **Machine**: A fleet machine record stored for an organisation.
- **Fleet_Number**: The unique identifier of a Machine within an organisation, equal to the Machine `fleetNo` when set, otherwise the Machine `assetNumber`.
- **Organisation**: A tenant identified by an `orgId`.
- **On_Hire**: The Machine status indicating the Machine is currently hired to a customer.
- **QR_Payload**: The text `AXLEOPS-FLEET:<orgId>:<machineId>:<fleetNo>` encoded in the QR code.
- **QR_Resolver**: The component that decodes a QR_Payload and resolves it to one Machine.
- **Reference_Chain**: The stored links from Machine to Booking to Hire Agreement to Quotation to latest active Invoice.
- **Reference_Fields**: The quotation reference, invoice reference, hire agreement reference, customer and fleet details copied from the Reference_Chain onto a document.
- **Document_Number**: A per-Organisation sequential identifier of the form CN-<year>-<4 digits>, MQD-<year>-<4 digits> or TPS-<year>-<4 digits>.
- **Signed_Copy**: A PDF or image file uploaded as the signed version of a document.
- **Signed_Status**: The value Pending or Signed on a document.
- **Collection_Status**: The value Draft, Scheduled, Collected or Closed on a Collection_Note.
- **Document_Store**: Browser persistence using IndexedDB, falling back to in-memory storage when IndexedDB is unavailable.
- **Demo_Seeder**: The `ensureHireLinkDemo` routine that creates demo data for connected apps.
- **Active_App**: An app that is enabled for the current Organisation.
- **Transport_Job_Callback**: An injected callback that creates a Transport collection job when the Transport app is an Active_App.

## Requirements

### Requirement 1: Initiate Off-Hire

**User Story:** As a fleet operator, I want to initiate an off-hire or collection from one action, so that all required documents are created together and linked.

#### Acceptance Criteria

1. WHEN a user submits the initiate dialog for an On_Hire Machine, THE Collection_System SHALL create one Collection_Note, one linked MQD draft and one linked TPS_Document draft.
2. THE Collection_System SHALL store on each created document the identifiers of the other two documents created by the same action.
3. THE Collection_Note_App SHALL list only Machines with status On_Hire in the initiate dialog Machine picker.
4. THE Collection_Note_App SHALL display the stored Fleet_Number of each Machine in the Machine picker.
5. WHERE the Fleet_App Machine detail is open for an On_Hire Machine and the Collection_Note_App is an Active_App, THE Fleet_App SHALL display an "Initiate Off-Hire / Collection" action.
6. WHILE the Collection_Note_App is not an Active_App, THE Fleet_App SHALL hide the "Initiate Off-Hire / Collection" action.
7. WHILE a Machine status is not On_Hire, THE Fleet_App SHALL hide the "Initiate Off-Hire / Collection" action for that Machine.
8. IF the MQD_App is not an Active_App, THEN THE Collection_System SHALL skip creating the MQD draft, create the Collection_Note, and display a notice naming the skipped document.
9. IF the TPS_App is not an Active_App, THEN THE Collection_System SHALL skip creating the TPS_Document draft, create the Collection_Note, and display a notice naming the skipped document.
10. WHERE the Transport app is an Active_App, THE Collection_System SHALL invoke the Transport_Job_Callback to create a Transport collection job for the Collection_Note.
11. IF the Transport_Job_Callback fails, THEN THE Collection_System SHALL keep the created documents and display an error notice.
12. WHEN a Collection_Note is created, THE Collection_System SHALL set Collection_Status to Draft and Signed_Status to Pending.

### Requirement 2: Document Numbering

**User Story:** As a fleet operator, I want document numbers that are unique and never reused, so that every document can be traced.

#### Acceptance Criteria

1. WHEN a Collection_Note is created, THE Collection_System SHALL assign a Document_Number of the form CN-<year>-<4 digits>.
2. WHEN an MQD is created, THE Collection_System SHALL assign a Document_Number of the form MQD-<year>-<4 digits>.
3. WHEN a TPS_Document is created, THE Collection_System SHALL assign a Document_Number of the form TPS-<year>-<4 digits>.
4. THE Collection_System SHALL keep a separate sequence for each Organisation, each document type and each year.
5. THE Collection_System SHALL increment the sequence by one for each Document_Number issued.
6. WHEN a document is deleted, THE Collection_System SHALL retain its Document_Number as issued and not assign it to another document.

### Requirement 3: Reference Resolution

**User Story:** As a fleet operator, I want document references filled from stored links, so that quotation and invoice numbers are correct without retyping.

#### Acceptance Criteria

1. WHEN a document is created, THE Collection_System SHALL resolve the Reference_Chain for the Machine using stored records only.
2. THE Collection_System SHALL select the Booking for the Machine by Machine identifier, preferring an active Booking and otherwise the latest Booking.
3. THE Collection_System SHALL select the latest active Invoice linked to the Quotation by quotation identifier.
4. THE Collection_System SHALL copy the quotation reference, invoice reference, hire agreement reference, customer details and fleet details onto each created document.
5. IF a link in the Reference_Chain is missing, THEN THE Collection_System SHALL leave the dependent Reference_Fields blank, record a note naming the missing link, and complete document creation.
6. THE Collection_Note_App SHALL display Reference_Fields as read-only.
7. WHEN a user selects "Refresh references" on a document, THE Collection_System SHALL re-resolve the Reference_Chain and update the Reference_Fields.

### Requirement 4: Fleet Number

**User Story:** As a fleet operator, I want each Machine to have a unique fleet number, so that machines can be identified on documents and by QR code.

#### Acceptance Criteria

1. THE Fleet_App SHALL store a typed `fleetNo` field on each Machine.
2. THE Collection_System SHALL compute the Fleet_Number of a Machine as `fleetNo` when `fleetNo` is set, otherwise `assetNumber`.
3. IF a Machine create or update would give the Machine a Fleet_Number equal to that of another Machine in the same Organisation, THEN THE Fleet_App SHALL reject the change and display a duplicate fleet number error.
4. THE Fleet_App SHALL permit the same Fleet_Number on Machines in different Organisations.
5. THE Fleet_App SHALL compare Fleet_Numbers case-insensitively after trimming surrounding whitespace.

### Requirement 5: QR Code

**User Story:** As a yard operator, I want a QR code on the Collection Note, so that I can scan it to find the right machine.

#### Acceptance Criteria

1. THE Collection_System SHALL build the QR_Payload as `AXLEOPS-FLEET:<orgId>:<machineId>:<fleetNo>` from the stored Machine record.
2. THE Collection_System SHALL exclude user-typed text from the QR_Payload.
3. THE Collection_Note_App SHALL display a QR code preview of the QR_Payload on the Collection_Note detail view.
4. THE Fleet_App SHALL display the QR code of the QR_Payload on the Machine detail view.
5. WHEN the QR_Resolver decodes a QR_Payload whose Organisation matches the current Organisation and whose machine identifier and Fleet_Number match exactly one stored Machine, THE QR_Resolver SHALL return that Machine.
6. IF a QR_Payload does not match the format `AXLEOPS-FLEET:<orgId>:<machineId>:<fleetNo>`, THEN THE QR_Resolver SHALL return the error OTHER.
7. IF a QR_Payload names an Organisation different from the current Organisation, THEN THE QR_Resolver SHALL return the error OTHER_ORG.
8. IF no Machine in the current Organisation matches the QR_Payload machine identifier or Fleet_Number, THEN THE QR_Resolver SHALL return the error NOT_FOUND.
9. IF the QR_Payload Fleet_Number matches more than one Machine in the current Organisation, THEN THE QR_Resolver SHALL return the error AMBIGUOUS.
10. IF the QR_Payload machine identifier and Fleet_Number match different Machines, THEN THE QR_Resolver SHALL return the error MISMATCH.

### Requirement 6: Fleet Deep Links

**User Story:** As a user, I want to open a machine from a link or scanned QR code, so that I reach the right machine detail quickly.

#### Acceptance Criteria

1. WHEN the Fleet_App is opened at `/fleet?fleet=<fleetNo>&id=<machineId>`, THE Fleet_App SHALL open the detail of the Machine that matches both values.
2. WHEN the Fleet_App is opened at `/fleet?qr=<payload>`, THE Fleet_App SHALL pass the payload to the QR_Resolver and open the detail of the returned Machine.
3. IF the QR_Resolver returns an error, THEN THE Fleet_App SHALL display a message identifying the error code and not open a Machine detail.
4. IF the `fleet` and `id` query values match no Machine in the current Organisation, THEN THE Fleet_App SHALL display a not-found message.

### Requirement 7: PDF Generation

**User Story:** As a fleet operator, I want real downloadable PDFs for each document, so that I can send them to customers and crews.

#### Acceptance Criteria

1. WHEN a user selects Download PDF on a Collection_Note, THE Collection_System SHALL generate a PDF file with the jspdf library and download it.
2. WHEN a user selects Download MQD PDF on an MQD, THE Collection_System SHALL generate a PDF file with the jspdf library and download it.
3. WHEN a user selects Download PDF on a TPS_Document, THE Collection_System SHALL generate a PDF file with the jspdf library and download it.
4. THE Collection_System SHALL include on each PDF the Document_Number, quotation reference, invoice reference, customer details and fleet details.
5. THE Collection_System SHALL render the QR code on the Collection_Note PDF using the qrcode library.
6. THE Collection_System SHALL include on the TPS_Document PDF every Service_Line, the notes, the approvedBy value and the total.
7. THE Collection_System SHALL include on the MQD PDF every edited MQD field.
8. THE Collection_System SHALL include signature areas on each PDF.

### Requirement 8: Collection Note App

**User Story:** As a fleet operator, I want to manage the Collection Note in the Collection Note app, so that I can track each collection.

#### Acceptance Criteria

1. THE Collection_Note_App SHALL replace the placeholder with a list showing Document_Number, Fleet_Number, customer, quotation reference, invoice reference, date, Collection_Status and Signed_Status.
2. THE Collection_Note_App SHALL provide a detail view in which all non-reference fields are editable.
3. THE Collection_Note_App SHALL provide Collection_Status values Draft, Scheduled, Collected and Closed.
4. THE Collection_Note_App SHALL provide Signed_Status values Pending and Signed.
5. THE Collection_Note_App SHALL provide links from the Collection_Note detail view to the linked MQD and TPS_Document.
6. WHEN a user saves edits to a Collection_Note, THE Collection_System SHALL persist the changes.

### Requirement 9: Third-Party Services App

**User Story:** As a fleet operator, I want to record third-party services for a collection, so that outside costs are documented and totalled.

#### Acceptance Criteria

1. THE TPS_App SHALL be a Documents app with the key `third_party_services` routed at `/docs/third-party-services`.
2. THE TPS_App SHALL list TPS_Documents with Document_Number, Collection_Note number, Fleet_Number, customer, total and Signed_Status.
3. THE TPS_App SHALL allow each Service_Line to hold provider, Service_Type, description, date, reference or PO, quantity and rate.
4. THE TPS_App SHALL restrict Service_Type to Transport, Crane, Escort, Inspection, Cleaning and Other.
5. THE TPS_App SHALL compute each Service_Line amount as quantity multiplied by rate.
6. THE TPS_App SHALL compute the TPS_Document total as the sum of all Service_Line amounts without adding tax.
7. THE TPS_App SHALL provide editable notes, approvedBy and signature fields.
8. THE TPS_App SHALL allow every form field to be edited.
9. WHEN a user adds or removes a Service_Line, THE TPS_App SHALL recompute the total.
10. IF a Service_Line quantity or rate is negative or not a number, THEN THE TPS_App SHALL reject the value and display a validation message.

### Requirement 10: MQD Persistence

**User Story:** As a quality inspector, I want MQD records saved permanently, so that off-hire condition reports are not lost.

#### Acceptance Criteria

1. WHEN a user saves the MQDDialog, THE MQD_App SHALL persist the record in the mqdStore.
2. WHEN a user saves the MQDDialog with photos, THE MQD_App SHALL persist the photos in the Document_Store.
3. THE MQD_App SHALL list persisted records merged with the existing mock list, showing reference, Fleet_Number, hirer, Collection_Note number and Signed_Status.
4. WHEN a user opens a persisted MQD, THE MQD_App SHALL allow all fields to be edited.
5. THE MQD_App SHALL display the title "Machine Quality Document".
6. WHEN a user selects Download MQD PDF, THE MQD_App SHALL generate the MQD PDF.

### Requirement 11: Signed Copies

**User Story:** As a fleet operator, I want to upload signed copies of each document, so that the signed evidence is kept with the record.

#### Acceptance Criteria

1. WHEN a user uploads a PDF or image file as a Signed_Copy on a Collection_Note, MQD or TPS_Document, THE Collection_System SHALL store the file in the Document_Store and set Signed_Status to Signed.
2. THE Collection_System SHALL allow a user to view the stored Signed_Copy.
3. WHEN a user uploads a replacement file, THE Collection_System SHALL replace the stored Signed_Copy.
4. IF the uploaded file is not a PDF or image type, THEN THE Collection_System SHALL reject the file and display an error message.
5. IF IndexedDB is unavailable, THEN THE Collection_System SHALL store the Signed_Copy in memory for the current session.
6. WHEN the page is reloaded and IndexedDB is available, THE Collection_System SHALL return the stored Signed_Copy.

### Requirement 12: Demo Data

**User Story:** As a demonstrator, I want connected demo data, so that the feature can be shown end to end.

#### Acceptance Criteria

1. WHEN the Demo_Seeder runs for an Organisation, THE Demo_Seeder SHALL create Collection_Note, MQD and TPS_Document demo records for machines J105 and J104 where each machine exists in that Organisation.
2. THE Demo_Seeder SHALL create for J105 the Collection_Note CN-2026-0001 with Collection_Status Scheduled and date 2026-12-14, linked to quotation QT-2026-0010, hire agreement HA-2026-005 and invoice QT-2026-0010/01.
3. THE Demo_Seeder SHALL create for J105 the MQD MQD-2026-0001 and the TPS_Document TPS-2026-0001 with Signed_Status Pending.
4. THE Demo_Seeder SHALL create on TPS-2026-0001 a Service_Line from Gulf Haulage LLC for low-bed transport of AED 1,200 and a Service_Line from Al Rafi Cranes for a 50T crane lift of AED 2,500.
5. THE Demo_Seeder SHALL create for J104 the Collection_Note CN-2026-0002 with Collection_Status Collected and Signed_Status Signed, linked to hire agreement HA-2026-004 and invoice INV-2026-004.
6. THE Demo_Seeder SHALL attach a generated placeholder PDF as the Signed_Copy of CN-2026-0002.
7. THE Demo_Seeder SHALL create demo records connected across Fleet, Planner, Hire Agreement, CRM, Invoice, Collection Note, MQD, Third-Party Services and Transport apps.
8. WHEN the Demo_Seeder runs for an Organisation other than org-ja, THE Demo_Seeder SHALL create demo records with identifiers specific to that Organisation.
9. WHEN the Demo_Seeder runs again, THE Demo_Seeder SHALL keep existing demo records unchanged.
10. IF a user has deleted a demo record, THEN THE Demo_Seeder SHALL leave that record deleted on later runs.

### Requirement 13: Module Boundaries

**User Story:** As a maintainer, I want clear module boundaries, so that the feature stays testable and the app dependency graph stays stable.

#### Acceptance Criteria

1. THE Collection_System SHALL implement the pure logic in `collectionCore.ts` with imports limited to types.
2. THE Collection_System SHALL implement the facade `collectionDocs.ts` and PDF module `collectionPdf.ts` without importing `services.ts` or `appStore.ts`.
3. THE Collection_System SHALL implement `features/collection` and `features/thirdparty` without importing `crmStore`.
4. THE Collection_System SHALL leave the dependency edges defined in `apps.ts` unchanged.
