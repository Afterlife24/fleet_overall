-- 0006: drivers, transport_vehicles, transport_jobs (DATABASE_DESIGN.md section 3.5). Schema only.
-- transport_jobs.collection_note_id gets its foreign key in 0007, once collection_notes exists.

CREATE TABLE drivers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  branch_id          uuid NOT NULL,
  user_id            uuid,
  name               text NOT NULL,
  phone              text NOT NULL,
  license_no         text NOT NULL,
  license_expires_on date NOT NULL,
  status             text NOT NULL DEFAULT 'Available',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  row_version        bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_drivers_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_drivers_org_id UNIQUE (org_id, id),
  CONSTRAINT fk_drivers_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT fk_drivers_user FOREIGN KEY (org_id, user_id) REFERENCES users (org_id, id),
  CONSTRAINT ck_drivers_status CHECK (status IN ('Available', 'On Delivery', 'Returning', 'Off Duty')),
  CONSTRAINT ck_drivers_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('drivers');

CREATE TABLE transport_vehicles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  branch_id       uuid NOT NULL,
  registration_no text NOT NULL,
  vehicle_type    text NOT NULL,
  capacity_kg     numeric(14,3) NOT NULL,
  status          text NOT NULL DEFAULT 'Available',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  row_version     bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_transport_vehicles_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_transport_vehicles_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_transport_vehicles_registration UNIQUE (org_id, registration_no),
  CONSTRAINT fk_transport_vehicles_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT ck_transport_vehicles_type CHECK (vehicle_type IN ('Flatbed', 'Lowboy', 'Crane Truck', 'Recovery')),
  CONSTRAINT ck_transport_vehicles_status CHECK (status IN ('Available', 'On Route', 'Maintenance', 'Offline')),
  CONSTRAINT ck_transport_vehicles_capacity CHECK (capacity_kg >= 0),
  CONSTRAINT ck_transport_vehicles_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('transport_vehicles');

CREATE TABLE transport_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  reference          text NOT NULL,
  branch_id          uuid NOT NULL,
  machine_id         uuid NOT NULL,
  booking_id         uuid,
  quotation_id       uuid,
  collection_note_id uuid,
  driver_id          uuid,
  vehicle_id         uuid,
  planner_name       text NOT NULL,
  schedule_date      date NOT NULL,
  shift              text NOT NULL,
  transport_team     text NOT NULL,
  schedule_serial    integer NOT NULL,
  fleet_no_snapshot  text NOT NULL,
  origin             text NOT NULL,
  destination        text NOT NULL,
  transport_text     text NOT NULL,
  type_code          text NOT NULL,
  contact_text       text NOT NULL,
  salesperson_code   text NOT NULL,
  client_text        text NOT NULL,
  scheduled_at       timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'Scheduled',
  distance_km        numeric(12,3),
  charge_to_customer numeric(20,6),
  internal_cost      numeric(20,6),
  currency_code      char(3) NOT NULL,
  auto_generated     boolean NOT NULL DEFAULT false,
  source_key         text,
  remarks            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  row_version        bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_transport_jobs_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_transport_jobs_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_transport_jobs_reference UNIQUE (org_id, reference),
  CONSTRAINT uq_transport_jobs_source_key UNIQUE (org_id, source_key),
  CONSTRAINT uq_transport_jobs_org_id_machine UNIQUE (org_id, id, machine_id),
  CONSTRAINT fk_transport_jobs_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT fk_transport_jobs_machine FOREIGN KEY (org_id, machine_id) REFERENCES machines (org_id, id),
  -- One machine per job: the booking, when given, must be for the same machine.
  CONSTRAINT fk_transport_jobs_booking_machine FOREIGN KEY (org_id, booking_id, machine_id)
    REFERENCES bookings (org_id, id, machine_id),
  CONSTRAINT fk_transport_jobs_quotation FOREIGN KEY (org_id, quotation_id) REFERENCES quotations (org_id, id),
  CONSTRAINT fk_transport_jobs_driver FOREIGN KEY (org_id, driver_id) REFERENCES drivers (org_id, id),
  CONSTRAINT fk_transport_jobs_vehicle FOREIGN KEY (org_id, vehicle_id) REFERENCES transport_vehicles (org_id, id),
  CONSTRAINT ck_transport_jobs_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_transport_jobs_shift CHECK (shift IN ('Morning', 'Evening')),
  CONSTRAINT ck_transport_jobs_serial CHECK (schedule_serial BETWEEN 1 AND 9999),
  CONSTRAINT ck_transport_jobs_type CHECK (type_code IN ('D', 'O', 'T', 'T2')),
  CONSTRAINT ck_transport_jobs_status CHECK (status IN
    ('Scheduled', 'Loading', 'In Transit', 'Delivered', 'Returning', 'Completed', 'Cancelled')),
  CONSTRAINT ck_transport_jobs_amounts CHECK (
    (distance_km IS NULL OR distance_km >= 0)
    AND (charge_to_customer IS NULL OR charge_to_customer >= 0)
    AND (internal_cost IS NULL OR internal_cost >= 0)),
  CONSTRAINT ck_transport_jobs_remarks CHECK (remarks IS NULL OR char_length(remarks) <= 4000),
  CONSTRAINT ck_transport_jobs_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('transport_jobs');
CREATE INDEX ix_transport_jobs_org_status ON transport_jobs (org_id, status);
CREATE INDEX ix_transport_jobs_org_schedule ON transport_jobs (org_id, schedule_date);

-- When both a booking and a quotation are given, the quotation must be the booking's agreement quotation.
CREATE FUNCTION fleet_guard_transport_job_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.booking_id IS NOT NULL AND NEW.quotation_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM bookings b
         JOIN hire_agreements h ON h.org_id = b.org_id AND h.id = b.hire_agreement_id
        WHERE b.org_id = NEW.org_id AND b.id = NEW.booking_id AND h.quotation_id = NEW.quotation_id) THEN
    RAISE EXCEPTION 'transport job quotation does not match the booking chain' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_transport_jobs_chain BEFORE INSERT OR UPDATE OF booking_id, quotation_id ON transport_jobs
  FOR EACH ROW EXECUTE FUNCTION fleet_guard_transport_job_chain();

SELECT fleet_create_fk_indexes();
