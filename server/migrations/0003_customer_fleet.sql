-- 0003: customers, machine_models, machines, machine_documents (DATABASE_DESIGN.md section 3.2).
-- machine_documents.file_id is a plain column here; its foreign key to files is added in 0008.

CREATE TABLE customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  customer_code       text NOT NULL,
  fleet_log_code      text,
  name                text NOT NULL,
  tax_registration_no text,
  attn                text,
  email               text,
  phone               text NOT NULL,
  address             text NOT NULL,
  billing_address     text,
  credit_limit        numeric(20,6) NOT NULL DEFAULT 0,
  credit_hold         boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'ACTIVE',
  branch_id           uuid,
  ani_ravali_active   boolean NOT NULL DEFAULT false,
  crm_ha_reference    text,
  notes               text,
  custom_attributes   jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  row_version         bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_customers_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_customers_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_customers_code UNIQUE (org_id, customer_code),
  CONSTRAINT uq_customers_fleet_log_code UNIQUE (org_id, fleet_log_code),
  CONSTRAINT fk_customers_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT ck_customers_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLACKLISTED')),
  CONSTRAINT ck_customers_credit_limit CHECK (credit_limit >= 0),
  CONSTRAINT ck_customers_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_customers_custom_attributes CHECK (jsonb_typeof(custom_attributes) = 'object'),
  CONSTRAINT ck_customers_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('customers');
CREATE INDEX ix_customers_org_status ON customers (org_id, status);
CREATE INDEX ix_customers_org_name ON customers (org_id, lower(name));

CREATE TABLE machine_models (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  make               text NOT NULL,
  model              text NOT NULL,
  category           text NOT NULL,
  power_source       text,
  platform_height_m  numeric(12,3),
  working_height_m   numeric(12,3),
  capacity_kg        numeric(14,3),
  specifications     jsonb NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  row_version        bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_machine_models_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_machine_models_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_machine_models_make_model UNIQUE (org_id, make, model),
  CONSTRAINT ck_machine_models_dimensions CHECK (
    (platform_height_m IS NULL OR platform_height_m >= 0)
    AND (working_height_m IS NULL OR working_height_m >= 0)
    AND (capacity_kg IS NULL OR capacity_kg >= 0)),
  CONSTRAINT ck_machine_models_specifications CHECK (jsonb_typeof(specifications) = 'object'),
  CONSTRAINT ck_machine_models_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('machine_models');

CREATE TABLE machines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  branch_id           uuid NOT NULL,
  model_id            uuid NOT NULL,
  asset_no            text NOT NULL,
  fleet_no            text NOT NULL,
  serial_no           text NOT NULL,
  manufacture_year    smallint,
  power_source        text,
  platform_height_m   numeric(12,3),
  working_height_m    numeric(12,3),
  capacity_kg         numeric(14,3),
  hours_operated      numeric(18,3) NOT NULL DEFAULT 0,
  operational_status  text NOT NULL DEFAULT 'Available',
  readiness_status    text NOT NULL DEFAULT 'READY',
  current_location    text NOT NULL,
  last_inspection_on  date,
  next_inspection_on  date,
  next_phi_on         date,
  next_mandatory_on   date,
  tpc_expires_on      date,
  tpc_supplier        text,
  active              boolean NOT NULL DEFAULT true,
  custom_attributes   jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  row_version         bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_machines_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_machines_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_machines_asset_no UNIQUE (org_id, asset_no),
  CONSTRAINT uq_machines_fleet_no UNIQUE (org_id, fleet_no),
  CONSTRAINT uq_machines_serial_no UNIQUE (org_id, serial_no),
  CONSTRAINT fk_machines_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT fk_machines_model FOREIGN KEY (org_id, model_id) REFERENCES machine_models (org_id, id),
  CONSTRAINT ck_machines_operational_status CHECK (operational_status IN
    ('Available', 'Allocated', 'On Hire', 'Under Repair', 'In Workshop', 'PDI', 'PHI', 'Transport', 'Breakdown', 'Offline')),
  CONSTRAINT ck_machines_readiness_status CHECK (readiness_status IN ('READY', 'INTAKE_PENDING', 'BLOCKED')),
  CONSTRAINT ck_machines_manufacture_year CHECK (manufacture_year IS NULL OR manufacture_year BETWEEN 1900 AND 2200),
  CONSTRAINT ck_machines_hours CHECK (hours_operated >= 0),
  CONSTRAINT ck_machines_dimensions CHECK (
    (platform_height_m IS NULL OR platform_height_m >= 0)
    AND (working_height_m IS NULL OR working_height_m >= 0)
    AND (capacity_kg IS NULL OR capacity_kg >= 0)),
  CONSTRAINT ck_machines_custom_attributes CHECK (jsonb_typeof(custom_attributes) = 'object'),
  CONSTRAINT ck_machines_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('machines');
CREATE INDEX ix_machines_org_status ON machines (org_id, operational_status);
CREATE INDEX ix_machines_org_readiness ON machines (org_id, readiness_status);
CREATE INDEX ix_machines_org_active ON machines (org_id, active);

CREATE TABLE machine_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  machine_id    uuid NOT NULL,
  file_id       uuid NOT NULL,
  name          text NOT NULL,
  document_type text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  expires_on    date,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  row_version   bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_machine_documents_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_machine_documents_org_id UNIQUE (org_id, id),
  CONSTRAINT fk_machine_documents_machine FOREIGN KEY (org_id, machine_id) REFERENCES machines (org_id, id),
  CONSTRAINT ck_machine_documents_type CHECK (document_type IN ('Registration', 'Insurance', 'Certificate', 'Manual', 'Permit')),
  CONSTRAINT ck_machine_documents_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('machine_documents');
CREATE INDEX ix_machine_documents_file ON machine_documents (org_id, file_id);
CREATE INDEX ix_machine_documents_expiry ON machine_documents (org_id, expires_on) WHERE active;

SELECT fleet_create_fk_indexes();
