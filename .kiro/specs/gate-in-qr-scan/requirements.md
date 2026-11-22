# Requirements Document

## Introduction

Gate staff currently select a Fleet Number and enter the date and time by hand when a machine passes the gate. This feature adds QR scanning to the existing Gate Entry dialog. Scanning the QR code printed on a Collection Note resolves the code to a fleet record, fills in the Fleet Number, and records the gate date and timestamp automatically from an authoritative server time. The existing Fleet Number dropdown stays as a manual fallback, and its date and time are also captured automatically.

The feature is browser-only. Server time comes from the HTTP `Date` response header of the app's own origin through a single clock service, so a real API can replace it later. The feature makes no changes to Odoo.

## Glossary

- **Gate_Dialog**: The Gate Entry dialog implemented in `GatePassDialog.tsx`.
- **Gate_Page**: The Gate Operations page implemented in `GatePage.tsx`, including its detail panel.
- **QR_Scanner**: The camera-based scanning component inside the Gate_Dialog. It uses the rear camera and decodes frames with jsqr.
- **QR_Payload**: The text `AXLEOPS-FLEET:<orgId>:<machineId>:<fleetNo>` built by `buildQrPayload` and printed on the Collection Note and the Fleet QR panel.
- **Scan_Resolver**: The pure function `resolveGateScan` in `gateCore.ts`. It resolves a QR_Payload to a machine or to a scan error.
- **Scan_Error**: One of the errors returned by `resolveQr` (OTHER, OTHER_ORG, NOT_FOUND, AMBIGUOUS, MISMATCH), each mapped to a message in GATE_SCAN_MESSAGES.
- **Server_Clock**: The clock service in `serverClock.ts` that exposes `serverNow()`, `computeOffset` and `resetServerClock`.
- **Clock_Offset**: The difference between the server time read from the HTTP `Date` header and the device clock, cached for 5 minutes.
- **Time_Source**: The value `server` or `device`, which records where a timestamp came from.
- **Capture_Method**: The value `QR` or `Manual`, which records how the Fleet Number was chosen.
- **Gate_Record**: A Gate-In or Gate-Out record, stored as StoredGateEntry in the appStore and as GateEntry in the gate service.
- **Gate_Time_Zone**: The IANA time zone of the browser, stored in the `gateTimeZone` field of a Gate_Record, used to compute `gateDate` and `gateTime`.
- **Record_Builder**: The pure function `buildGateRecordFields` in `gateCore.ts`. It builds the fleet reference, timestamp, date, time and time zone fields of a Gate_Record.
- **Gate_Service**: The mock `gateService` in `services.ts`.
- **App_Store**: The zustand `appStore`, which holds Gate_Records and machine status.
- **Collection_Note**: An off-hire collection document with a status, an org and a machine.
- **Open_Collection_Note**: A Collection_Note whose status is neither Collected nor Closed.
- **pickNoteToCollect**: The pure helper `pickNoteToCollect(notes, orgId, machineId)` in `collectionDocs.ts`. It returns the Open_Collection_Note with the latest `createdAt` for the given org and machine, or no value if none exists.
- **Gate_Role**: A role that `hasPageAccess('/gate')` allows. These are Security, Ops Executive, Operations Manager, Executive Manager and Managing Director.
- **Scan_Mode**: The Gate_Dialog state in which the Fleet Number comes from a QR scan.
- **Manual_Mode**: The Gate_Dialog state in which the Fleet Number comes from the dropdown.
- **Company**: An org. Any user can sign up a new Company. The built-in demo company is org-ja (Johnson Arabia). A Company is identified by its orgId.
- **Gate_Store**: The persisted browser storage (zustand persisted store) that holds Gate_Records for all Companies, each tagged with its orgId.
- **Legacy_Gate_Record**: A Gate_Record stored before this feature that has no orgId.
- **Gate_Seed_Record**: A demo Gate_Record created by the Gate_Demo_Seeder.
- **Gate_Demo_Seeder**: The function that creates the per-Company demo Gate_Records, built on the same pattern as `ensureHireLinkDemo` and `ensureCollectionDemo` in `demoSeed.ts`.
- **Demo_Machine**: A machine created by the existing demo seed for a Company (`mc-demo-N`, or `mc-N` for org-ja), identified by its Fleet Number (J101, J104, J105).
- **Gate_Seed_Marker**: A persisted record, per Company and per Gate_Seed_Record id, that the Gate_Seed_Record was created once.
- **Gate_Operations_App**: The Gate app under `src/features/gate`, including the Gate_Page and the Gate_Dialog.
- **Gate_Operation**: Creating, approving or completing a Gate_Record, setting a Collection_Note to Collected, or changing a machine status as a result of a Gate_Record (IN to PHI, OUT to On Hire).
- **Collection_Gate_Link**: The fields `collectedByGateId`, `collectedByGateRef` and `collectedAt` on a Collection_Note.
- **Collection_Note_Detail**: The Collection Note detail view in `CollectionDetail.tsx`.

## Requirements

### Requirement 1: Scan a QR code in the Gate Dialog

**User Story:** As a gate security officer, I want to scan the QR code on a Collection Note with the device camera, so that I do not have to look up the Fleet Number by hand.

#### Acceptance Criteria

1. WHEN the Gate_Dialog opens, THE Gate_Dialog SHALL show Scan_Mode with the QR_Scanner active and a live camera preview displayed after camera permission is granted.
2. WHEN the QR_Scanner starts, THE QR_Scanner SHALL request the rear camera through `getUserMedia`.
3. WHILE the QR_Scanner is active, THE QR_Scanner SHALL attempt to decode a video frame with jsqr at least every 250 ms until a QR code is decoded or the QR_Scanner stops.
4. WHEN the QR_Scanner decodes a QR code, THE QR_Scanner SHALL stop all camera stream tracks and pass the decoded text, unmodified, to the Scan_Resolver exactly once.
5. WHEN the Gate_Dialog closes, THE QR_Scanner SHALL stop all camera stream tracks, release the camera, and pass no further decoded text to the Scan_Resolver.
6. THE Gate_Dialog SHALL provide a control to switch between Scan_Mode and Manual_Mode.
7. WHEN the user switches from Scan_Mode to Manual_Mode, THE QR_Scanner SHALL stop all camera stream tracks and release the camera.
8. IF the camera permission is denied, the camera is not found, the camera is in use by another application, or `getUserMedia` is unavailable, THEN THE Gate_Dialog SHALL display an error message indicating the cause, SHALL NOT show a camera preview, and SHALL keep the control to switch to Manual_Mode available.
9. IF the Scan_Resolver returns a Scan_Error for the decoded text, THEN THE Gate_Dialog SHALL handle it as defined in Requirement 3.

### Requirement 2: Resolve a scanned QR to a fleet record

**User Story:** As a gate security officer, I want a valid scan to fill in the correct Fleet Number, so that the Gate_Record refers to the right machine.

#### Acceptance Criteria

1. WHEN the Scan_Resolver receives a QR_Payload whose orgId equals the current orgId, whose machineId matches a machine in the supplied machine list, and whose Fleet Number, after normalisation (trimmed, case-insensitive), equals the normalised `fleetNumberOf` of that machine and of no other machine in the list, THE Scan_Resolver SHALL return `{ok: true, machine}` with that machine.
2. IF the QR_Payload is not in the format `AXLEOPS-FLEET:<orgId>:<machineId>:<fleetNo>`, THEN THE Scan_Resolver SHALL return `{ok: false}` with error OTHER and SHALL NOT return a machine.
3. IF the QR_Payload orgId differs from the current orgId, THEN THE Scan_Resolver SHALL return `{ok: false}` with error OTHER_ORG and SHALL NOT return a machine.
4. IF the QR_Payload orgId equals the current orgId and neither the QR_Payload machineId nor the normalised QR_Payload Fleet Number matches any machine of the current org, THEN THE Scan_Resolver SHALL return `{ok: false}` with error NOT_FOUND and SHALL NOT return a machine.
5. IF the QR_Payload orgId equals the current orgId and more than one machine of the current org has the normalised QR_Payload Fleet Number, THEN THE Scan_Resolver SHALL return `{ok: false}` with error AMBIGUOUS and SHALL NOT return a machine.
6. IF the QR_Payload orgId equals the current orgId, the error is not NOT_FOUND or AMBIGUOUS, and the machineId and the Fleet Number do not identify the same single machine (the machineId is found but the Fleet Number belongs to a different machine, or the Fleet Number is found but the machineId is not), THEN THE Scan_Resolver SHALL return `{ok: false}` with error MISMATCH and SHALL NOT return a machine.
7. WHEN the Scan_Resolver returns a machine, THE Gate_Dialog SHALL display the Fleet Number (the `fleetNumberOf` of that machine), the make and the model of that machine, and SHALL set the machine id of the form to the id of that machine.
8. IF the Scan_Resolver returns an error, THEN THE Gate_Dialog SHALL display an error message indicating the error, SHALL leave the machine id of the form empty, and SHALL leave the other form field values unchanged.
9. THE Scan_Resolver SHALL use `resolveQr`, unchanged, for QR_Payload parsing and machine matching.
10. THE Scan_Resolver SHALL import only types and the pure module `collectionCore.ts` and SHALL NOT use stores, browser APIs, the clock or randomness.
11. FOR ALL machine lists in which the normalised `fleetNumberOf` values are unique within the org, resolving the QR_Payload built by `buildQrPayload` for each machine in that machine's own org SHALL return that same machine (round-trip property).

### Requirement 3: Reject invalid or unknown QR values

**User Story:** As a gate security officer, I want a clear error for a bad scan, so that no incorrect Gate_Record is created.

#### Acceptance Criteria

1. IF the decoded text is not a valid QR_Payload, THEN THE Gate_Dialog SHALL display the message mapped to the OTHER error in GATE_SCAN_MESSAGES together with the error code "OTHER".
2. IF the QR_Payload belongs to a different org, THEN THE Gate_Dialog SHALL display the message mapped to the OTHER_ORG error in GATE_SCAN_MESSAGES together with the error code "OTHER_ORG".
3. IF the QR_Payload matches no machine, THEN THE Gate_Dialog SHALL display the message mapped to the NOT_FOUND error in GATE_SCAN_MESSAGES together with the error code "NOT_FOUND".
4. IF the QR_Payload matches more than one machine, THEN THE Gate_Dialog SHALL display the message mapped to the AMBIGUOUS error in GATE_SCAN_MESSAGES together with the error code "AMBIGUOUS".
5. IF the machine id and the Fleet Number in the QR_Payload refer to different machines, THEN THE Gate_Dialog SHALL display the message mapped to the MISMATCH error in GATE_SCAN_MESSAGES together with the error code "MISMATCH".
6. THE Scan_Resolver SHALL provide in GATE_SCAN_MESSAGES exactly one message for each Scan_Error (OTHER, OTHER_ORG, NOT_FOUND, AMBIGUOUS, MISMATCH), where each message is 1 to 200 characters long after trimming whitespace and no two messages are identical.
7. IF a scan fails, THEN THE Gate_Dialog SHALL stop the camera stream, SHALL leave the machine id field of the form empty, SHALL NOT create a Gate_Record, and SHALL keep any other form values the user already entered unchanged.
8. IF a scan fails, THEN THE Gate_Dialog SHALL display a "Scan again" control that is enabled and keyboard-focusable.
9. WHEN the user activates the "Scan again" control, THE Gate_Dialog SHALL clear the displayed error message and error code and SHALL restart the QR_Scanner.
10. IF a second scan fails while an error is displayed, THEN THE Gate_Dialog SHALL replace the displayed message and error code with those of the latest Scan_Error, so that only one error is shown at a time.

### Requirement 4: Block submission without a valid scan

**User Story:** As an operations manager, I want Scan_Mode to accept only scanned machines, so that Fleet Numbers are not guessed.

#### Acceptance Criteria

1. WHILE the Gate_Dialog is in Scan_Mode and no valid scan exists, THE Gate_Dialog SHALL disable the submit control and SHALL NOT submit the gate-in when the user presses Enter in any dialog field.
2. WHEN a scan is decoded in Scan_Mode and the decoded value does not match any machine resolved by the Scan_Resolver, THE Gate_Dialog SHALL show a scan error indicating the machine was not recognised, SHALL keep the submit control disabled, SHALL leave the machine id empty, and SHALL show the "Scan again" control defined in Requirement 3.
3. WHEN a scan is decoded in Scan_Mode and the decoded value matches a machine resolved by the Scan_Resolver, THE Gate_Dialog SHALL record the scan result, set the machine id to the matched machine, clear any previous scan error, stop the camera stream, and enable the submit control.
4. WHILE the Gate_Dialog is in Scan_Mode and a valid scan exists, THE Gate_Dialog SHALL display a "Scan again" control.
5. WHEN the user activates the "Scan again" control, THE Gate_Dialog SHALL clear the scan result, the scan error and the machine id, disable the submit control, and restart the QR_Scanner.
6. WHEN the user switches from Scan_Mode to Manual_Mode, THE Gate_Dialog SHALL clear the scan result, the scan error and the machine id set by the scan, and SHALL stop the camera stream.
7. WHEN the user switches from Manual_Mode to Scan_Mode, THE Gate_Dialog SHALL clear the machine id, disable the submit control, and start the QR_Scanner.

### Requirement 5: Handle an unavailable camera

**User Story:** As a gate security officer, I want to know why scanning is not working and what to do, so that I can continue with manual entry.

#### Acceptance Criteria

1. IF `getUserMedia` rejects with a DOMException named `NotAllowedError` or `SecurityError`, THEN THE QR_Scanner SHALL stop the scan attempt, show a message that states camera permission was denied and directs the user to Manual entry, and retain any data already entered in the Gate_Dialog.
2. IF `getUserMedia` rejects with a DOMException named `NotFoundError` or `OverconstrainedError`, THEN THE QR_Scanner SHALL stop the scan attempt, show a message that states no camera was found and directs the user to Manual entry, and retain any data already entered in the Gate_Dialog.
3. IF `window.isSecureContext` is false, THEN THE QR_Scanner SHALL NOT call `getUserMedia`, SHALL show a message that states the camera needs HTTPS or localhost and directs the user to Manual entry, and SHALL retain any data already entered in the Gate_Dialog.
4. IF `navigator.mediaDevices?.getUserMedia` is undefined and `window.isSecureContext` is true, THEN THE QR_Scanner SHALL show a message that states scanning is not supported in this browser and directs the user to Manual entry, and SHALL retain any data already entered in the Gate_Dialog.
5. IF `getUserMedia` rejects with any error not covered by criteria 1 and 2, or the camera stream fails after starting, THEN THE QR_Scanner SHALL stop the scan attempt, show a generic message that states the camera could not be used and directs the user to Manual entry, and retain any data already entered in the Gate_Dialog.
6. IF more than one unavailability condition applies, THEN THE QR_Scanner SHALL show only the message for the first matching condition in this order: insecure context (criterion 3), missing `getUserMedia` (criterion 4), then the error mapping in criteria 1, 2 and 5.
7. WHILE the camera is unavailable, THE Gate_Dialog SHALL keep the control that switches to Manual_Mode visible and enabled, and WHEN the user activates it, THE Gate_Dialog SHALL switch to Manual_Mode.

### Requirement 6: Manual entry fallback

**User Story:** As a gate security officer, I want to select the Fleet Number manually when scanning fails, so that gate work is not blocked.

#### Acceptance Criteria

1. WHILE the Gate_Dialog is in Manual_Mode, THE Gate_Dialog SHALL show the existing Fleet Number dropdown listing all machines of the current org, and SHALL show no machines from any other org.
2. WHILE the Gate_Dialog is in Manual_Mode, THE Gate_Dialog SHALL NOT show input fields for date or time.
3. WHEN a Gate_Record is submitted in Manual_Mode with a Fleet Number selected and a truck plate of at least 2 characters, THE Gate_Dialog SHALL save the Gate_Record with the Capture_Method set to Manual.
4. WHEN a Gate_Record is submitted in Scan_Mode with a Fleet Number selected and a truck plate of at least 2 characters, THE Gate_Dialog SHALL save the Gate_Record with the Capture_Method set to QR.
5. IF a Gate_Record is submitted in Manual_Mode with no Fleet Number selected, THEN THE Gate_Dialog SHALL NOT save the Gate_Record, SHALL show the error "Fleet number is required" next to the Fleet Number dropdown, and SHALL retain all other entered field values.
6. IF the current org has no machines, THEN THE Gate_Dialog SHALL show the Fleet Number dropdown with no selectable options and an empty-list message, and SHALL NOT save a Gate_Record in Manual_Mode.
7. THE Gate_Dialog SHALL apply the same validation rules in Scan_Mode and Manual_Mode: truck plate of at least 2 characters (otherwise the error "Truck plate is required" is shown and the Gate_Record is not saved), and Arriving From limited to Yard, Dubai, Abu Dhabi, Taweelah, Oilfields, Fujairah, KSA or External, with Yard as the default.
8. WHEN a user opens the Gate_Page, THE Gate_Page SHALL grant access only IF `hasPageAccess('/gate')` returns true, which SHALL be the case for exactly the Gate_Roles Security, Ops Executive, Operations Manager, Executive Manager and Managing Director, and SHALL deny access to all other roles.

### Requirement 7: Authoritative server time

**User Story:** As an operations manager, I want gate timestamps to come from a trusted clock, so that a wrong device clock cannot change the record.

#### Acceptance Criteria

1. THE Server_Clock SHALL expose a single function `serverNow()` that returns an object containing an ISO 8601 UTC timestamp string `iso` and a Time_Source value `source` of either `server` or `device`.
2. WHEN `serverNow()` is called AND the Clock_Offset is missing or was cached more than 300 seconds earlier, THE Server_Clock SHALL record the device time as `sentAt`, send a HEAD request to the app's own origin with cache mode no-store and a 2-second timeout, record the device time as `receivedAt` on response, and read the HTTP `Date` response header.
3. WHEN the Server_Clock reads a valid `Date` header, THE Server_Clock SHALL compute the Clock_Offset in milliseconds as the header time minus the midpoint of `sentAt` and `receivedAt` (offset = headerTime − (sentAt + receivedAt)/2) and SHALL cache the offset for 300 seconds.
4. WHEN a valid Clock_Offset is cached, THE Server_Clock SHALL return `iso` equal to the current device time plus the Clock_Offset and `source` equal to `server`.
5. IF the HEAD request fails, does not complete within 2 seconds, or returns a missing or unparseable `Date` header, THEN THE Server_Clock SHALL return `iso` equal to the current device time and `source` equal to `device`, SHALL NOT cache a Clock_Offset, and SHALL NOT throw an error to the caller.
6. WHILE a Clock_Offset refresh request is in progress, THE Server_Clock SHALL make no additional HEAD request for concurrent `serverNow()` calls and SHALL resolve all of those calls from the result of the single in-progress request.
7. THE Server_Clock SHALL provide `computeOffset` as a pure function that takes the header time, `sentAt`, and `receivedAt` (all in milliseconds) and returns the offset in milliseconds computed as in criterion 3, without reading the device clock or modifying any state.
8. THE Server_Clock SHALL provide `resetServerClock`, which clears the cached Clock_Offset so that the next `serverNow()` call sends a new HEAD request.
9. THE Server_Clock SHALL keep the time source behind `serverNow()` so that a real API can replace it without changing the signature or return shape of `serverNow()` or any caller.
10. FOR ALL integer header times, `sentAt` values, and `receivedAt` values where `receivedAt` ≥ `sentAt`, adding the offset returned by `computeOffset` to the midpoint of `sentAt` and `receivedAt` SHALL return the header time (round-trip property). Because the `Date` header has 1-second precision, the returned `serverNow()` time SHALL be accurate to within 1,000 ms plus half the measured round-trip time (`receivedAt` − `sentAt`).

### Requirement 8: Automatic date and timestamp on the Gate_Record

**User Story:** As a gate security officer, I want the date and time recorded automatically at the scan, so that I never type them.

#### Acceptance Criteria

1. WHEN the QR_Scanner produces a valid scan in Scan_Mode, THE Gate_Dialog SHALL call `serverNow()` once and keep the returned time and Time_Source as the capture time.
2. WHEN the user submits the Gate_Dialog in Manual_Mode, THE Gate_Dialog SHALL call `serverNow()` once at the moment of submission and keep the returned time and Time_Source as the capture time. Selecting a machine SHALL NOT set the capture time.
3. IF `serverNow()` fails or returns a value that is not a valid date, THEN THE Gate_Dialog SHALL NOT create the Gate_Record, SHALL show an error indicating that the time could not be obtained, and SHALL keep the user's selection and entered data so the user can retry.
4. WHEN the Gate_Dialog builds a Gate_Record, THE Gate_Dialog SHALL read the Gate_Time_Zone from `Intl.DateTimeFormat().resolvedOptions().timeZone` and pass it to the Record_Builder as a parameter together with the capture time.
5. WHEN a Gate_Record is submitted, THE Record_Builder SHALL produce `timestamp` as an ISO 8601 UTC string of the capture time, with millisecond precision and a trailing `Z`.
6. WHEN a Gate_Record is submitted, THE Record_Builder SHALL produce `gateDate` in the format YYYY-MM-DD and `gateTime` in the 24-hour format HH:mm:ss (00:00:00 to 23:59:59), both computed from the capture time in the time zone passed as a parameter, not in UTC.
7. WHEN a Gate_Record is submitted, THE Record_Builder SHALL set `gateTimeZone` to the IANA time zone identifier that was used to compute `gateDate` and `gateTime`.
8. WHEN a Gate_Record is submitted, THE Record_Builder SHALL set `fleetNo` to the Fleet Number of the machine, using `fleetNumberOf`.
9. WHEN a Gate_Record is submitted in Scan_Mode, THE Record_Builder SHALL store the decoded QR_Payload in `qrPayload`.
10. THE Record_Builder SHALL import only types and the pure module `collectionCore.ts` and SHALL NOT use stores, DOM or window APIs, `navigator`, `fetch`, the clock, randomness or the default time zone of the environment, so that the same capture time, time zone and machine always produce the same Gate_Record. The Record_Builder MAY call `Intl.DateTimeFormat` with an explicit `timeZone` parameter.
11. FOR ALL valid capture times and valid IANA time zones, excluding local times that are ambiguous because of a daylight-saving transition, converting `gateDate` and `gateTime` from `gateTimeZone` to UTC SHALL equal `timestamp` truncated to whole seconds (round-trip property).

### Requirement 9: Store capture data in the Gate_Record

**User Story:** As an auditor, I want the fleet reference, date, timestamp, capture method and time source stored in the Gate_Record, so that each gate movement can be traced.

#### Acceptance Criteria

1. THE Gate_Record types StoredGateEntry and GateEntry SHALL each include the optional fields `fleetNo`, `timestamp`, `gateDate`, `gateTime`, `gateTimeZone`, `captureMethod`, `timeSource` and `qrPayload`.
2. WHEN a Gate_Record is submitted, THE Gate_Dialog SHALL store `fleetNo`, `timestamp`, `gateDate`, `gateTime`, `gateTimeZone`, `captureMethod` and `timeSource` in the Gate_Record, where `timestamp` is an ISO 8601 UTC string, `gateDate` and `gateTime` are the local date and time in the zone given by `gateTimeZone`, and `gateTimeZone` is an IANA time zone identifier.
3. WHEN a Gate_Record is submitted, THE Gate_Dialog SHALL generate exactly one id and exactly one reference and SHALL pass the same id and reference to both `appStore.addGateEntry` and `gateService.create`.
4. WHEN a Gate_Record is submitted with direction IN, THE Gate_Dialog SHALL set the machine status to PHI.
5. WHEN a Gate_Record is submitted with direction OUT, THE Gate_Dialog SHALL set the machine status to On Hire.
6. WHEN the Gate_Page opens an existing Gate_Record that lacks any of the optional fields in criterion 1, THE Gate_Page SHALL display a dash ("-") in place of each missing value, except for the gate date and gate time rows, which follow Requirement 12 criteria 3 to 5, and SHALL display every present value unchanged.
7. WHEN `gateService.create` receives an id and a reference from the Gate_Dialog, THE Gate_Service SHALL store the Gate_Record with that exact id and that exact reference, regardless of the order in which defaults and supplied data are applied.
8. WHEN `gateService.create` receives no id or no reference, THE Gate_Service SHALL generate the missing value and SHALL store it in the Gate_Record.
9. WHEN `gateService.create` stores a Gate_Record, THE Gate_Service SHALL set the status to `Pending`, regardless of any status value supplied.

### Requirement 10: Direction rule and non-hire warning

**User Story:** As a gate security officer, I want the direction chosen the same way as before, so that gate flow stays predictable.

#### Acceptance Criteria

1. WHEN the user submits the Gate_Dialog and the current status of the machine, read at the moment of submission, is On Hire, THE Gate_Dialog SHALL set the direction of the Gate_Record to IN.
2. WHEN the user submits the Gate_Dialog and the current status of the machine, read at the moment of submission, is any status other than On Hire, THE Gate_Dialog SHALL set the direction of the Gate_Record to OUT.
3. WHEN a valid scan resolves to a machine whose current status is not On Hire, THE Gate_Dialog SHALL display a warning stating that the machine is not On Hire and that the Gate_Record will be a Gate-Out.
4. WHILE the non-hire warning is displayed, THE Gate_Dialog SHALL keep the submit control enabled and SHALL NOT require the user to acknowledge or dismiss the warning before submitting.
5. WHEN a valid scan resolves to a machine whose current status is On Hire, THE Gate_Dialog SHALL display no non-hire warning.
6. WHEN the scan result is replaced by a different valid scan or is cleared, THE Gate_Dialog SHALL remove any displayed non-hire warning and SHALL show a warning only if the newly resolved machine is not On Hire.
7. IF reading the machine status through `appStore.getMachineCurrentStatus` throws an error at scan resolution or at submission, THEN THE Gate_Dialog SHALL show an error that the machine status is unavailable, SHALL NOT create the Gate_Record, and SHALL keep the data already entered.

### Requirement 11: Mark the Collection Note as Collected

**User Story:** As a collections coordinator, I want the Collection Note updated when the machine enters the gate, so that I can see the machine has arrived.

#### Acceptance Criteria

1. WHEN a Gate_Record with direction IN is saved successfully, THE Gate_Dialog SHALL call `markCollectedForMachine` in `collectionDocs.ts` with the Gate_Record's org, machine, gate entry id, gate reference and gate timestamp, and that function SHALL set the status of exactly one Collection_Note to Collected, namely the Open_Collection_Note for that machine and org with the latest `createdAt`, and SHALL store the gate entry id, gate reference and gate timestamp on that note as `collectedByGateId`, `collectedByGateRef` and `collectedAt`.
2. WHEN `markCollectedForMachine` sets a Collection_Note to Collected, THE Gate_Dialog SHALL display a success toast that contains the Collection_Note number of the Collection_Note marked Collected.
3. WHEN a Gate_Record with direction IN is saved successfully and the machine has no Open_Collection_Note in the same org, THE Gate_Dialog SHALL leave all Collection_Notes unchanged and SHALL NOT display a Collection_Note toast.
4. WHEN two or more Open_Collection_Notes for the same machine and org have the same latest `createdAt`, THE pickNoteToCollect function SHALL select the one that appears first in the input list, so that the choice is deterministic.
5. WHEN a Gate_Record with direction OUT is saved successfully, THE Gate_Dialog SHALL NOT call `markCollectedForMachine` and SHALL leave all Collection_Notes unchanged.
6. THE `markCollectedForMachine` function SHALL leave every Collection_Note of other machines, every Collection_Note of other orgs, and every Collection_Note of the same machine and org other than the selected one unchanged.
7. THE `markCollectedForMachine` function SHALL select the Collection_Note to update through `pickNoteToCollect(notes, orgId, machineId)` and SHALL apply the update, including the Collection_Gate_Link fields (`collectedByGateId`, `collectedByGateRef`, `collectedAt`), through `collectionStore.patch`.
8. FOR ALL lists of Collection_Notes, orgs and machines, WHEN `pickNoteToCollect` is applied and the selected Collection_Note is then set to Collected, THE result SHALL contain that Collection_Note with status Collected, SHALL leave every other Collection_Note unchanged, and SHALL NOT select a Collection_Note that is not an Open_Collection_Note.
9. FOR ALL lists of Collection_Notes containing at most one Open_Collection_Note for a given machine and org, applying `markCollectedForMachine` twice for that machine and org SHALL give the same result as applying it once (idempotence property). WHERE two or more Open_Collection_Notes exist, each application SHALL collect exactly one further Open_Collection_Note, in descending `createdAt` order.
10. IF a Gate_Record submission fails, THEN THE Gate_Dialog SHALL NOT call `markCollectedForMachine`, SHALL leave all Collection_Notes unchanged, and SHALL display an error indication.
11. IF `markCollectedForMachine` fails after the Gate_Record is saved, THEN THE Gate_Dialog SHALL keep the saved Gate_Record, SHALL leave all Collection_Notes unchanged, and SHALL display an error indication that the Collection_Note was not updated.

### Requirement 12: Display capture data on the Gate_Page

**User Story:** As a gate supervisor, I want to see how and when each gate movement was captured, so that I can review it.

#### Acceptance Criteria

1. WHEN a user opens a Gate_Record in the Gate_Page detail panel, THE Gate_Page SHALL display the Fleet Number, gate date, gate time, Capture_Method and Time_Source as separate labelled rows.
2. WHEN a user opens a Gate_Record in the Gate_Page detail panel, THE Gate_Page SHALL display the gate date and gate time in 24-hour HH:mm:ss format together with the time zone identifier of the Gate_Record's `gateTimeZone`.
3. WHEN a user opens a Gate_Record in the Gate_Page detail panel, THE Gate_Page SHALL use the stored `gateDate` and `gateTime` when both are present; otherwise THE Gate_Page SHALL derive the gate date and gate time from the `timestamp` value; otherwise THE Gate_Page SHALL derive them from the `createdAt` value.
4. IF a Gate_Record has no stored `gateDate` and `gateTime`, no `timestamp` and no `createdAt` value, or the value used for derivation cannot be parsed as a date-time, THEN THE Gate_Page SHALL display "Not available" in the gate date and gate time rows, and SHALL display the remaining rows unchanged.
5. IF a Gate_Record has no `gateTimeZone` value or an unrecognised one, THEN THE Gate_Page SHALL display the gate date and gate time derived from `timestamp` or `createdAt` in UTC and SHALL label the time zone as UTC. IF such a Gate_Record has stored `gateDate` and `gateTime` but no usable `timestamp` or `createdAt`, THEN THE Gate_Page SHALL display the stored values with the time zone label "Unknown".
6. WHEN the Time_Source of a Gate_Record is device, THE Gate_Page SHALL display the Time_Source row with the text "Device time" next to the gate time.
7. WHEN the Capture_Method of a Gate_Record is QR, THE Gate_Page SHALL display the stored QR_Payload in full, as text, in a separate labelled row.
8. IF the Capture_Method of a Gate_Record is QR and the stored QR_Payload is empty or absent, THEN THE Gate_Page SHALL display "Not available" in the QR_Payload row.

### Requirement 13: Packaging and architecture constraints

**User Story:** As a maintainer, I want the feature to follow project rules, so that the build and tests stay reliable.

#### Acceptance Criteria

1. THE project SHALL list jsqr under `dependencies`, and not under `devDependencies`, in `package.json`.
2. THE project SHALL include an architecture test that fails IF `gateCore.ts` contains a non-type import from any module other than `collectionCore.ts`, any `require` call, or any dynamic `import()` expression, and that fails IF `collectionCore.ts` itself contains a non-type import.
3. THE project SHALL include an architecture test that fails IF `serverClock.ts` imports from any store module.
4. THE existing test `GatePassDialog.test.tsx` SHALL continue to pass with zero failing tests.
5. THE feature SHALL include property-based tests written with fast-check for the properties stated in Requirements 2, 7, 8 and 11, with each property in at least one test that runs at least 100 generated cases.
6. WHEN final verification is run, THE project SHALL satisfy all of the following: `tsc -b` exits with code 0; all vitest tests pass with zero failures; ESLint reports no new errors on the files touched by this feature compared with the baseline before the feature; `git status` shows no changed, added or deleted file under `odoo/`; the current branch is `feature/crm-plugin`; no commit has been added to `feature/crm-plugin` by this feature's work.

### Requirement 14: Gate records work for every company

**User Story:** As a user of any company, I want my gate records stored per company and kept after a page reload, so that the Gate Operations app works for my company and not only for the demo account.

#### Acceptance Criteria

1. WHEN a Gate_Record is created, THE Gate_Dialog SHALL store the Gate_Record in the Gate_Store with `orgId` equal to the orgId of the current Company (`useAuthStore` user `orgId`, or `org-ja` if the user has no `orgId`).
2. THE Gate_Store SHALL persist Gate_Records, each with an `orgId`, in browser storage in a persisted zustand store (the existing appStore or a dedicated gate store), so that every stored Gate_Record, including its status, is available unchanged after a page reload.
3. WHEN the Gate_Page loads, THE Gate_Page SHALL list the Gate_Records of the current Company in this order: first, the Gate_Store records whose `orgId` equals the current orgId, sorted by `createdAt` descending (newest first); then, the Gate_Seed_Records returned by `gateEntriesForOrg` for the current orgId, excluding any Gate_Seed_Record whose `id` equals the `id` of a Gate_Store record of the current Company.
4. THE Gate_Page SHALL NOT display any Gate_Record whose `orgId` differs from the current orgId.
5. THE QR_Scanner and the Manual_Mode dropdown SHALL resolve Fleet Numbers only against the machines of the current Company, and IF a Fleet Number does not match a machine of the current Company, THEN THE QR_Scanner SHALL reject the scan, show an error indicating the Fleet Number is not found for this Company, and create no Gate_Record.
6. WHEN the user approves or completes a Gate_Record that exists in the Gate_Store, THE Gate_Page SHALL update the status of that Gate_Record in the Gate_Store, so that the new status is shown after a page reload.
7. WHEN the user approves or completes a Gate_Seed_Record that has no Gate_Store record with the same `id`, THE Gate_Page SHALL copy that Gate_Seed_Record into the Gate_Store with the current orgId and the new status, so that the new status is shown after a page reload and the list shows the record once.
8. THE Gate_Operations_App SHALL allow any signed-in user of any Company to create, list, approve and complete Gate_Records, without requiring the orgId `org-ja` or a demo account.
9. WHEN the Gate_Store loads a Legacy_Gate_Record that has no `orgId`, THE Gate_Store SHALL set its `orgId` to `org-ja`, persist the change, and leave all other fields of the record unchanged.
10. FOR ALL sets of Gate_Records belonging to two different Companies, listing the Gate_Records of one Company SHALL return none of the Gate_Records of the other Company (isolation property).

### Requirement 15: Per-company demo gate data

**User Story:** As a user of any company, I want demo gate data in my company, so that I can follow the exact gate flow from a delivery through a Collection Note scan.

#### Acceptance Criteria

1. WHEN the Gate_Operations_App data is loaded for a Company and that Company has no Gate_Seed_Marker, THE Gate_Demo_Seeder SHALL run `ensureGateDemo(orgId)` once, called from `ensureHireLinkDemo` for every Company including org-ja and from the gate list, SHALL create the Gate_Seed_Records of that Company, and SHALL record one Gate_Seed_Marker per Gate_Seed_Record in that Company.
2. WHEN `ensureGateDemo(orgId)` creates the Gate-Out Gate_Record for the Demo_Machine J105 (id `ge-demo-<orgId>-1`, reference `GP-DEMO-1`), THE Gate_Demo_Seeder SHALL set its status to Completed, its reason to delivery to the customer MNO Company LLC under booking bk-demo-5, its `captureMethod` to Manual, its `gateTimeZone` to 'Asia/Dubai', and its `timestamp` to a fixed value at least 1 day and at most 7 days before the hire start date of booking bk-demo-5.
3. WHEN `ensureGateDemo(orgId)` creates the Gate-In Gate_Record for the Demo_Machine J104 (id `ge-demo-<orgId>-2`, reference `GP-DEMO-2`), THE Gate_Demo_Seeder SHALL set its status to Completed, its `captureMethod` to QR, its `qrPayload` to the `buildQrPayload` result of J104 in that Company, its `timeSource` to server, its `gateTimeZone` to 'Asia/Dubai', and its `gateDate` and `gateTime` to fixed values on the date of Collection_Note CN-2026-0002 (2026-11-28), with `gateTime` in `HH:mm:ss` format and its `timestamp` consistent with those values.
4. WHEN the Gate_Demo_Seeder creates the Gate-In Gate_Record for J104, IF the `collectedByGateId`, `collectedByGateRef` and `collectedAt` fields of Collection_Note CN-2026-0002 are all empty, THEN THE Gate_Demo_Seeder SHALL set them to the id, the reference and the `timestamp` of that Gate_Record, and IF any of the three fields is non-empty, THEN THE Gate_Demo_Seeder SHALL leave all three unchanged.
5. THE Gate_Demo_Seeder SHALL NOT change the status of the Demo_Machine J105 (On Hire) and SHALL NOT change any field of the Collection_Note CN-2026-0001 (open), so that a Gate-In scan of the QR_Payload of CN-2026-0001 sets CN-2026-0001 to Collected and sets J105 to PHI.
6. WHEN `ensureGateDemo(orgId)` creates the Gate-Out Gate_Record for the Demo_Machine J101 (id `ge-demo-<orgId>-3`, reference `GP-DEMO-3`), THE Gate_Demo_Seeder SHALL set its status to Pending, its `gateTimeZone` to 'Asia/Dubai', and a fixed `timestamp`, so that the user can approve and complete it.
7. THE Gate_Demo_Seeder SHALL assign each Gate_Seed_Record an id of the form `ge-demo-<orgId>-<n>` and a reference of the form `GP-DEMO-<n>`, where `<n>` is the integer sequence number (1 to 3) of the record, numbered per Company, and SHALL resolve the Demo_Machine of each record by id `mc-<N>` for org-ja and `mc-demo-<N>` for every other Company, where J10`<N>` is the machine name.
8. WHEN the Gate_Demo_Seeder runs again for a Company that has a Gate_Seed_Marker for a Gate_Seed_Record, THE Gate_Demo_Seeder SHALL create no additional Gate_Record for that Gate_Seed_Record and SHALL make no change to any existing record (idempotence property).
9. IF the user deleted a Gate_Seed_Record, THEN THE Gate_Demo_Seeder SHALL NOT create that Gate_Seed_Record again, because its Gate_Seed_Marker exists.
10. IF the Demo_Machine required for a Gate_Seed_Record is missing in the Company, THEN THE Gate_Demo_Seeder SHALL skip that Gate_Seed_Record without recording a Gate_Seed_Marker for it, SHALL create the other Gate_Seed_Records, and SHALL NOT raise an error.
11. THE Gate_Demo_Seeder SHALL leave every Gate_Record created by a user, and every other record not listed in this Requirement, unchanged, with the only permitted change being the fields named in criterion 4.

### Requirement 16: Gate operations only in the Gate Operations app

**User Story:** As an operations manager, I want every gate operation done only in the Gate Operations app, so that gate status and Collection Note status always come from a real gate movement.

#### Acceptance Criteria

1. THE Collection_Note_Detail SHALL NOT include Collected among the options of its status selector.
2. THE Collection_Note_Detail SHALL show the hint "Collected is set automatically at Gate-In in Gate Operations" next to the status selector.
3. WHILE a Collection_Note has status Collected, THE Collection_Note_Detail SHALL show that status as read-only and SHALL offer Closed as the only selectable status change.
4. WHILE a Collection_Note has status Draft or Scheduled, THE Collection_Note_Detail SHALL offer only Draft and Scheduled as selectable statuses and SHALL NOT offer Closed.
5. WHILE a Collection_Note has status Collected and the Collection_Gate_Link is present, THE Collection_Note_Detail SHALL show the gate reference and the collection time `collectedAt`.
6. WHEN `markCollectedForMachine` sets a Collection_Note to Collected, THE Collection_Store SHALL store `collectedByGateId`, `collectedByGateRef` and `collectedAt` on that Collection_Note.
7. THE Gate_Dialog SHALL be the only component that sets a Collection_Note to Collected, and it SHALL do so only when a Gate-In is completed.
8. THE Fleet, Collection Note, Planner, Transport and Dashboard apps SHALL create, approve and complete no Gate_Record, and SHALL make no machine status change that results from a Gate_Record (IN to PHI, OUT to On Hire).
9. WHERE an app other than the Gate_Operations_App shows a link or shortcut to `/gate`, THE app SHALL open the Gate_Operations_App without performing a Gate_Operation.
10. THE project SHALL include an architecture test that fails IF any file outside `src/features/gate` imports `GatePassDialog`, `useCreateGateEntry`, `useApproveGateEntry` or `useCompleteGateEntry`, or calls `addGateEntry` or `updateGateEntry`, and the test SHALL exclude test files and the definition files `src/hooks/useQueries.ts`, `src/services/services.ts` and the file in `src/store` that defines `addGateEntry` and `updateGateEntry` (`appStore.ts` or the gate store).
11. THE project SHALL include an architecture test that fails IF any file outside `src/features/gate` and `src/services` sets a Collection_Note status to Collected, and the test SHALL exclude test files.
12. THE architecture test in criterion 11 SHALL permit status changes to Collected inside `src/services` only in `markCollectedForMachine` in `collectionDocs.ts` and in the demo seed modules (`demoSeed` and other demo modules), which MAY create gate seed records and link them to CN-2026-0002.
