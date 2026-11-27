-- 0004: quotations, quotation_phase_history (append-only), hire_agreements, customer_lpos
-- (DATABASE_DESIGN.md section 3.3). customer_lpos.file_id gets its foreign key in 0008.

CREATE TABLE quotations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  branch_id         uuid,
  customer_id       uuid NOT NULL,
  quotation_no      text NOT NULL,
  opportunity       text NOT NULL,
  email             text,
  crm_ha_reference  text,
  amount            numeric(20,6) NOT NULL,
  currency_code     char(3) NOT NULL,
  phase             text NOT NULL DEFAULT 'AWAITING',
  sales_user_id     uuid,
  valid_until       date,
  lost_reason       text,
  lost_at           timestamptz,
  lost_by           uuid,
  won_at            timestamptz,
  notes             text,
  custom_attributes jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  row_version       bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_quotations_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_quotations_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_quotations_no UNIQUE (org_id, quotation_no),
  -- Lets children prove "same customer as the quotation" with a composite foreign key.
  CONSTRAINT uq_quotations_org_id_customer UNIQUE (org_id, id, customer_id),
  CONSTRAINT fk_quotations_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT fk_quotations_customer FOREIGN KEY (org_id, customer_id) REFERENCES customers (org_id, id),
  CONSTRAINT fk_quotations_sales_user FOREIGN KEY (org_id, sales_user_id) REFERENCES users (org_id, id),
  CONSTRAINT fk_quotations_lost_by FOREIGN KEY (org_id, lost_by) REFERENCES users (org_id, id),
  CONSTRAINT ck_quotations_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_quotations_amount CHECK (amount >= 0),
  CONSTRAINT ck_quotations_phase CHECK (phase IN ('AWAITING', 'TENDER', 'LOST', 'WON')),
  CONSTRAINT ck_quotations_lost_reason CHECK (lost_reason IS NULL OR char_length(btrim(lost_reason)) BETWEEN 1 AND 500),
  CONSTRAINT ck_quotations_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_quotations_custom_attributes CHECK (jsonb_typeof(custom_attributes) = 'object'),
  CONSTRAINT ck_quotations_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('quotations');
CREATE INDEX ix_quotations_org_phase ON quotations (org_id, phase);
CREATE INDEX ix_quotations_org_created ON quotations (org_id, created_at DESC);

-- Append-only: fleet_app is granted SELECT and INSERT only (0010).
CREATE TABLE quotation_phase_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  quotation_id  uuid NOT NULL,
  from_phase    text,
  to_phase      text NOT NULL,
  actor_user_id uuid,
  reason        text,
  source        text NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  source_key    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  CONSTRAINT fk_quotation_phase_history_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_quotation_phase_history_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_quotation_phase_history_source_key UNIQUE (org_id, source_key),
  CONSTRAINT fk_quotation_phase_history_quotation FOREIGN KEY (org_id, quotation_id) REFERENCES quotations (org_id, id),
  CONSTRAINT fk_quotation_phase_history_actor FOREIGN KEY (org_id, actor_user_id) REFERENCES users (org_id, id),
  CONSTRAINT ck_quotation_phase_history_from CHECK (from_phase IS NULL OR from_phase IN ('AWAITING', 'TENDER', 'LOST', 'WON')),
  CONSTRAINT ck_quotation_phase_history_to CHECK (to_phase IN ('AWAITING', 'TENDER', 'LOST', 'WON')),
  CONSTRAINT ck_quotation_phase_history_source CHECK (source IN ('MANUAL', 'ON_HIRE', 'SYSTEM')),
  -- Creation has a null from_phase and an AWAITING target.
  CONSTRAINT ck_quotation_phase_history_creation CHECK (from_phase IS NOT NULL OR to_phase = 'AWAITING'),
  -- Moving to LOST and reopening from LOST both require a reason.
  CONSTRAINT ck_quotation_phase_history_reason CHECK (
    (to_phase <> 'LOST' AND from_phase IS DISTINCT FROM 'LOST')
    OR (reason IS NOT NULL AND char_length(btrim(reason)) BETWEEN 1 AND 500))
);
SELECT fleet_add_actor_fks('quotation_phase_history', false);
CREATE INDEX ix_quotation_phase_history_quotation_time ON quotation_phase_history (org_id, quotation_id, occurred_at);

CREATE TABLE hire_agreements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  quotation_id           uuid NOT NULL,
  customer_id            uuid NOT NULL,
  agreement_no           text NOT NULL,
  agreement_date         date NOT NULL,
  status                 text NOT NULL DEFAULT 'Draft',
  issuer_snapshot        jsonb NOT NULL,
  customer_snapshot      jsonb NOT NULL,
  equipment_name         text NOT NULL,
  equipment_model        text NOT NULL,
  serial_number          text NOT NULL,
  quantity               integer NOT NULL DEFAULT 1,
  capacity               text NOT NULL,
  working_height         text NOT NULL,
  delivery_location      text NOT NULL,
  hire_start_date        date NOT NULL,
  hire_end_date          date NOT NULL,
  hire_duration          text NOT NULL,
  monthly_rental         numeric(20,6) NOT NULL,
  transportation_charges numeric(20,6) NOT NULL,
  subtotal               numeric(20,6) NOT NULL,
  vat_amount             numeric(20,6) NOT NULL,
  total_amount           numeric(20,6) NOT NULL,
  payment_terms          text NOT NULL,
  payment_term_days      integer NOT NULL DEFAULT 30,
  security_deposit       numeric(20,6) NOT NULL DEFAULT 0,
  payment_method         text NOT NULL,
  sent_at                timestamptz,
  received_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_by             uuid,
  row_version            bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_hire_agreements_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_hire_agreements_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_hire_agreements_no UNIQUE (org_id, agreement_no),
  -- Composite keys that let children prove same customer / same quotation chains declaratively.
  CONSTRAINT uq_hire_agreements_org_id_customer UNIQUE (org_id, id, customer_id),
  CONSTRAINT uq_hire_agreements_org_id_quotation_customer UNIQUE (org_id, id, quotation_id, customer_id),
  CONSTRAINT fk_hire_agreements_customer FOREIGN KEY (org_id, customer_id) REFERENCES customers (org_id, id),
  -- Same-customer rule: the agreement customer must equal the quotation customer.
  CONSTRAINT fk_hire_agreements_quotation_customer FOREIGN KEY (org_id, quotation_id, customer_id)
    REFERENCES quotations (org_id, id, customer_id),
  CONSTRAINT ck_hire_agreements_status CHECK (status IN ('Draft', 'Active', 'Completed', 'Cancelled')),
  CONSTRAINT ck_hire_agreements_dates CHECK (hire_end_date >= hire_start_date),
  CONSTRAINT ck_hire_agreements_quantity CHECK (quantity > 0),
  CONSTRAINT ck_hire_agreements_amounts CHECK (
    monthly_rental >= 0 AND transportation_charges >= 0 AND subtotal >= 0
    AND vat_amount >= 0 AND total_amount >= 0 AND security_deposit >= 0),
  CONSTRAINT ck_hire_agreements_term_days CHECK (payment_term_days >= 0),
  CONSTRAINT ck_hire_agreements_snapshots CHECK (
    jsonb_typeof(issuer_snapshot) = 'object' AND jsonb_typeof(customer_snapshot) = 'object'),
  CONSTRAINT ck_hire_agreements_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('hire_agreements');
-- At most one non-cancelled agreement per quotation.
CREATE UNIQUE INDEX uq_live_quote_agreement ON hire_agreements (org_id, quotation_id) WHERE status <> 'Cancelled';
CREATE INDEX ix_hire_agreements_org_status ON hire_agreements (org_id, status);

CREATE TABLE customer_lpos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  quotation_id      uuid NOT NULL,
  hire_agreement_id uuid,
  customer_id       uuid NOT NULL,
  lpo_no            text NOT NULL,
  received_on       date NOT NULL,
  valid_until       date,
  amount            numeric(20,6),
  currency_code     char(3) NOT NULL,
  file_id           uuid,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  row_version       bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_customer_lpos_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_customer_lpos_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_customer_lpos_no UNIQUE (org_id, customer_id, lpo_no),
  CONSTRAINT uq_customer_lpos_org_id_customer UNIQUE (org_id, id, customer_id),
  CONSTRAINT fk_customer_lpos_customer FOREIGN KEY (org_id, customer_id) REFERENCES customers (org_id, id),
  -- Quotation and customer must match; agreement (when present) must match both.
  CONSTRAINT fk_customer_lpos_quotation_customer FOREIGN KEY (org_id, quotation_id, customer_id)
    REFERENCES quotations (org_id, id, customer_id),
  CONSTRAINT fk_customer_lpos_agreement_chain FOREIGN KEY (org_id, hire_agreement_id, quotation_id, customer_id)
    REFERENCES hire_agreements (org_id, id, quotation_id, customer_id),
  CONSTRAINT ck_customer_lpos_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_customer_lpos_amount CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT ck_customer_lpos_validity CHECK (valid_until IS NULL OR valid_until >= received_on),
  CONSTRAINT ck_customer_lpos_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_customer_lpos_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('customer_lpos');
CREATE INDEX ix_customer_lpos_file ON customer_lpos (org_id, file_id);

SELECT fleet_create_fk_indexes();
