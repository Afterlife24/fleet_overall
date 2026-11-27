-- 0005: bookings, invoices, invoice_lines with the DATABASE_DESIGN.md section 5.1 overlap guards.

CREATE TABLE bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  reference             text NOT NULL,
  branch_id             uuid NOT NULL,
  machine_id            uuid NOT NULL,
  customer_id           uuid NOT NULL,
  hire_agreement_id     uuid,
  lpo_id                uuid,
  start_date            date NOT NULL,
  end_date              date NOT NULL,
  status                text NOT NULL DEFAULT 'Draft',
  delivery_address      text NOT NULL,
  contact_phone         text NOT NULL,
  operator_required     boolean NOT NULL DEFAULT false,
  daily_rate            numeric(20,6) NOT NULL DEFAULT 0,
  total_value           numeric(20,6) NOT NULL DEFAULT 0,
  quoted                boolean NOT NULL DEFAULT false,
  ha_sent               boolean NOT NULL DEFAULT false,
  ha_received           boolean NOT NULL DEFAULT false,
  reserved              boolean NOT NULL DEFAULT false,
  on_hire_at            timestamptz,
  departed_at           timestamptz,
  off_hire_requested_at timestamptz,
  collected_at          timestamptz,
  returned_at           timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid,
  row_version           bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_bookings_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_bookings_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_bookings_reference UNIQUE (org_id, reference),
  -- Lets children (collection notes, gate passes, transport jobs) prove the same machine as the booking.
  CONSTRAINT uq_bookings_org_id_machine UNIQUE (org_id, id, machine_id),
  CONSTRAINT fk_bookings_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT fk_bookings_machine FOREIGN KEY (org_id, machine_id) REFERENCES machines (org_id, id),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (org_id, customer_id) REFERENCES customers (org_id, id),
  -- A linked agreement / LPO must belong to the same customer as the booking.
  CONSTRAINT fk_bookings_agreement_customer FOREIGN KEY (org_id, hire_agreement_id, customer_id)
    REFERENCES hire_agreements (org_id, id, customer_id),
  CONSTRAINT fk_bookings_lpo_customer FOREIGN KEY (org_id, lpo_id, customer_id)
    REFERENCES customer_lpos (org_id, id, customer_id),
  CONSTRAINT ck_bookings_status CHECK (status IN
    ('Draft', 'Reserved', 'Pending Approval', 'Approved', 'Allocated', 'On Hire', 'Returned', 'Cancelled')),
  CONSTRAINT ck_booking_dates CHECK (end_date >= start_date),
  CONSTRAINT ck_actual_booking_return CHECK (returned_at IS NULL OR departed_at IS NULL OR returned_at >= departed_at),
  CONSTRAINT ck_bookings_on_hire_chain CHECK (status <> 'On Hire' OR hire_agreement_id IS NOT NULL),
  CONSTRAINT ck_bookings_amounts CHECK (daily_rate >= 0 AND total_value >= 0),
  CONSTRAINT ck_bookings_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_bookings_row_version CHECK (row_version >= 1),
  -- One machine cannot have overlapping planned (inclusive date) bookings among active statuses.
  CONSTRAINT ex_machine_planned_booking EXCLUDE USING gist
    (org_id WITH =, machine_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
    WHERE (status IN ('Reserved', 'Pending Approval', 'Approved', 'Allocated', 'On Hire')),
  -- One machine cannot be physically out on two bookings at the same time (open-ended while not returned).
  CONSTRAINT ex_machine_physical_booking EXCLUDE USING gist
    (org_id WITH =, machine_id WITH =, tstzrange(departed_at, returned_at, '[)') WITH &&)
    WHERE (departed_at IS NOT NULL)
);
SELECT fleet_add_actor_fks('bookings');
CREATE INDEX ix_bookings_org_status ON bookings (org_id, status);
CREATE INDEX ix_bookings_org_dates ON bookings (org_id, start_date, end_date);

CREATE TABLE invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  quotation_id          uuid NOT NULL,
  hire_agreement_id     uuid NOT NULL,
  customer_id           uuid NOT NULL,
  invoice_no            text NOT NULL,
  quotation_no_snapshot text NOT NULL,
  agreement_no_snapshot text NOT NULL,
  sequence_no           bigint NOT NULL,
  invoice_type          text NOT NULL,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  invoice_date          date NOT NULL,
  due_date              date NOT NULL,
  currency_code         char(3) NOT NULL,
  status                text NOT NULL DEFAULT 'Draft',
  issuer_snapshot       jsonb NOT NULL,
  customer_snapshot     jsonb NOT NULL,
  hire_period_text      text NOT NULL,
  delivery_location     text NOT NULL,
  payment_terms         text NOT NULL,
  payment_term_days     integer NOT NULL,
  payment_method        text NOT NULL,
  security_deposit      numeric(20,6) NOT NULL DEFAULT 0,
  subtotal              numeric(20,6) NOT NULL,
  vat_rate              numeric(9,6) NOT NULL,
  vat_amount            numeric(20,6) NOT NULL,
  total_amount          numeric(20,6) NOT NULL,
  amount_due            numeric(20,6) NOT NULL,
  issued_at             timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid,
  row_version           bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_invoices_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_invoices_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_invoices_no UNIQUE (org_id, invoice_no),
  CONSTRAINT uq_invoices_quotation_sequence UNIQUE (org_id, quotation_id, sequence_no),
  CONSTRAINT fk_invoices_quotation FOREIGN KEY (org_id, quotation_id) REFERENCES quotations (org_id, id),
  CONSTRAINT fk_invoices_customer FOREIGN KEY (org_id, customer_id) REFERENCES customers (org_id, id),
  -- Agreement, quotation and customer must all belong to the same chain.
  CONSTRAINT fk_invoices_agreement_chain FOREIGN KEY (org_id, hire_agreement_id, quotation_id, customer_id)
    REFERENCES hire_agreements (org_id, id, quotation_id, customer_id),
  CONSTRAINT ck_invoices_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_invoices_type CHECK (invoice_type IN ('Continuous Hire', 'Off-Hire')),
  CONSTRAINT ck_invoices_status CHECK (status IN ('Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled')),
  CONSTRAINT ck_invoice_dates CHECK (period_end >= period_start),
  CONSTRAINT ck_invoices_due_date CHECK (due_date >= invoice_date),
  CONSTRAINT ck_invoices_sequence CHECK (sequence_no >= 1),
  CONSTRAINT ck_invoices_term_days CHECK (payment_term_days >= 0),
  CONSTRAINT ck_invoices_amounts CHECK (
    security_deposit >= 0 AND subtotal >= 0 AND vat_rate >= 0 AND vat_amount >= 0 AND total_amount >= 0),
  CONSTRAINT ck_invoices_amount_due CHECK (amount_due >= 0 AND amount_due <= total_amount),
  CONSTRAINT ck_invoices_paid_zero CHECK (status <> 'Paid' OR amount_due = 0),
  CONSTRAINT ck_invoices_cancellation CHECK (
    (status = 'Cancelled') = (cancelled_at IS NOT NULL)
    AND (cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 1 AND 500)),
  CONSTRAINT ck_invoices_snapshots CHECK (
    jsonb_typeof(issuer_snapshot) = 'object' AND jsonb_typeof(customer_snapshot) = 'object'),
  CONSTRAINT ck_invoices_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_invoices_row_version CHECK (row_version >= 1),
  -- Non-cancelled invoice periods of one quotation never overlap.
  CONSTRAINT ex_quote_invoice_overlap EXCLUDE USING gist
    (org_id WITH =, quotation_id WITH =, daterange(period_start, period_end, '[]') WITH &&)
    WHERE (status <> 'Cancelled')
);
SELECT fleet_add_actor_fks('invoices');
CREATE INDEX ix_invoices_org_status ON invoices (org_id, status);
CREATE INDEX ix_invoices_org_due ON invoices (org_id, due_date);

-- Database guard for "new invoices require a Won quotation and a non-cancelled agreement".
CREATE FUNCTION fleet_guard_invoice_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM quotations q
                  WHERE q.org_id = NEW.org_id AND q.id = NEW.quotation_id AND q.phase = 'WON') THEN
    RAISE EXCEPTION 'NOT_WON: invoices can only be created for a Won quotation' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hire_agreements h
                  WHERE h.org_id = NEW.org_id AND h.id = NEW.hire_agreement_id AND h.status <> 'Cancelled') THEN
    RAISE EXCEPTION 'NO_AGREEMENT: invoices require a non-cancelled hire agreement' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_invoices_guard_insert BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION fleet_guard_invoice_insert();

CREATE TABLE invoice_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  invoice_id  uuid NOT NULL,
  line_no     integer NOT NULL,
  line_type   text NOT NULL,
  description text NOT NULL,
  quantity    numeric(18,6) NOT NULL,
  unit_rate   numeric(20,6) NOT NULL,
  amount      numeric(20,6) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  row_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_invoice_lines_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_invoice_lines_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_invoice_lines_line_no UNIQUE (org_id, invoice_id, line_no),
  CONSTRAINT uq_invoice_lines_line_type UNIQUE (org_id, invoice_id, line_type),
  CONSTRAINT fk_invoice_lines_invoice FOREIGN KEY (org_id, invoice_id) REFERENCES invoices (org_id, id),
  CONSTRAINT ck_invoice_lines_type CHECK (line_type IN ('EQUIPMENT', 'TRANSPORT')),
  CONSTRAINT ck_invoice_lines_line_no CHECK (line_no >= 1),
  CONSTRAINT ck_invoice_lines_values CHECK (quantity >= 0 AND unit_rate >= 0 AND amount >= 0),
  CONSTRAINT ck_invoice_lines_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('invoice_lines');

SELECT fleet_create_fk_indexes();
