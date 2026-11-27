-- 0007: gate_passes, gate_movements (append-only), collection_notes, mqd_reports,
-- third_party_service_reports/lines, delivery_notes, inspections, inspection_results
-- (DATABASE_DESIGN.md sections 3.6 and 3.7). Schema only.
-- Creation order resolves the cycle collection_notes -> gate_movements -> gate_passes -> collection_notes:
-- collection_notes.collected_movement_id and transport_jobs.collection_note_id get their keys at the end.

CREATE TABLE collection_notes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  number                 text NOT NULL,
  booking_id             uuid NOT NULL,
  machine_id             uuid NOT NULL,
  related_invoice_id     uuid,
  note_date              date NOT NULL,
  collection_address     text NOT NULL,
  driver_name            text NOT NULL,
  vehicle_text           text NOT NULL,
  status                 text NOT NULL DEFAULT 'Draft',
  scheduled_collection_at timestamptz,
  picked_up_at           timestamptz,
  collected_movement_id  uuid,
  collected_at           timestamptz,
  closed_at              timestamptz,
  remarks                text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_by             uuid,
  row_version            bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_collection_notes_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_collection_notes_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_collection_notes_number UNIQUE (org_id, number),
  CONSTRAINT uq_collection_notes_org_id_booking UNIQUE (org_id, id, booking_id),
  CONSTRAINT uq_collection_notes_org_id_machine UNIQUE (org_id, id, machine_id),
  -- The machine must be the booking's machine.
  CONSTRAINT fk_collection_notes_booking_machine FOREIGN KEY (org_id, booking_id, machine_id)
    REFERENCES bookings (org_id, id, machine_id),
  CONSTRAINT fk_collection_notes_invoice FOREIGN KEY (org_id, related_invoice_id) REFERENCES invoices (org_id, id),
  CONSTRAINT ck_collection_notes_status CHECK (status IN
    ('Draft', 'Scheduled', 'Picked Up', 'Collected', 'Closed', 'Cancelled')),
  CONSTRAINT ck_collection_notes_remarks CHECK (remarks IS NULL OR char_length(remarks) <= 4000),
  CONSTRAINT ck_collection_notes_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('collection_notes');
CREATE INDEX ix_collection_notes_org_status ON collection_notes (org_id, status);

-- related_invoice_id, when given, must be an invoice of the booking's source quotation.
CREATE FUNCTION fleet_guard_collection_note_invoice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.related_invoice_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM bookings b
         JOIN hire_agreements h ON h.org_id = b.org_id AND h.id = b.hire_agreement_id
         JOIN invoices i ON i.org_id = h.org_id AND i.quotation_id = h.quotation_id
        WHERE b.org_id = NEW.org_id AND b.id = NEW.booking_id AND i.id = NEW.related_invoice_id) THEN
    RAISE EXCEPTION 'related invoice does not belong to the booking quotation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_collection_notes_invoice BEFORE INSERT OR UPDATE OF booking_id, related_invoice_id ON collection_notes
  FOR EACH ROW EXECUTE FUNCTION fleet_guard_collection_note_invoice();

-- A pending or approved pass has no physical side effects; the physical crossing is gate_movements.
CREATE TABLE gate_passes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  reference           text NOT NULL,
  branch_id           uuid NOT NULL,
  machine_id          uuid NOT NULL,
  booking_id          uuid,
  transport_job_id    uuid,
  collection_note_id  uuid,
  direction           text NOT NULL,
  movement_purpose    text NOT NULL,
  status              text NOT NULL DEFAULT 'Pending',
  fleet_no_snapshot   text NOT NULL,
  driver_name         text NOT NULL,
  truck_plate         text,
  destination         text NOT NULL,
  arriving_from       text,
  capture_method      text NOT NULL,
  scanned_at          timestamptz,
  qr_payload          text,
  device_captured_at  timestamptz,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  approved_at         timestamptz,
  approved_by         uuid,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  row_version         bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_gate_passes_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_gate_passes_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_gate_passes_reference UNIQUE (org_id, reference),
  -- Lets gate_movements prove the same machine and direction as the pass.
  CONSTRAINT uq_gate_passes_org_id_machine_direction UNIQUE (org_id, id, machine_id, direction),
  CONSTRAINT fk_gate_passes_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT fk_gate_passes_machine FOREIGN KEY (org_id, machine_id) REFERENCES machines (org_id, id),
  CONSTRAINT fk_gate_passes_booking_machine FOREIGN KEY (org_id, booking_id, machine_id)
    REFERENCES bookings (org_id, id, machine_id),
  CONSTRAINT fk_gate_passes_transport_job_machine FOREIGN KEY (org_id, transport_job_id, machine_id)
    REFERENCES transport_jobs (org_id, id, machine_id),
  -- A collection note, if present, must identify the pass booking.
  CONSTRAINT fk_gate_passes_collection_note_booking FOREIGN KEY (org_id, collection_note_id, booking_id)
    REFERENCES collection_notes (org_id, id, booking_id),
  CONSTRAINT fk_gate_passes_approved_by FOREIGN KEY (org_id, approved_by) REFERENCES users (org_id, id),
  CONSTRAINT ck_gate_passes_direction CHECK (direction IN ('IN', 'OUT')),
  CONSTRAINT ck_gate_passes_purpose CHECK (movement_purpose IN ('CUSTOMER_HIRE', 'CUSTOMER_RETURN', 'TRANSFER')),
  CONSTRAINT ck_gate_passes_status CHECK (status IN ('Pending', 'Approved', 'Completed', 'Cancelled')),
  CONSTRAINT ck_gate_passes_capture CHECK (capture_method IN ('QR', 'Manual')),
  -- Customer movements need exact booking context, and a collection note needs a booking.
  CONSTRAINT ck_gate_passes_booking_context CHECK (movement_purpose = 'TRANSFER' OR booking_id IS NOT NULL),
  CONSTRAINT ck_gate_passes_note_booking CHECK (collection_note_id IS NULL OR booking_id IS NOT NULL),
  CONSTRAINT ck_gate_passes_purpose_direction CHECK (
    movement_purpose = 'TRANSFER'
    OR (movement_purpose = 'CUSTOMER_HIRE' AND direction = 'OUT')
    OR (movement_purpose = 'CUSTOMER_RETURN' AND direction = 'IN')),
  CONSTRAINT ck_gate_passes_qr_payload CHECK (qr_payload IS NULL OR char_length(qr_payload) <= 512),
  CONSTRAINT ck_gate_passes_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_gate_passes_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('gate_passes');
CREATE INDEX ix_gate_passes_org_status ON gate_passes (org_id, status);

-- Append-only: fleet_app is granted SELECT and INSERT only (0010).
CREATE TABLE gate_movements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  gate_pass_id         uuid NOT NULL,
  machine_id           uuid NOT NULL,
  booking_id           uuid,
  direction            text NOT NULL,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  operator_user_id     uuid NOT NULL,
  capture_method       text NOT NULL,
  time_source          text NOT NULL DEFAULT 'DATABASE',
  closes_movement_id   uuid,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  CONSTRAINT fk_gate_movements_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_gate_movements_org_id UNIQUE (org_id, id),
  -- Exactly one completed physical crossing per pass.
  CONSTRAINT uq_gate_movements_pass UNIQUE (org_id, gate_pass_id),
  CONSTRAINT uq_gate_movements_closes UNIQUE (org_id, closes_movement_id),
  CONSTRAINT uq_gate_movements_org_id_machine UNIQUE (org_id, id, machine_id),
  -- Machine and direction must equal the pass fields.
  CONSTRAINT fk_gate_movements_pass FOREIGN KEY (org_id, gate_pass_id, machine_id, direction)
    REFERENCES gate_passes (org_id, id, machine_id, direction),
  CONSTRAINT fk_gate_movements_booking_machine FOREIGN KEY (org_id, booking_id, machine_id)
    REFERENCES bookings (org_id, id, machine_id),
  CONSTRAINT fk_gate_movements_operator FOREIGN KEY (org_id, operator_user_id) REFERENCES users (org_id, id),
  CONSTRAINT fk_gate_movements_closes FOREIGN KEY (org_id, closes_movement_id) REFERENCES gate_movements (org_id, id),
  CONSTRAINT ck_gate_movements_direction CHECK (direction IN ('IN', 'OUT')),
  CONSTRAINT ck_gate_movements_capture CHECK (capture_method IN ('QR', 'Manual')),
  CONSTRAINT ck_gate_movements_closes_in CHECK (closes_movement_id IS NULL OR direction = 'IN'),
  CONSTRAINT ck_gate_movements_notes CHECK (notes IS NULL OR char_length(notes) <= 4000)
);
SELECT fleet_add_actor_fks('gate_movements', false);
CREATE INDEX ix_gate_movements_machine_time ON gate_movements (org_id, machine_id, occurred_at);

-- The movement booking must equal the pass booking (null-safe, so a null cannot hide a pass booking).
CREATE FUNCTION fleet_guard_gate_movement_booking()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pass_booking uuid;
BEGIN
  SELECT p.booking_id INTO pass_booking FROM gate_passes p WHERE p.org_id = NEW.org_id AND p.id = NEW.gate_pass_id;
  IF NEW.booking_id IS DISTINCT FROM pass_booking THEN
    RAISE EXCEPTION 'gate movement booking does not match its gate pass' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_gate_movements_booking BEFORE INSERT ON gate_movements
  FOR EACH ROW EXECUTE FUNCTION fleet_guard_gate_movement_booking();

-- Cyclic / forward keys, now that every referenced table exists.
ALTER TABLE collection_notes ADD CONSTRAINT fk_collection_notes_movement
  FOREIGN KEY (org_id, collected_movement_id) REFERENCES gate_movements (org_id, id);
ALTER TABLE transport_jobs ADD CONSTRAINT fk_transport_jobs_collection_note_machine
  FOREIGN KEY (org_id, collection_note_id, machine_id) REFERENCES collection_notes (org_id, id, machine_id);

CREATE TABLE mqd_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  number              text NOT NULL,
  booking_id          uuid NOT NULL,
  collection_note_id  uuid,
  phase               text NOT NULL,
  report_date         date NOT NULL,
  hirer_name          text NOT NULL,
  form_schema_version text NOT NULL,
  fields              jsonb NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  row_version         bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_mqd_reports_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_mqd_reports_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_mqd_reports_number UNIQUE (org_id, number),
  CONSTRAINT fk_mqd_reports_booking FOREIGN KEY (org_id, booking_id) REFERENCES bookings (org_id, id),
  -- A collection note, if present, must be for the same booking.
  CONSTRAINT fk_mqd_reports_collection_note FOREIGN KEY (org_id, collection_note_id, booking_id)
    REFERENCES collection_notes (org_id, id, booking_id),
  CONSTRAINT ck_mqd_reports_phase CHECK (phase IN ('HIRE', 'COLLECTION')),
  CONSTRAINT ck_mqd_reports_phase_note CHECK (
    (phase = 'COLLECTION' AND collection_note_id IS NOT NULL) OR (phase = 'HIRE' AND collection_note_id IS NULL)),
  CONSTRAINT ck_mqd_reports_fields CHECK (jsonb_typeof(fields) = 'object'),
  CONSTRAINT ck_mqd_reports_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_mqd_reports_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('mqd_reports');
-- One current report per booking/phase (no CN) and per booking/phase/CN.
CREATE UNIQUE INDEX uq_mqd_reports_scope_no_note ON mqd_reports (org_id, booking_id, phase) WHERE collection_note_id IS NULL;
CREATE UNIQUE INDEX uq_mqd_reports_scope_note ON mqd_reports (org_id, booking_id, phase, collection_note_id)
  WHERE collection_note_id IS NOT NULL;

CREATE TABLE third_party_service_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  number             text NOT NULL,
  booking_id         uuid NOT NULL,
  collection_note_id uuid,
  phase              text NOT NULL,
  currency_code      char(3) NOT NULL,
  notes              text,
  approved_by        uuid,
  approved_name      text,
  signature_text     text,
  total_amount       numeric(20,6) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  row_version        bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_third_party_service_reports_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_third_party_service_reports_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_third_party_service_reports_number UNIQUE (org_id, number),
  CONSTRAINT fk_third_party_service_reports_booking FOREIGN KEY (org_id, booking_id) REFERENCES bookings (org_id, id),
  CONSTRAINT fk_third_party_service_reports_collection_note FOREIGN KEY (org_id, collection_note_id, booking_id)
    REFERENCES collection_notes (org_id, id, booking_id),
  CONSTRAINT fk_third_party_service_reports_approved_by FOREIGN KEY (org_id, approved_by) REFERENCES users (org_id, id),
  CONSTRAINT ck_third_party_service_reports_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_third_party_service_reports_phase CHECK (phase IN ('HIRE', 'COLLECTION')),
  CONSTRAINT ck_third_party_service_reports_phase_note CHECK (
    (phase = 'COLLECTION' AND collection_note_id IS NOT NULL) OR (phase = 'HIRE' AND collection_note_id IS NULL)),
  CONSTRAINT ck_third_party_service_reports_total CHECK (total_amount >= 0),
  CONSTRAINT ck_third_party_service_reports_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_third_party_service_reports_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('third_party_service_reports');
CREATE UNIQUE INDEX uq_tps_reports_scope_no_note ON third_party_service_reports (org_id, booking_id, phase)
  WHERE collection_note_id IS NULL;
CREATE UNIQUE INDEX uq_tps_reports_scope_note ON third_party_service_reports (org_id, booking_id, phase, collection_note_id)
  WHERE collection_note_id IS NOT NULL;

CREATE TABLE third_party_service_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  report_id          uuid NOT NULL,
  line_no            integer NOT NULL,
  provider           text NOT NULL,
  service_type       text NOT NULL,
  description        text NOT NULL,
  service_date       date NOT NULL,
  external_reference text NOT NULL,
  quantity           numeric(18,6) NOT NULL,
  rate               numeric(20,6) NOT NULL,
  amount             numeric(20,6) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  row_version        bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_third_party_service_lines_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_third_party_service_lines_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_third_party_service_lines_line_no UNIQUE (org_id, report_id, line_no),
  CONSTRAINT fk_third_party_service_lines_report FOREIGN KEY (org_id, report_id)
    REFERENCES third_party_service_reports (org_id, id),
  CONSTRAINT ck_third_party_service_lines_type CHECK (service_type IN
    ('Transport', 'Crane', 'Escort', 'Inspection', 'Cleaning', 'Other')),
  CONSTRAINT ck_third_party_service_lines_line_no CHECK (line_no >= 1),
  CONSTRAINT ck_third_party_service_lines_values CHECK (quantity > 0 AND rate >= 0 AND amount >= 0),
  CONSTRAINT ck_third_party_service_lines_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('third_party_service_lines');

CREATE TABLE delivery_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  number           text NOT NULL,
  booking_id       uuid NOT NULL,
  note_date        date NOT NULL,
  delivery_address text NOT NULL,
  delivered_at     timestamptz,
  received_by_name text,
  driver_name      text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  row_version      bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_delivery_notes_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_delivery_notes_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_delivery_notes_number UNIQUE (org_id, number),
  -- One Delivery Note per booking in the current scope.
  CONSTRAINT uq_delivery_notes_booking UNIQUE (org_id, booking_id),
  CONSTRAINT fk_delivery_notes_booking FOREIGN KEY (org_id, booking_id) REFERENCES bookings (org_id, id),
  CONSTRAINT ck_delivery_notes_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_delivery_notes_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('delivery_notes');

CREATE TABLE inspections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  reference           text NOT NULL,
  machine_id          uuid NOT NULL,
  branch_id           uuid NOT NULL,
  booking_id          uuid,
  gate_movement_id    uuid,
  inspector_user_id   uuid,
  inspection_type     text NOT NULL,
  checklist_version   text NOT NULL,
  status              text NOT NULL DEFAULT 'Pending',
  scheduled_on        date,
  started_at          timestamptz,
  completed_at        timestamptz,
  overall_result      text,
  machine_hours       numeric(18,3),
  fuel_percent        numeric(5,2),
  approved_by         uuid,
  approved_at         timestamptz,
  notes               text,
  hold_released_by    uuid,
  hold_released_at    timestamptz,
  hold_release_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  row_version         bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_inspections_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_inspections_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_inspections_reference UNIQUE (org_id, reference),
  -- One return-intake inspection per completed return movement.
  CONSTRAINT uq_inspections_movement UNIQUE (org_id, gate_movement_id),
  CONSTRAINT fk_inspections_machine FOREIGN KEY (org_id, machine_id) REFERENCES machines (org_id, id),
  CONSTRAINT fk_inspections_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT fk_inspections_booking_machine FOREIGN KEY (org_id, booking_id, machine_id)
    REFERENCES bookings (org_id, id, machine_id),
  CONSTRAINT fk_inspections_movement_machine FOREIGN KEY (org_id, gate_movement_id, machine_id)
    REFERENCES gate_movements (org_id, id, machine_id),
  CONSTRAINT fk_inspections_inspector FOREIGN KEY (org_id, inspector_user_id) REFERENCES users (org_id, id),
  CONSTRAINT fk_inspections_approved_by FOREIGN KEY (org_id, approved_by) REFERENCES users (org_id, id),
  CONSTRAINT fk_inspections_hold_released_by FOREIGN KEY (org_id, hold_released_by) REFERENCES users (org_id, id),
  CONSTRAINT ck_inspections_status CHECK (status IN
    ('Pending', 'In Progress', 'Awaiting Approval', 'Passed', 'Failed', 'Cancelled')),
  CONSTRAINT ck_inspections_result CHECK (overall_result IS NULL OR overall_result IN ('Pass', 'Fail')),
  CONSTRAINT ck_inspections_outcome CHECK (
    (status <> 'Passed' OR overall_result = 'Pass') AND (status <> 'Failed' OR overall_result = 'Fail')),
  CONSTRAINT ck_inspections_readings CHECK (
    (machine_hours IS NULL OR machine_hours >= 0) AND (fuel_percent IS NULL OR fuel_percent BETWEEN 0 AND 100)),
  CONSTRAINT ck_inspections_release_reason CHECK (
    hold_release_reason IS NULL OR char_length(btrim(hold_release_reason)) BETWEEN 1 AND 500),
  CONSTRAINT ck_inspections_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_inspections_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('inspections');
CREATE INDEX ix_inspections_org_status ON inspections (org_id, status);

CREATE TABLE inspection_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  inspection_id     uuid NOT NULL,
  item_key          text NOT NULL,
  section           text NOT NULL,
  question_snapshot text NOT NULL,
  result            text NOT NULL DEFAULT 'Pending',
  critical          boolean NOT NULL,
  required          boolean NOT NULL,
  notes             text,
  answered_by       uuid,
  answered_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  row_version       bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_inspection_results_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_inspection_results_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_inspection_results_item UNIQUE (org_id, inspection_id, item_key),
  CONSTRAINT fk_inspection_results_inspection FOREIGN KEY (org_id, inspection_id) REFERENCES inspections (org_id, id),
  CONSTRAINT fk_inspection_results_answered_by FOREIGN KEY (org_id, answered_by) REFERENCES users (org_id, id),
  CONSTRAINT ck_inspection_results_result CHECK (result IN ('Pass', 'Fail', 'N/A', 'Pending')),
  CONSTRAINT ck_inspection_results_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT ck_inspection_results_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('inspection_results');

SELECT fleet_create_fk_indexes();
