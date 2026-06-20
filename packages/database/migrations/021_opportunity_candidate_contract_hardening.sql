ALTER TABLE opportunity_candidates
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS source_note TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS estimated_value NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS candidate_score NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS relationship_map_id UUID REFERENCES relationship_maps(id),
  ADD COLUMN IF NOT EXISTS rejection_note TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monitored_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS monitored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS investigated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS investigated_at TIMESTAMPTZ;

UPDATE opportunity_candidates
SET
  summary = COALESCE(summary, evidence_summary),
  candidate_score = COALESCE(candidate_score, score),
  archived_at = COALESCE(archived_at, deleted_at)
WHERE summary IS NULL
  OR candidate_score IS NULL
  OR archived_at IS NULL;

ALTER TABLE candidate_signals
  ADD COLUMN IF NOT EXISTS contribution_note TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE candidate_signals
SET archived_at = COALESCE(archived_at, deleted_at)
WHERE archived_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_candidates_source_type_check') THEN
    ALTER TABLE opportunity_candidates ADD CONSTRAINT opportunity_candidates_source_type_check
      CHECK (source_type IS NULL OR source_type IN ('signal', 'organization_research', 'relationship_map', 'manual_entry', 'customer_request', 'prime_request', 'public_source', 'internal_note', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_candidates_estimated_value_check') THEN
    ALTER TABLE opportunity_candidates ADD CONSTRAINT opportunity_candidates_estimated_value_check
      CHECK (estimated_value IS NULL OR estimated_value >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_candidates_candidate_score_check') THEN
    ALTER TABLE opportunity_candidates ADD CONSTRAINT opportunity_candidates_candidate_score_check
      CHECK (candidate_score IS NULL OR (candidate_score >= 0 AND candidate_score <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_candidates_rejection_reason_check') THEN
    ALTER TABLE opportunity_candidates ADD CONSTRAINT opportunity_candidates_rejection_reason_check
      CHECK (rejection_reason IS NULL OR rejection_reason IN ('insufficient_evidence', 'no_relationship_access', 'out_of_territory', 'low_value', 'poor_fit', 'capacity_gap', 'not_telecom_work', 'duplicate', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_candidates_archive_reason_check') THEN
    ALTER TABLE opportunity_candidates ADD CONSTRAINT opportunity_candidates_archive_reason_check
      CHECK (archive_reason IS NULL OR archive_reason IN ('duplicate', 'stale', 'no_longer_relevant', 'converted_later', 'rejected_cleanup', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidate_signals_archive_reason_check') THEN
    ALTER TABLE candidate_signals ADD CONSTRAINT candidate_signals_archive_reason_check
      CHECK (archive_reason IS NULL OR archive_reason IN ('duplicate', 'signal_no_longer_relevant', 'incorrect_link', 'candidate_rejected', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_status_idx ON opportunity_candidates(tenant_id, status);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_organization_idx ON opportunity_candidates(tenant_id, organization_id);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_territory_idx ON opportunity_candidates(tenant_id, territory_id);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_owner_idx ON opportunity_candidates(tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_relationship_map_idx ON opportunity_candidates(tenant_id, relationship_map_id);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_work_type_idx ON opportunity_candidates(tenant_id, work_type);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_estimated_value_idx ON opportunity_candidates(tenant_id, estimated_value);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_candidate_score_idx ON opportunity_candidates(tenant_id, candidate_score);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_confidence_idx ON opportunity_candidates(tenant_id, confidence_score);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_archived_idx ON opportunity_candidates(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_created_idx ON opportunity_candidates(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS opportunity_candidates_tenant_updated_idx ON opportunity_candidates(tenant_id, updated_at);

CREATE INDEX IF NOT EXISTS candidate_signals_tenant_candidate_status_idx ON candidate_signals(tenant_id, candidate_id, status);
CREATE INDEX IF NOT EXISTS candidate_signals_tenant_archived_idx ON candidate_signals(tenant_id, archived_at);
