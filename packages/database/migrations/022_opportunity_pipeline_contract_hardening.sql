ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_candidate_id UUID REFERENCES opportunity_candidates(id),
  ADD COLUMN IF NOT EXISTS customer_organization_id UUID REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS prime_organization_id UUID REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS engineering_firm_organization_id UUID REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS probability INTEGER,
  ADD COLUMN IF NOT EXISTS relationship_map_id UUID REFERENCES relationship_maps(id),
  ADD COLUMN IF NOT EXISTS capacity_readiness_score INTEGER,
  ADD COLUMN IF NOT EXISTS expected_start_date DATE,
  ADD COLUMN IF NOT EXISTS expected_decision_date DATE,
  ADD COLUMN IF NOT EXISTS bid_due_date DATE,
  ADD COLUMN IF NOT EXISTS location_summary TEXT,
  ADD COLUMN IF NOT EXISTS risk_notes TEXT,
  ADD COLUMN IF NOT EXISTS pursuit_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS pursuit_review_note TEXT,
  ADD COLUMN IF NOT EXISTS pursuit_approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS pursuit_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pursuit_approval_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS pursuit_approval_override_note TEXT,
  ADD COLUMN IF NOT EXISTS relationship_access_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS capacity_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS margin_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS constraints_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT,
  ADD COLUMN IF NOT EXISTS lost_note TEXT,
  ADD COLUMN IF NOT EXISTS lost_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deferred_reason TEXT,
  ADD COLUMN IF NOT EXISTS deferred_note TEXT,
  ADD COLUMN IF NOT EXISTS deferred_until DATE,
  ADD COLUMN IF NOT EXISTS deferred_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS deferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS awarded_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS awarded_at TIMESTAMPTZ;

UPDATE opportunities
SET
  source_candidate_id = COALESCE(source_candidate_id, candidate_id),
  summary = COALESCE(summary, evidence_summary),
  capacity_readiness_score = COALESCE(capacity_readiness_score, capacity_fit_score),
  lost_reason = COALESCE(lost_reason, loss_reason),
  deferred_reason = COALESCE(deferred_reason, deferral_reason),
  deferred_until = COALESCE(deferred_until, review_date),
  archived_at = COALESCE(archived_at, deleted_at)
WHERE source_candidate_id IS NULL
   OR summary IS NULL
   OR capacity_readiness_score IS NULL
   OR lost_reason IS NULL
   OR deferred_reason IS NULL
   OR deferred_until IS NULL
   OR archived_at IS NULL;

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_status_check;

DO $$
BEGIN

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_status_contract_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_status_contract_check
      CHECK (status IN ('qualified', 'draft', 'pursuit_review', 'pursuit_approved', 'pursuing', 'bid_proposal', 'proposal', 'negotiation', 'awarded', 'lost', 'deferred', 'archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_stage_contract_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_contract_check
      CHECK (stage IN ('qualified', 'draft', 'pursuit_review', 'pursuit_approved', 'pursuing', 'bid_proposal', 'proposal', 'negotiation', 'awarded', 'lost', 'deferred', 'archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_source_type_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_source_type_check
      CHECK (source_type IS NULL OR source_type IN ('candidate_conversion', 'manual_entry', 'signal', 'organization_research', 'relationship_map', 'customer_request', 'prime_request', 'public_source', 'internal_note', 'other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_estimated_value_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_estimated_value_check
      CHECK (estimated_value IS NULL OR estimated_value >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_probability_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_probability_check
      CHECK (probability IS NULL OR (probability >= 0 AND probability <= 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_capacity_readiness_score_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_capacity_readiness_score_check
      CHECK (capacity_readiness_score IS NULL OR (capacity_readiness_score >= 0 AND capacity_readiness_score <= 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_lost_reason_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_lost_reason_check
      CHECK (lost_reason IS NULL OR lost_reason IN ('price', 'relationship_access', 'capacity', 'schedule', 'compliance', 'competitor', 'customer_cancelled', 'poor_fit', 'other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_deferred_reason_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_deferred_reason_check
      CHECK (deferred_reason IS NULL OR deferred_reason IN ('timing', 'funding_delay', 'relationship_gap', 'capacity_gap', 'customer_delay', 'more_research_needed', 'other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_archive_reason_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_archive_reason_check
      CHECK (archive_reason IS NULL OR archive_reason IN ('duplicate', 'stale', 'no_longer_relevant', 'converted_or_replaced', 'cleanup', 'other'));
  END IF;
END $$;

ALTER TABLE opportunity_capacity_requirements
  ADD COLUMN IF NOT EXISTS work_type TEXT,
  ADD COLUMN IF NOT EXISTS required_crew_type TEXT,
  ADD COLUMN IF NOT EXISTS estimated_quantity NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS required_start_date DATE,
  ADD COLUMN IF NOT EXISTS required_end_date DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE opportunity_capacity_requirements
SET
  work_type = COALESCE(work_type, capacity_type),
  required_crew_type = COALESCE(required_crew_type, capacity_type),
  estimated_quantity = COALESCE(estimated_quantity, quantity),
  required_start_date = COALESCE(required_start_date, start_date),
  required_end_date = COALESCE(required_end_date, end_date),
  archived_at = COALESCE(archived_at, deleted_at)
WHERE work_type IS NULL
   OR required_crew_type IS NULL
   OR estimated_quantity IS NULL
   OR required_start_date IS NULL
   OR required_end_date IS NULL
   OR archived_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_capacity_requirements_archive_reason_check') THEN
    ALTER TABLE opportunity_capacity_requirements ADD CONSTRAINT opportunity_capacity_requirements_archive_reason_check
      CHECK (archive_reason IS NULL OR archive_reason IN ('duplicate', 'stale', 'no_longer_relevant', 'planning_changed', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS opportunities_tenant_status_idx ON opportunities(tenant_id, status);
CREATE INDEX IF NOT EXISTS opportunities_tenant_organization_idx ON opportunities(tenant_id, organization_id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_customer_org_idx ON opportunities(tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_territory_idx ON opportunities(tenant_id, territory_id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_owner_idx ON opportunities(tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_source_candidate_idx ON opportunities(tenant_id, source_candidate_id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_relationship_map_idx ON opportunities(tenant_id, relationship_map_id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_work_type_idx ON opportunities(tenant_id, work_type);
CREATE INDEX IF NOT EXISTS opportunities_tenant_estimated_value_idx ON opportunities(tenant_id, estimated_value);
CREATE INDEX IF NOT EXISTS opportunities_tenant_pursuit_score_idx ON opportunities(tenant_id, pursuit_score);
CREATE INDEX IF NOT EXISTS opportunities_tenant_relationship_access_idx ON opportunities(tenant_id, relationship_access_score);
CREATE INDEX IF NOT EXISTS opportunities_tenant_expected_decision_idx ON opportunities(tenant_id, expected_decision_date);
CREATE INDEX IF NOT EXISTS opportunities_tenant_archived_idx ON opportunities(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS opportunities_tenant_updated_idx ON opportunities(tenant_id, updated_at);

CREATE INDEX IF NOT EXISTS opportunity_capacity_requirements_tenant_opportunity_idx ON opportunity_capacity_requirements(tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS opportunity_capacity_requirements_tenant_archived_idx ON opportunity_capacity_requirements(tenant_id, archived_at);
