CREATE TABLE IF NOT EXISTS account_onboarding_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  lane TEXT NOT NULL DEFAULT 'prime',
  onboarding_stage TEXT NOT NULL DEFAULT 'identified',
  account_owner_user_id UUID REFERENCES users(id),
  relationship_strength_score INTEGER CHECK (relationship_strength_score IS NULL OR (relationship_strength_score >= 0 AND relationship_strength_score <= 100)),
  primary_contact_id UUID REFERENCES contacts(id),
  last_interaction_at TIMESTAMPTZ,
  next_action TEXT,
  next_action_deadline DATE,
  required_documents TEXT[] NOT NULL DEFAULT '{}'::text[],
  missing_documents TEXT[] NOT NULL DEFAULT '{}'::text[],
  market_availability TEXT[] NOT NULL DEFAULT '{}'::text[],
  customer_programs TEXT[] NOT NULL DEFAULT '{}'::text[],
  rate_sheet_status TEXT NOT NULL DEFAULT 'not_captured',
  rate_schedule_id UUID REFERENCES rate_schedules(id),
  payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  approval_status TEXT NOT NULL DEFAULT 'not_submitted',
  probability_of_work INTEGER CHECK (probability_of_work IS NULL OR (probability_of_work >= 0 AND probability_of_work <= 100)),
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  archived_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, organization_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_onboarding_profiles_lane_check') THEN
    ALTER TABLE account_onboarding_profiles ADD CONSTRAINT account_onboarding_profiles_lane_check
      CHECK (lane IN ('prime', 'contractor'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_onboarding_profiles_stage_check') THEN
    ALTER TABLE account_onboarding_profiles ADD CONSTRAINT account_onboarding_profiles_stage_check
      CHECK (onboarding_stage IN (
        'identified',
        'contact_discovered',
        'initial_outreach',
        'application_submitted',
        'documents_requested',
        'compliance_review',
        'operational_interview',
        'rate_negotiation',
        'approved',
        'market_assigned',
        'mobilized'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_onboarding_profiles_rate_sheet_status_check') THEN
    ALTER TABLE account_onboarding_profiles ADD CONSTRAINT account_onboarding_profiles_rate_sheet_status_check
      CHECK (rate_sheet_status IN ('not_captured', 'not_required', 'requested', 'received', 'in_review', 'approved', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_onboarding_profiles_approval_status_check') THEN
    ALTER TABLE account_onboarding_profiles ADD CONSTRAINT account_onboarding_profiles_approval_status_check
      CHECK (approval_status IN ('not_submitted', 'submitted', 'in_review', 'approved', 'rejected', 'blocked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_onboarding_profiles_status_check') THEN
    ALTER TABLE account_onboarding_profiles ADD CONSTRAINT account_onboarding_profiles_status_check
      CHECK (status IN ('active', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS account_onboarding_profiles_tenant_stage_idx ON account_onboarding_profiles(tenant_id, onboarding_stage);
CREATE INDEX IF NOT EXISTS account_onboarding_profiles_tenant_lane_idx ON account_onboarding_profiles(tenant_id, lane);
CREATE INDEX IF NOT EXISTS account_onboarding_profiles_tenant_owner_idx ON account_onboarding_profiles(tenant_id, account_owner_user_id);
CREATE INDEX IF NOT EXISTS account_onboarding_profiles_tenant_organization_idx ON account_onboarding_profiles(tenant_id, organization_id);
CREATE INDEX IF NOT EXISTS account_onboarding_profiles_tenant_deadline_idx ON account_onboarding_profiles(tenant_id, next_action_deadline);
CREATE INDEX IF NOT EXISTS account_onboarding_profiles_tenant_approval_idx ON account_onboarding_profiles(tenant_id, approval_status);
CREATE INDEX IF NOT EXISTS account_onboarding_profiles_tenant_archived_idx ON account_onboarding_profiles(tenant_id, archived_at);
