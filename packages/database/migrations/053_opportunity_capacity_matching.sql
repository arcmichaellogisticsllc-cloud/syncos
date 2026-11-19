CREATE TABLE IF NOT EXISTS opportunity_requirement_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  territory_id UUID NOT NULL,
  capability TEXT NOT NULL,
  crew_type TEXT NOT NULL,
  required_crew_count INTEGER NOT NULL CHECK (required_crew_count > 0),
  required_start_date DATE NOT NULL,
  required_start_window TEXT NOT NULL CHECK (required_start_window IN ('start_by', 'start_between', 'now_24h', '72h', '1_week', '2_weeks', '30_days', '60_days')),
  required_end_date DATE,
  estimated_duration_days INTEGER CHECK (estimated_duration_days IS NULL OR estimated_duration_days > 0),
  required_equipment_types TEXT[] NOT NULL DEFAULT '{}'::text[],
  required_compliance_types TEXT[] NOT NULL DEFAULT '{}'::text[],
  required_customer_clearances TEXT[] NOT NULL DEFAULT '{}'::text[],
  minimum_performance_score NUMERIC(5,2) CHECK (minimum_performance_score IS NULL OR (minimum_performance_score >= 0 AND minimum_performance_score <= 100)),
  minimum_performance_confidence TEXT CHECK (minimum_performance_confidence IS NULL OR minimum_performance_confidence IN ('low', 'medium', 'high')),
  max_risk_severity TEXT NOT NULL DEFAULT 'medium' CHECK (max_risk_severity IN ('low', 'medium', 'high', 'critical')),
  notes TEXT,
  current BOOLEAN NOT NULL DEFAULT true,
  superseded_by_version_id UUID,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, version),
  CONSTRAINT opportunity_requirement_profiles_opportunity_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id),
  CONSTRAINT opportunity_requirement_profiles_territory_fk FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id),
  CONSTRAINT opportunity_requirement_profiles_superseded_fk FOREIGN KEY (tenant_id, superseded_by_version_id) REFERENCES opportunity_requirement_profiles(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_requirement_profiles_current_uidx
  ON opportunity_requirement_profiles(tenant_id, opportunity_id)
  WHERE current = true;
CREATE INDEX IF NOT EXISTS opportunity_requirement_profiles_tenant_start_idx
  ON opportunity_requirement_profiles(tenant_id, current, required_start_date);

CREATE TABLE IF NOT EXISTS opportunity_partner_match_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL,
  requirement_profile_id UUID NOT NULL,
  partner_organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  matching_policy_version TEXT NOT NULL,
  eligible BOOLEAN NOT NULL DEFAULT false,
  review_required BOOLEAN NOT NULL DEFAULT false,
  hard_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  fit_score NUMERIC(5,2) NOT NULL CHECK (fit_score >= 0 AND fit_score <= 100),
  availability_score NUMERIC(5,2) NOT NULL CHECK (availability_score >= 0 AND availability_score <= 100),
  capability_score NUMERIC(5,2) NOT NULL CHECK (capability_score >= 0 AND capability_score <= 100),
  territory_score NUMERIC(5,2) NOT NULL CHECK (territory_score >= 0 AND territory_score <= 100),
  readiness_score NUMERIC(5,2) NOT NULL CHECK (readiness_score >= 0 AND readiness_score <= 100),
  performance_score NUMERIC(5,2) NOT NULL CHECK (performance_score >= 0 AND performance_score <= 100),
  capacity_confidence_score NUMERIC(5,2) NOT NULL CHECK (capacity_confidence_score >= 0 AND capacity_confidence_score <= 100),
  risk_score NUMERIC(5,2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  performance_confidence TEXT NOT NULL CHECK (performance_confidence IN ('low', 'medium', 'high', 'insufficient_data')),
  capacity_confidence TEXT NOT NULL CHECK (capacity_confidence IN ('low', 'medium', 'high', 'insufficient_data')),
  recommended_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (recommended_crew_count >= 0),
  ready_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_crew_count >= 0),
  potential_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (potential_crew_count >= 0),
  unverified_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (unverified_crew_count >= 0),
  trend TEXT NOT NULL DEFAULT 'insufficient_data',
  risk_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  source_fingerprint TEXT NOT NULL,
  current BOOLEAN NOT NULL DEFAULT true,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT opportunity_partner_match_opportunity_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id),
  CONSTRAINT opportunity_partner_match_requirement_fk FOREIGN KEY (tenant_id, requirement_profile_id) REFERENCES opportunity_requirement_profiles(tenant_id, id),
  CONSTRAINT opportunity_partner_match_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT opportunity_partner_match_provider_fk FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_partner_match_current_uidx
  ON opportunity_partner_match_snapshots(tenant_id, opportunity_id, requirement_profile_id, partner_organization_id)
  WHERE current = true;
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_partner_match_fingerprint_uidx
  ON opportunity_partner_match_snapshots(tenant_id, opportunity_id, requirement_profile_id, partner_organization_id, matching_policy_version, source_fingerprint);
CREATE INDEX IF NOT EXISTS opportunity_partner_match_rank_idx
  ON opportunity_partner_match_snapshots(tenant_id, opportunity_id, current, eligible, fit_score DESC);

CREATE TABLE IF NOT EXISTS opportunity_crew_match_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_match_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  requirement_profile_id UUID NOT NULL,
  partner_organization_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  crew_type TEXT,
  territory_fit TEXT NOT NULL CHECK (territory_fit IN ('exact', 'not_supported', 'not_evaluated')),
  capability_fit TEXT NOT NULL CHECK (capability_fit IN ('exact', 'missing', 'not_evaluated')),
  readiness_status TEXT NOT NULL CHECK (readiness_status IN ('ready', 'conditional', 'not_ready', 'committed')),
  availability_horizon TEXT NOT NULL CHECK (availability_horizon IN ('now_24h', '72h', '1_week', '2_weeks', '30_days', '60_days', 'not_available')),
  equipment_fit TEXT NOT NULL CHECK (equipment_fit IN ('available', 'available_with_sync_equipment', 'missing', 'not_required', 'not_evaluated')),
  performance_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  eligible BOOLEAN NOT NULL DEFAULT false,
  fit_score NUMERIC(5,2) NOT NULL CHECK (fit_score >= 0 AND fit_score <= 100),
  reason_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  current BOOLEAN NOT NULL DEFAULT true,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT opportunity_crew_match_partner_match_fk FOREIGN KEY (tenant_id, partner_match_id) REFERENCES opportunity_partner_match_snapshots(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT opportunity_crew_match_requirement_fk FOREIGN KEY (tenant_id, requirement_profile_id) REFERENCES opportunity_requirement_profiles(tenant_id, id),
  CONSTRAINT opportunity_crew_match_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT opportunity_crew_match_crew_fk FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS opportunity_crew_match_partner_idx
  ON opportunity_crew_match_snapshots(tenant_id, partner_match_id, current, eligible);

CREATE TABLE IF NOT EXISTS opportunity_coverage_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL,
  requirement_profile_id UUID NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('fully_covered', 'partially_covered', 'capacity_gap', 'no_eligible_capacity', 'low_confidence_coverage')),
  covered_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (covered_crew_count >= 0),
  required_crew_count INTEGER NOT NULL CHECK (required_crew_count > 0),
  remaining_gap INTEGER NOT NULL DEFAULT 0 CHECK (remaining_gap >= 0),
  average_fit_score NUMERIC(5,2) NOT NULL CHECK (average_fit_score >= 0 AND average_fit_score <= 100),
  minimum_confidence TEXT NOT NULL CHECK (minimum_confidence IN ('low', 'medium', 'high', 'insufficient_data')),
  critical_risk_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_risk_count >= 0),
  partner_count INTEGER NOT NULL DEFAULT 0 CHECK (partner_count >= 0),
  composition JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_fingerprint TEXT NOT NULL,
  current BOOLEAN NOT NULL DEFAULT true,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT opportunity_coverage_options_opportunity_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id),
  CONSTRAINT opportunity_coverage_options_requirement_fk FOREIGN KEY (tenant_id, requirement_profile_id) REFERENCES opportunity_requirement_profiles(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_coverage_options_current_rank_uidx
  ON opportunity_coverage_options(tenant_id, opportunity_id, requirement_profile_id, rank)
  WHERE current = true;
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_coverage_options_fingerprint_uidx
  ON opportunity_coverage_options(tenant_id, opportunity_id, requirement_profile_id, rank, source_fingerprint);

CREATE TABLE IF NOT EXISTS opportunity_partner_shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL,
  requirement_profile_id UUID NOT NULL,
  partner_organization_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('consider', 'preferred_for_pursuit', 'backup', 'removed')),
  note TEXT,
  added_by_user_id UUID REFERENCES users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT opportunity_shortlists_opportunity_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id),
  CONSTRAINT opportunity_shortlists_requirement_fk FOREIGN KEY (tenant_id, requirement_profile_id) REFERENCES opportunity_requirement_profiles(tenant_id, id),
  CONSTRAINT opportunity_shortlists_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_partner_shortlists_current_uidx
  ON opportunity_partner_shortlists(tenant_id, opportunity_id, requirement_profile_id, partner_organization_id)
  WHERE status <> 'removed';

CREATE TABLE IF NOT EXISTS opportunity_match_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL,
  requirement_profile_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('pursue_full_capacity_identified', 'pursue_partial_capacity_recruiting_required', 'pursue_with_risk_review', 'defer_capacity_gap', 'avoid_no_qualified_capacity', 'manual_note')),
  reason TEXT NOT NULL,
  selected_shortlist_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  recorded_by_user_id UUID REFERENCES users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT opportunity_match_decisions_opportunity_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id),
  CONSTRAINT opportunity_match_decisions_requirement_fk FOREIGN KEY (tenant_id, requirement_profile_id) REFERENCES opportunity_requirement_profiles(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS opportunity_match_decisions_opportunity_idx
  ON opportunity_match_decisions(tenant_id, opportunity_id, recorded_at DESC);
