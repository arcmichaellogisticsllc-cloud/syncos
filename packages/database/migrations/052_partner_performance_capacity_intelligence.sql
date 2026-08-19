CREATE TABLE IF NOT EXISTS partner_performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  scoring_policy_version TEXT NOT NULL,
  score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  score_band TEXT NOT NULL CHECK (score_band IN ('excellent', 'strong', 'acceptable', 'watch', 'high_risk')),
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  quality_score NUMERIC(5,2) NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
  production_score NUMERIC(5,2) NOT NULL CHECK (production_score >= 0 AND production_score <= 100),
  documentation_score NUMERIC(5,2) NOT NULL CHECK (documentation_score >= 0 AND documentation_score <= 100),
  safety_score NUMERIC(5,2) NOT NULL CHECK (safety_score >= 0 AND safety_score <= 100),
  mobilization_score NUMERIC(5,2) NOT NULL CHECK (mobilization_score >= 0 AND mobilization_score <= 100),
  correction_score NUMERIC(5,2) NOT NULL CHECK (correction_score >= 0 AND correction_score <= 100),
  commercial_score NUMERIC(5,2) NOT NULL CHECK (commercial_score >= 0 AND commercial_score <= 100),
  capacity_reliability_score NUMERIC(5,2) NOT NULL CHECK (capacity_reliability_score >= 0 AND capacity_reliability_score <= 100),
  trend TEXT NOT NULL DEFAULT 'insufficient_data' CHECK (trend IN ('improving', 'stable', 'declining', 'insufficient_data')),
  lifecycle_recommendation TEXT NOT NULL DEFAULT 'insufficient_data' CHECK (lifecycle_recommendation IN ('insufficient_data', 'promote', 'maintain', 'review', 'demote', 'suspend_review')),
  sample_start DATE,
  sample_end DATE,
  production_day_count INTEGER NOT NULL DEFAULT 0 CHECK (production_day_count >= 0),
  reviewed_record_count INTEGER NOT NULL DEFAULT 0 CHECK (reviewed_record_count >= 0),
  completed_work_order_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_work_order_count >= 0),
  critical_risk_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_risk_count >= 0),
  current BOOLEAN NOT NULL DEFAULT true,
  source_fingerprint TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT partner_performance_snapshots_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_performance_snapshots_provider_fk FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_performance_snapshots_current_uidx
  ON partner_performance_snapshots(tenant_id, partner_organization_id)
  WHERE current = true;
CREATE UNIQUE INDEX IF NOT EXISTS partner_performance_snapshots_fingerprint_uidx
  ON partner_performance_snapshots(tenant_id, partner_organization_id, scoring_policy_version, source_fingerprint);
CREATE INDEX IF NOT EXISTS partner_performance_snapshots_rank_idx
  ON partner_performance_snapshots(tenant_id, current, score DESC, confidence);

CREATE TABLE IF NOT EXISTS partner_performance_score_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  partner_organization_id UUID NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('quality', 'production', 'documentation', 'safety', 'mobilization', 'correction_rework', 'commercial_reliability', 'capacity_reliability')),
  metric_code TEXT NOT NULL,
  metric_value NUMERIC(14,4),
  metric_unit TEXT,
  normalized_score NUMERIC(5,2) NOT NULL CHECK (normalized_score >= 0 AND normalized_score <= 100),
  weight NUMERIC(6,2) NOT NULL CHECK (weight >= 0),
  weighted_contribution NUMERIC(8,4) NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  reason_code TEXT NOT NULL,
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT partner_performance_components_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES partner_performance_snapshots(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_performance_components_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS partner_performance_components_snapshot_idx
  ON partner_performance_score_components(tenant_id, snapshot_id, dimension);

CREATE TABLE IF NOT EXISTS partner_risk_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_organization_id UUID NOT NULL,
  risk_type TEXT NOT NULL CHECK (risk_type IN ('safety_critical', 'compliance_critical', 'fraud_integrity', 'customer_escalation', 'repeated_qc_failure', 'mobilization_failure', 'financial_integrity')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  reason_code TEXT NOT NULL,
  external_visible BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT partner_risk_flags_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_risk_flags_active_source_uidx
  ON partner_risk_flags(tenant_id, partner_organization_id, risk_type, source_type, source_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS partner_risk_flags_partner_idx
  ON partner_risk_flags(tenant_id, partner_organization_id, status, severity);

CREATE TABLE IF NOT EXISTS partner_lifecycle_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_organization_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  current_lifecycle_status TEXT,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('insufficient_data', 'promote', 'maintain', 'review', 'demote', 'suspend_review')),
  recommended_lifecycle_status TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  reason_code TEXT NOT NULL,
  governance_required BOOLEAN NOT NULL DEFAULT true,
  current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT partner_lifecycle_recommendations_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_lifecycle_recommendations_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES partner_performance_snapshots(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_lifecycle_recommendations_current_uidx
  ON partner_lifecycle_recommendations(tenant_id, partner_organization_id)
  WHERE current = true;

CREATE TABLE IF NOT EXISTS partner_capacity_intelligence_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  territory_id UUID,
  crew_type TEXT,
  capability TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('now_24h', '72h', '1_week', '2_weeks', '30_days', '60_days')),
  ready_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_crew_count >= 0),
  conditional_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (conditional_crew_count >= 0),
  unverified_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (unverified_crew_count >= 0),
  committed_crew_count INTEGER NOT NULL DEFAULT 0 CHECK (committed_crew_count >= 0),
  capacity_confidence TEXT NOT NULL CHECK (capacity_confidence IN ('low', 'medium', 'high')),
  recommendation TEXT NOT NULL CHECK (recommendation IN ('best_fit', 'qualified', 'available_low_confidence', 'capacity_constrained', 'performance_watch', 'not_ready')),
  current BOOLEAN NOT NULL DEFAULT true,
  source_fingerprint TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT partner_capacity_intelligence_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_capacity_intelligence_provider_fk FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_capacity_intelligence_territory_fk FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_capacity_intelligence_current_uidx
  ON partner_capacity_intelligence_snapshots(tenant_id, partner_organization_id, COALESCE(capacity_provider_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(territory_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(crew_type, ''), capability, horizon)
  WHERE current = true;
CREATE UNIQUE INDEX IF NOT EXISTS partner_capacity_intelligence_fingerprint_uidx
  ON partner_capacity_intelligence_snapshots(tenant_id, partner_organization_id, COALESCE(capacity_provider_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(territory_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(crew_type, ''), capability, horizon, source_fingerprint);
