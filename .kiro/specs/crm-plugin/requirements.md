# Requirements Document

## Introduction

The CRM plugin adds a quotation pipeline to the AxleOps React app (fleet_overall). Each quotation moves through four phases: Awaiting, Tender, Lost and Won. Phase data is held in a mock service backed by a persisted store, so a phase survives a page refresh. The plugin is registered as an app with id `crm`, following the conventions of `src/constants/apps.ts`, `appSchemas.ts`, `appPresets.ts` and `src/features/apps`. Odoo CRM serves only as a visual and layout reference. No Odoo addon changes are in scope. The Odoo field mapping is documented only.

## Glossary

- **CRM_Plugin**: The AxleOps app with id `crm` that manages quotations and their phases.
- **Quotation**: A hire quotation record created for a customer.
- **Phase**: The state of a Quotation. One of Awaiting, Tender, Lost or Won.
- **Awaiting**: A Quotation that has been created and is awaiting a customer response.
- **Tender**: A Quotation that has been submitted and is under customer evaluation.
- **Lost**: An inactive Quotation that did not proceed.
- **Won**: A Quotation that the customer accepted and that is converted to a hire.
- **Active_Pipeline**: The pipeline view showing Quotations in the Awaiting and Tender phases.
- **Lost_Tab**: The dedicated tab that lists Lost Quotations.
- **Won_View**: The dedicated view that lists Won Quotations, separate from the Active_Pipeline.
- **Quotation_Store**: The persisted client-side store (localStorage-backed) that holds Quotations and Phase history.
- **Quotation_Service**: The mock service that reads and writes Quotations through the Quotation_Store.
- **Phase_History**: The ordered list of Phase changes of a Quotation, each with timestamp, user, from-Phase, to-Phase and reason.
- **Lost_Reason**: A required text or selected reason recorded when a Quotation becomes Lost.
- **Reopen**: The action that moves a Lost Quotation back to Awaiting.
- **CRM_User**: An authenticated user with access to the CRM_Plugin.
- **Invoicing**: The existing `invoice` app flow for customer invoices.
- **Odoo_Mapping_Document**: A markdown document in the spec folder that maps CRM_Plugin fields to Odoo CRM fields.

## Requirements

### Requirement 1: Plugin Registration

**User Story:** As an administrator, I want the CRM plugin registered like other apps, so that I can activate it from the Apps screen.

#### Acceptance Criteria

1. THE CRM_Plugin SHALL be registered in `src/constants/apps.ts` with id `crm`, a name, a summary, an icon, a category, paths and labels.
2. WHEN a company activates the CRM_Plugin, THE CRM_Plugin SHALL show its sidebar pages.
3. WHEN a company deactivates the CRM_Plugin, THE CRM_Plugin SHALL hide its sidebar pages and keep its stored Quotations.
4. THE CRM_Plugin SHALL provide a default schema in `src/constants/appSchemas.ts` and presets in `src/constants/appPresets.ts` for the `crm` app id.
5. WHERE the CRM_Plugin declares dependencies, THE CRM_Plugin SHALL declare the `customer_ani` and `invoice` apps as dependencies.

### Requirement 2: Four Quotation Phases

**User Story:** As a CRM user, I want every Quotation to have one of four phases, so that I can see where each quotation stands.

#### Acceptance Criteria

1. THE CRM_Plugin SHALL support exactly four Phases: Awaiting, Tender, Lost and Won.
2. WHEN a CRM_User creates a Quotation, THE Quotation_Service SHALL set the Phase of the Quotation to Awaiting.
3. THE CRM_Plugin SHALL display the Phase of each Quotation in the Active_Pipeline, the Lost_Tab and the Won_View.
4. THE CRM_Plugin SHALL show the Awaiting, Tender, Lost and Won Phases as selectable and visible options in the CRM user interface.

### Requirement 3: Phase Transitions

**User Story:** As a CRM user, I want controlled phase transitions, so that quotations follow a valid lifecycle.

#### Acceptance Criteria

1. WHEN a CRM_User moves an Awaiting Quotation to Tender, THE Quotation_Service SHALL set the Phase to Tender.
2. WHEN a CRM_User moves an Awaiting Quotation to Lost with a Lost_Reason, THE Quotation_Service SHALL set the Phase to Lost.
3. WHEN a CRM_User moves a Tender Quotation to Won, THE Quotation_Service SHALL set the Phase to Won.
4. WHEN a CRM_User moves a Tender Quotation to Lost with a Lost_Reason, THE Quotation_Service SHALL set the Phase to Lost.
5. IF a requested Phase change is not one of Awaiting to Tender, Awaiting to Lost, Tender to Won, Tender to Lost or Lost to Awaiting through Reopen, THEN THE Quotation_Service SHALL reject the change and keep the current Phase.
6. IF a Phase change is rejected, THEN THE CRM_Plugin SHALL display an error message that names the current Phase and the requested Phase.
7. WHEN a Phase change succeeds, THE Quotation_Service SHALL append an entry to the Phase_History with timestamp, user, from-Phase and to-Phase.

### Requirement 4: Lost Reason

**User Story:** As a sales manager, I want a reason recorded when a quotation is lost, so that I can analyse why we lose work.

#### Acceptance Criteria

1. WHEN a CRM_User moves a Quotation to Lost, THE CRM_Plugin SHALL prompt for a Lost_Reason.
2. THE CRM_Plugin SHALL offer a default list of Lost_Reason options that includes Price too high, Competitor chosen, Project cancelled, No response and Other.
3. IF a CRM_User submits a move to Lost with an empty Lost_Reason, THEN THE Quotation_Service SHALL reject the change and keep the current Phase.
4. WHEN a Quotation becomes Lost, THE Quotation_Service SHALL store the Lost_Reason on the Quotation and in the Phase_History entry.

### Requirement 5: Reopen Lost Quotation

**User Story:** As a CRM user, I want to reopen a lost quotation, so that I can recover opportunities that become active again.

#### Acceptance Criteria

1. WHILE a Quotation is in the Lost Phase, THE CRM_Plugin SHALL offer a Reopen action to every CRM_User.
2. WHEN a CRM_User submits Reopen with a non-empty reason, THE Quotation_Service SHALL set the Phase to Awaiting.
3. IF a CRM_User submits Reopen with an empty reason, THEN THE Quotation_Service SHALL reject the change and keep the Phase as Lost.
4. WHEN a Quotation is reopened, THE Quotation_Service SHALL record the reopen reason, user and timestamp in the Phase_History.
5. WHEN a Quotation is reopened, THE CRM_Plugin SHALL show the Quotation in the Active_Pipeline.

### Requirement 6: Lost Leaves Active Pipeline

**User Story:** As a CRM user, I want lost quotations removed from the active flow, so that the pipeline shows only live opportunities.

#### Acceptance Criteria

1. WHEN a Quotation becomes Lost, THE CRM_Plugin SHALL remove the Quotation from the Active_Pipeline immediately, without a page refresh.
2. THE Active_Pipeline SHALL list only Quotations in the Awaiting and Tender Phases.
3. THE CRM_Plugin SHALL exclude Lost Quotations from Active_Pipeline counts and totals.

### Requirement 7: Lost Tab

**User Story:** As a CRM user, I want a dedicated Lost tab, so that I can review and search lost quotations.

#### Acceptance Criteria

1. THE Lost_Tab SHALL list every Quotation in the Lost Phase.
2. THE Lost_Tab SHALL display, for each Lost Quotation, the quotation number, customer, amount, Lost_Reason, date lost and the user who marked the Quotation Lost.
3. WHEN a CRM_User enters search text in the Lost_Tab, THE Lost_Tab SHALL list only Lost Quotations whose quotation number, customer or Lost_Reason contains the text, ignoring case.
4. WHEN a CRM_User selects a Lost Quotation, THE CRM_Plugin SHALL display its key details and Phase_History.
5. WHILE no Quotation is Lost, THE Lost_Tab SHALL display an empty-state message.

### Requirement 8: Won View and Invoicing

**User Story:** As a CRM user, I want won quotations in a separate view and a path to invoicing, so that accepted hires can be billed.

#### Acceptance Criteria

1. THE Won_View SHALL list every Quotation in the Won Phase and be separate from the Active_Pipeline.
2. WHEN a Quotation becomes Won, THE CRM_Plugin SHALL remove the Quotation from the Active_Pipeline immediately.
3. WHILE a Quotation is in the Won Phase, THE CRM_Plugin SHALL offer a Proceed to invoicing action.
4. WHEN a CRM_User selects Proceed to invoicing, THE CRM_Plugin SHALL open the Invoicing flow with the customer, amount and quotation number prefilled.
5. WHERE the `invoice` app is inactive, THE CRM_Plugin SHALL disable the Proceed to invoicing action and show a message that the Invoice app must be activated.

### Requirement 9: Phase Persistence

**User Story:** As a CRM user, I want phases to persist, so that a page refresh never changes quotation state.

#### Acceptance Criteria

1. WHEN a Quotation is created or its Phase changes, THE Quotation_Store SHALL persist the Quotation and its Phase_History to localStorage.
2. WHEN the application reloads, THE Quotation_Store SHALL restore all Quotations with the same Phase, Lost_Reason and Phase_History as before the reload.
3. IF persisted data cannot be parsed, THEN THE Quotation_Store SHALL load seed demo Quotations and log a warning.
4. THE Quotation_Service SHALL read and write Quotations only through the Quotation_Store.
5. THE Quotation_Store SHALL include seed demo Quotations in each of the four Phases on first load.

### Requirement 10: Odoo-Style Pipeline Interface

**User Story:** As a CRM user, I want a pipeline interface similar to Odoo CRM, so that the layout is familiar.

#### Acceptance Criteria

1. THE CRM_Plugin SHALL present the Active_Pipeline as a kanban board with one column for Awaiting and one column for Tender.
2. WHEN a CRM_User drags a card to the other column, THE CRM_Plugin SHALL request the corresponding Phase change through the Quotation_Service.
3. THE CRM_Plugin SHALL provide a list view of Quotations with Phase filter and text search.
4. THE CRM_Plugin SHALL use original code and components from the AxleOps codebase, with no code copied from Odoo.

### Requirement 11: Odoo Field Mapping Documentation

**User Story:** As a developer, I want the Odoo field mapping documented, so that a later Odoo integration can reuse the data model.

#### Acceptance Criteria

1. THE Odoo_Mapping_Document SHALL map each Quotation field to an Odoo CRM or sale field, including the Phase to Odoo stage mapping and Lost_Reason to `lost_reason_id`.
2. THE CRM_Plugin SHALL leave all files under the Odoo addons directory unchanged.
