ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS approval_tier TEXT,
  ADD COLUMN IF NOT EXISTS approval_required_role TEXT,
  ADD COLUMN IF NOT EXISTS pursuit_approval_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pursuit_approval_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pursuit_approval_override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS missing_value_override_reason TEXT;

ALTER TABLE constraints
  ADD COLUMN IF NOT EXISTS hard_stop BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_allowed BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_behavior TEXT;

UPDATE constraints
SET approval_behavior = CASE
  WHEN hard_stop = true THEN 'hard_block'
  WHEN severity IN ('critical', 'high') THEN 'override_required'
  ELSE 'warning'
END
WHERE approval_behavior IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_approval_tier_check') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_approval_tier_check
      CHECK (approval_tier IS NULL OR approval_tier IN ('missing_value', 'tier_1_under_50k', 'tier_2_50k_to_250k', 'tier_3_250k_plus'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'constraints_approval_behavior_check') THEN
    ALTER TABLE constraints ADD CONSTRAINT constraints_approval_behavior_check
      CHECK (approval_behavior IS NULL OR approval_behavior IN ('warning', 'override_required', 'hard_block'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS opportunities_tenant_approval_tier_idx ON opportunities(tenant_id, approval_tier);
CREATE INDEX IF NOT EXISTS opportunities_tenant_pursuit_approved_at_idx ON opportunities(tenant_id, pursuit_approved_at);
CREATE INDEX IF NOT EXISTS constraints_tenant_hard_stop_idx ON constraints(tenant_id, hard_stop);
CREATE INDEX IF NOT EXISTS constraints_tenant_severity_idx ON constraints(tenant_id, severity);
