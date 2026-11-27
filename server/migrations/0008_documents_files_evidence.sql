-- 0008: files, documents, document_versions, document_files, evidence_attachments
-- (DATABASE_DESIGN.md section 3.8), the cyclic documents.current_version_id key and the deferred
-- machine_documents.file_id / customer_lpos.file_id keys.

CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  object_key    text NOT NULL,
  original_name text NOT NULL,
  declared_mime text NOT NULL,
  detected_mime text,
  expected_size bigint NOT NULL,
  byte_size     bigint,
  sha256        char(64),
  storage_state text NOT NULL DEFAULT 'Pending',
  scan_status   text NOT NULL DEFAULT 'Pending',
  uploaded_by   uuid NOT NULL,
  uploaded_at   timestamptz,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  row_version   bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_files_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_files_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_files_object_key UNIQUE (object_key),
  CONSTRAINT fk_files_uploaded_by FOREIGN KEY (org_id, uploaded_by) REFERENCES users (org_id, id),
  CONSTRAINT ck_files_declared_mime CHECK (declared_mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  CONSTRAINT ck_files_detected_mime CHECK (detected_mime IS NULL OR detected_mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  CONSTRAINT ck_files_expected_size CHECK (expected_size > 0),
  CONSTRAINT ck_files_byte_size CHECK (byte_size IS NULL OR byte_size > 0),
  CONSTRAINT ck_files_sha256 CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_files_storage_state CHECK (storage_state IN ('Pending', 'Verified', 'Failed')),
  CONSTRAINT ck_files_scan_status CHECK (scan_status IN ('Pending', 'Clean', 'Rejected', 'Failed')),
  -- Actual size is unknown before the upload completes and known once verified.
  CONSTRAINT ck_files_pending_size CHECK (storage_state <> 'Pending' OR byte_size IS NULL),
  CONSTRAINT ck_files_verified CHECK (
    storage_state <> 'Verified' OR (byte_size IS NOT NULL AND sha256 IS NOT NULL AND detected_mime IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT ck_files_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('files');
CREATE INDEX ix_files_org_state ON files (org_id, storage_state, scan_status);

CREATE TABLE documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  document_type      text NOT NULL,
  document_no        text NOT NULL,
  quotation_id       uuid,
  hire_agreement_id  uuid,
  customer_lpo_id    uuid,
  invoice_id         uuid,
  delivery_note_id   uuid,
  collection_note_id uuid,
  mqd_report_id      uuid,
  service_report_id  uuid,
  gate_pass_id       uuid,
  inspection_id      uuid,
  current_version_id uuid,
  status             text NOT NULL DEFAULT 'Active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  row_version        bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_documents_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_documents_org_id UNIQUE (org_id, id),
  CONSTRAINT fk_documents_quotation FOREIGN KEY (org_id, quotation_id) REFERENCES quotations (org_id, id),
  CONSTRAINT fk_documents_hire_agreement FOREIGN KEY (org_id, hire_agreement_id) REFERENCES hire_agreements (org_id, id),
  CONSTRAINT fk_documents_customer_lpo FOREIGN KEY (org_id, customer_lpo_id) REFERENCES customer_lpos (org_id, id),
  CONSTRAINT fk_documents_invoice FOREIGN KEY (org_id, invoice_id) REFERENCES invoices (org_id, id),
  CONSTRAINT fk_documents_delivery_note FOREIGN KEY (org_id, delivery_note_id) REFERENCES delivery_notes (org_id, id),
  CONSTRAINT fk_documents_collection_note FOREIGN KEY (org_id, collection_note_id) REFERENCES collection_notes (org_id, id),
  CONSTRAINT fk_documents_mqd_report FOREIGN KEY (org_id, mqd_report_id) REFERENCES mqd_reports (org_id, id),
  CONSTRAINT fk_documents_service_report FOREIGN KEY (org_id, service_report_id)
    REFERENCES third_party_service_reports (org_id, id),
  CONSTRAINT fk_documents_gate_pass FOREIGN KEY (org_id, gate_pass_id) REFERENCES gate_passes (org_id, id),
  CONSTRAINT fk_documents_inspection FOREIGN KEY (org_id, inspection_id) REFERENCES inspections (org_id, id),
  CONSTRAINT ck_documents_status CHECK (status IN ('Active', 'Archived')),
  CONSTRAINT ck_documents_type CHECK (document_type IN
    ('QUOTATION', 'HIRE_AGREEMENT', 'LPO', 'INVOICE', 'DN', 'CN', 'HMQD', 'MQD', 'HTPS', 'TPS', 'GATE_PASS', 'INSPECTION')),
  -- Exactly one owner foreign key is populated.
  CONSTRAINT ck_documents_one_owner CHECK (num_nonnulls(quotation_id, hire_agreement_id, customer_lpo_id, invoice_id,
    delivery_note_id, collection_note_id, mqd_report_id, service_report_id, gate_pass_id, inspection_id) = 1),
  -- ... and it is the owner that is compatible with the document type.
  CONSTRAINT ck_documents_owner_matches_type CHECK (CASE document_type
    WHEN 'QUOTATION' THEN quotation_id IS NOT NULL
    WHEN 'HIRE_AGREEMENT' THEN hire_agreement_id IS NOT NULL
    WHEN 'LPO' THEN customer_lpo_id IS NOT NULL
    WHEN 'INVOICE' THEN invoice_id IS NOT NULL
    WHEN 'DN' THEN delivery_note_id IS NOT NULL
    WHEN 'CN' THEN collection_note_id IS NOT NULL
    WHEN 'HMQD' THEN mqd_report_id IS NOT NULL
    WHEN 'MQD' THEN mqd_report_id IS NOT NULL
    WHEN 'HTPS' THEN service_report_id IS NOT NULL
    WHEN 'TPS' THEN service_report_id IS NOT NULL
    WHEN 'GATE_PASS' THEN gate_pass_id IS NOT NULL
    WHEN 'INSPECTION' THEN inspection_id IS NOT NULL
    ELSE false END),
  CONSTRAINT ck_documents_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('documents');
-- One active document per owner and type.
CREATE UNIQUE INDEX uq_documents_active_quotation ON documents (org_id, quotation_id, document_type)
  WHERE status = 'Active' AND quotation_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_hire_agreement ON documents (org_id, hire_agreement_id, document_type)
  WHERE status = 'Active' AND hire_agreement_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_customer_lpo ON documents (org_id, customer_lpo_id, document_type)
  WHERE status = 'Active' AND customer_lpo_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_invoice ON documents (org_id, invoice_id, document_type)
  WHERE status = 'Active' AND invoice_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_delivery_note ON documents (org_id, delivery_note_id, document_type)
  WHERE status = 'Active' AND delivery_note_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_collection_note ON documents (org_id, collection_note_id, document_type)
  WHERE status = 'Active' AND collection_note_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_mqd_report ON documents (org_id, mqd_report_id, document_type)
  WHERE status = 'Active' AND mqd_report_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_service_report ON documents (org_id, service_report_id, document_type)
  WHERE status = 'Active' AND service_report_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_gate_pass ON documents (org_id, gate_pass_id, document_type)
  WHERE status = 'Active' AND gate_pass_id IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_active_inspection ON documents (org_id, inspection_id, document_type)
  WHERE status = 'Active' AND inspection_id IS NOT NULL;
CREATE INDEX ix_documents_org_type ON documents (org_id, document_type);

CREATE TABLE document_versions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL,
  document_id             uuid NOT NULL,
  version_no              integer NOT NULL,
  template_version        text NOT NULL,
  snapshot_schema_version text NOT NULL,
  data_snapshot           jsonb NOT NULL,
  snapshot_hash           char(64) NOT NULL,
  generation_status       text NOT NULL DEFAULT 'Pending',
  generated_at            timestamptz,
  error_code              text,
  error_message           text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_by              uuid,
  row_version             bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_document_versions_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_document_versions_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_document_versions_version UNIQUE (org_id, document_id, version_no),
  -- Lets documents.current_version_id prove the version belongs to the same document.
  CONSTRAINT uq_document_versions_org_document_id UNIQUE (org_id, document_id, id),
  CONSTRAINT fk_document_versions_document FOREIGN KEY (org_id, document_id) REFERENCES documents (org_id, id),
  CONSTRAINT ck_document_versions_version_no CHECK (version_no >= 1),
  CONSTRAINT ck_document_versions_hash CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_document_versions_status CHECK (generation_status IN ('Pending', 'Generated', 'Failed', 'Uploaded Original')),
  CONSTRAINT ck_document_versions_generated CHECK (generation_status <> 'Generated' OR generated_at IS NOT NULL),
  CONSTRAINT ck_document_versions_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('document_versions');

-- Snapshots and template identity are immutable once a version exists; only result fields may change.
CREATE FUNCTION fleet_guard_document_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.snapshot_schema_version IS DISTINCT FROM OLD.snapshot_schema_version
     OR NEW.data_snapshot IS DISTINCT FROM OLD.data_snapshot
     OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash THEN
    RAISE EXCEPTION 'IMMUTABLE_FIELD: document version snapshot and template identity cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_document_versions_immutable BEFORE UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION fleet_guard_document_version_immutable();

-- Cyclic key: the current version must belong to the same document.
ALTER TABLE documents ADD CONSTRAINT fk_documents_current_version
  FOREIGN KEY (org_id, id, current_version_id) REFERENCES document_versions (org_id, document_id, id);

CREATE TABLE document_files (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  document_version_id uuid NOT NULL,
  file_id             uuid NOT NULL,
  file_role           text NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  uploaded_by         uuid NOT NULL,
  attached_at         timestamptz NOT NULL DEFAULT now(),
  replaced_at         timestamptz,
  replacement_reason  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  row_version         bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_document_files_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_document_files_org_id UNIQUE (org_id, id),
  CONSTRAINT fk_document_files_version FOREIGN KEY (org_id, document_version_id) REFERENCES document_versions (org_id, id),
  CONSTRAINT fk_document_files_file FOREIGN KEY (org_id, file_id) REFERENCES files (org_id, id),
  CONSTRAINT fk_document_files_uploaded_by FOREIGN KEY (org_id, uploaded_by) REFERENCES users (org_id, id),
  CONSTRAINT ck_document_files_role CHECK (file_role IN ('Generated PDF', 'Signed Copy', 'Original')),
  CONSTRAINT ck_document_files_reason CHECK (
    replacement_reason IS NULL OR char_length(btrim(replacement_reason)) BETWEEN 1 AND 500),
  CONSTRAINT ck_document_files_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('document_files');
-- One active file per version and role.
CREATE UNIQUE INDEX uq_document_files_active_role ON document_files (org_id, document_version_id, file_role) WHERE active;

CREATE TABLE evidence_attachments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  file_id              uuid NOT NULL,
  mqd_report_id        uuid,
  inspection_id        uuid,
  inspection_result_id uuid,
  gate_pass_id         uuid,
  photo_role           text NOT NULL,
  caption              text,
  captured_at          timestamptz,
  display_order        integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_by           uuid,
  row_version          bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_evidence_attachments_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_evidence_attachments_org_id UNIQUE (org_id, id),
  CONSTRAINT fk_evidence_attachments_file FOREIGN KEY (org_id, file_id) REFERENCES files (org_id, id),
  CONSTRAINT fk_evidence_attachments_mqd_report FOREIGN KEY (org_id, mqd_report_id) REFERENCES mqd_reports (org_id, id),
  CONSTRAINT fk_evidence_attachments_inspection FOREIGN KEY (org_id, inspection_id) REFERENCES inspections (org_id, id),
  CONSTRAINT fk_evidence_attachments_inspection_result FOREIGN KEY (org_id, inspection_result_id)
    REFERENCES inspection_results (org_id, id),
  CONSTRAINT fk_evidence_attachments_gate_pass FOREIGN KEY (org_id, gate_pass_id) REFERENCES gate_passes (org_id, id),
  -- Exactly one owner foreign key is populated.
  CONSTRAINT ck_evidence_attachments_one_owner CHECK (
    num_nonnulls(mqd_report_id, inspection_id, inspection_result_id, gate_pass_id) = 1),
  CONSTRAINT ck_evidence_attachments_caption CHECK (caption IS NULL OR char_length(caption) <= 4000),
  CONSTRAINT ck_evidence_attachments_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('evidence_attachments');

-- Deferred keys to files, now that files exists.
ALTER TABLE machine_documents ADD CONSTRAINT fk_machine_documents_file
  FOREIGN KEY (org_id, file_id) REFERENCES files (org_id, id);
ALTER TABLE customer_lpos ADD CONSTRAINT fk_customer_lpos_file
  FOREIGN KEY (org_id, file_id) REFERENCES files (org_id, id);

SELECT fleet_create_fk_indexes();
