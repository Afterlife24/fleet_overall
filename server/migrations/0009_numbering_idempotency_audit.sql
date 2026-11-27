-- 0009: number_sequences, idempotency_keys, audit_events (append-only) and the open-collection guard
-- (DATABASE_DESIGN.md section 3.9 and 5.1).

CREATE TABLE number_sequences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  sequence_kind text NOT NULL,
  sequence_year integer NOT NULL,
  quotation_id  uuid,
  next_value    bigint NOT NULL DEFAULT 1,
  min_width     integer NOT NULL,
  prefix        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  row_version   bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_number_sequences_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_number_sequences_org_id UNIQUE (org_id, id),
  CONSTRAINT fk_number_sequences_quotation FOREIGN KEY (org_id, quotation_id) REFERENCES quotations (org_id, id),
  CONSTRAINT ck_number_sequences_kind CHECK (sequence_kind ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT ck_number_sequences_next CHECK (next_value >= 1),
  CONSTRAINT ck_number_sequences_width CHECK (min_width >= 1),
  -- Quote-specific INVOICE sequences use the quotation and year 0; every other kind is organization/year scoped.
  CONSTRAINT ck_number_sequences_invoice_scope CHECK (
    (sequence_kind = 'INVOICE' AND quotation_id IS NOT NULL AND sequence_year = 0)
    OR (sequence_kind <> 'INVOICE' AND quotation_id IS NULL)),
  CONSTRAINT ck_number_sequences_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('number_sequences');
CREATE UNIQUE INDEX uq_number_sequences_org_year ON number_sequences (org_id, sequence_kind, sequence_year)
  WHERE quotation_id IS NULL;
CREATE UNIQUE INDEX uq_number_sequences_quotation ON number_sequences (org_id, sequence_kind, quotation_id)
  WHERE quotation_id IS NOT NULL;

CREATE TABLE idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  operation       text NOT NULL,
  key             text NOT NULL,
  request_hash    char(64) NOT NULL,
  status          text NOT NULL DEFAULT 'Processing',
  response_status integer,
  response_body   jsonb,
  expires_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  row_version     bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_idempotency_keys_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_idempotency_keys_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_idempotency_keys_key UNIQUE (org_id, operation, key),
  CONSTRAINT ck_idempotency_keys_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_idempotency_keys_status CHECK (status IN ('Processing', 'Complete')),
  CONSTRAINT ck_idempotency_keys_complete CHECK (status <> 'Complete' OR (response_status IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT ck_idempotency_keys_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('idempotency_keys');
CREATE INDEX ix_idempotency_keys_expires ON idempotency_keys (expires_at);

-- Append-only: fleet_app is granted SELECT and INSERT only (0010).
CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  actor_user_id uuid,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  reason        text,
  before_data   jsonb,
  after_data    jsonb,
  correlation_id uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  CONSTRAINT fk_audit_events_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_audit_events_org_id UNIQUE (org_id, id),
  CONSTRAINT fk_audit_events_actor FOREIGN KEY (org_id, actor_user_id) REFERENCES users (org_id, id),
  CONSTRAINT ck_audit_events_reason CHECK (reason IS NULL OR char_length(reason) <= 4000)
);
SELECT fleet_add_actor_fks('audit_events', false);
-- entity_type/entity_id are audit metadata, not a relationship key, so they carry no foreign key.
CREATE INDEX ix_audit_events_entity ON audit_events (org_id, entity_type, entity_id);
CREATE INDEX ix_audit_events_time ON audit_events (org_id, occurred_at);

-- One open collection note per booking (Draft, Scheduled, Picked Up or Collected).
CREATE UNIQUE INDEX uq_open_collection ON collection_notes (org_id, booking_id)
  WHERE status IN ('Draft', 'Scheduled', 'Picked Up', 'Collected');

SELECT fleet_create_fk_indexes();
