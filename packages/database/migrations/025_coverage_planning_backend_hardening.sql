ALTER TABLE coverage_plans
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT;

ALTER TABLE coverage_requirements
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT;

ALTER TABLE coverage_sources
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT;

ALTER TABLE coverage_gaps
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT;

CREATE INDEX IF NOT EXISTS coverage_plans_tenant_readiness_idx ON coverage_plans(tenant_id, coverage_readiness_score);
CREATE INDEX IF NOT EXISTS coverage_plans_tenant_approved_idx ON coverage_plans(tenant_id, approved_for_handoff_at);
CREATE INDEX IF NOT EXISTS coverage_gaps_tenant_status_idx ON coverage_gaps(tenant_id, status);
