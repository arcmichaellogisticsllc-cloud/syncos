ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual_entry',
  ADD COLUMN IF NOT EXISTS source_note TEXT,
  ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS date_discovered DATE,
  ADD COLUMN IF NOT EXISTS estimated_value NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS estimated_scope TEXT,
  ADD COLUMN IF NOT EXISTS work_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE signals
SET verified_by = COALESCE(verified_by, verified_by_user_id),
    date_discovered = COALESCE(date_discovered, created_at::date),
    archived_at = COALESCE(archived_at, deleted_at)
WHERE verified_by IS NULL
   OR date_discovered IS NULL
   OR archived_at IS NULL;

ALTER TABLE signals
  DROP CONSTRAINT IF EXISTS signals_source_type_check,
  ADD CONSTRAINT signals_source_type_check CHECK (source_type IN (
    'public_source',
    'relationship_source',
    'procurement_source',
    'government_source',
    'customer_source',
    'prime_source',
    'engineering_source',
    'manual_entry',
    'internal_note'
  )),
  DROP CONSTRAINT IF EXISTS signals_trust_level_check,
  ADD CONSTRAINT signals_trust_level_check CHECK (trust_level IN ('unverified', 'low', 'medium', 'high', 'verified')),
  DROP CONSTRAINT IF EXISTS signals_work_type_check,
  ADD CONSTRAINT signals_work_type_check CHECK (work_type IN (
    'fiber',
    'coax',
    'aerial',
    'underground',
    'directional_bore',
    'trenching',
    'splicing',
    'drops',
    'make_ready',
    'inspection',
    'restoration',
    'project_management',
    'unknown'
  )),
  DROP CONSTRAINT IF EXISTS signals_archive_reason_check,
  ADD CONSTRAINT signals_archive_reason_check CHECK (
    archive_reason IS NULL OR archive_reason IN (
      'duplicate',
      'stale',
      'false_signal',
      'out_of_territory',
      'not_telecom_work',
      'insufficient_evidence',
      'no_longer_relevant',
      'other'
    )
  );

ALTER TABLE signal_entities
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE signal_entities
SET linked_at = COALESCE(linked_at, created_at)
WHERE linked_at IS NULL;

ALTER TABLE signal_entities
  DROP CONSTRAINT IF EXISTS signal_entities_entity_type_check,
  ADD CONSTRAINT signal_entities_entity_type_check CHECK (entity_type IN ('organization', 'territory', 'contact'));

ALTER TABLE signal_evidence
  ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE signal_evidence
SET archived_at = COALESCE(archived_at, deleted_at)
WHERE archived_at IS NULL;

ALTER TABLE signal_evidence
  DROP CONSTRAINT IF EXISTS signal_evidence_trust_level_check,
  ADD CONSTRAINT signal_evidence_trust_level_check CHECK (trust_level IN ('unverified', 'low', 'medium', 'high', 'verified')),
  DROP CONSTRAINT IF EXISTS signal_evidence_type_check,
  ADD CONSTRAINT signal_evidence_type_check CHECK (evidence_type IN (
    'source_url',
    'document',
    'screenshot',
    'email_note',
    'call_note',
    'meeting_note',
    'public_record',
    'procurement_notice',
    'permit_record',
    'funding_notice',
    'relationship_note',
    'other'
  ));

CREATE INDEX IF NOT EXISTS signals_tenant_status_idx ON signals(tenant_id, status);
CREATE INDEX IF NOT EXISTS signals_tenant_trust_level_idx ON signals(tenant_id, trust_level);
CREATE INDEX IF NOT EXISTS signals_tenant_owner_user_id_idx ON signals(tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS signals_tenant_date_discovered_idx ON signals(tenant_id, date_discovered);
CREATE INDEX IF NOT EXISTS signals_tenant_work_type_idx ON signals(tenant_id, work_type);
CREATE INDEX IF NOT EXISTS signals_tenant_archived_at_idx ON signals(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS signal_entities_tenant_signal_type_idx ON signal_entities(tenant_id, signal_id, entity_type);
CREATE INDEX IF NOT EXISTS signal_entities_tenant_entity_idx ON signal_entities(tenant_id, entity_type, entity_id);
