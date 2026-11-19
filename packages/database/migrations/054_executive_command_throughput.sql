CREATE TABLE IF NOT EXISTS executive_command_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  policy_version TEXT NOT NULL,
  qualified_opportunity_count INTEGER CHECK (qualified_opportunity_count IS NULL OR qualified_opportunity_count >= 0),
  qualified_opportunity_value NUMERIC(14,2) CHECK (qualified_opportunity_value IS NULL OR qualified_opportunity_value >= 0),
  coverage_ready_count INTEGER CHECK (coverage_ready_count IS NULL OR coverage_ready_count >= 0),
  capacity_gap_count INTEGER CHECK (capacity_gap_count IS NULL OR capacity_gap_count >= 0),
  ready_crew_count INTEGER CHECK (ready_crew_count IS NULL OR ready_crew_count >= 0),
  active_work_order_count INTEGER CHECK (active_work_order_count IS NULL OR active_work_order_count >= 0),
  reported_production_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  accepted_production_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending_qc_count INTEGER CHECK (pending_qc_count IS NULL OR pending_qc_count >= 0),
  customer_qc_aging_count INTEGER CHECK (customer_qc_aging_count IS NULL OR customer_qc_aging_count >= 0),
  accepted_not_billed_amount NUMERIC(14,2) CHECK (accepted_not_billed_amount IS NULL OR accepted_not_billed_amount >= 0),
  outstanding_ar_amount NUMERIC(14,2) CHECK (outstanding_ar_amount IS NULL OR outstanding_ar_amount >= 0),
  cleared_cash_amount NUMERIC(14,2) CHECK (cleared_cash_amount IS NULL OR cleared_cash_amount >= 0),
  unapplied_cash_amount NUMERIC(14,2) CHECK (unapplied_cash_amount IS NULL OR unapplied_cash_amount >= 0),
  partner_eligible_payable_amount NUMERIC(14,2) CHECK (partner_eligible_payable_amount IS NULL OR partner_eligible_payable_amount >= 0),
  partner_awaiting_funds_amount NUMERIC(14,2) CHECK (partner_awaiting_funds_amount IS NULL OR partner_awaiting_funds_amount >= 0),
  partner_payment_due_amount NUMERIC(14,2) CHECK (partner_payment_due_amount IS NULL OR partner_payment_due_amount >= 0),
  critical_risk_count INTEGER CHECK (critical_risk_count IS NULL OR critical_risk_count >= 0),
  high_blocker_count INTEGER CHECK (high_blocker_count IS NULL OR high_blocker_count >= 0),
  days_to_cash JSONB NOT NULL DEFAULT '{}'::jsonb,
  billing_velocity JSONB NOT NULL DEFAULT '{}'::jsonb,
  daily_brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  freshness JSONB NOT NULL DEFAULT '{}'::jsonb,
  current BOOLEAN NOT NULL DEFAULT true,
  source_fingerprint TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS executive_command_snapshots_current_uidx
  ON executive_command_snapshots(tenant_id, snapshot_date, policy_version)
  WHERE current = true;

CREATE UNIQUE INDEX IF NOT EXISTS executive_command_snapshots_fingerprint_uidx
  ON executive_command_snapshots(tenant_id, policy_version, source_fingerprint);

CREATE INDEX IF NOT EXISTS executive_command_snapshots_tenant_asof_idx
  ON executive_command_snapshots(tenant_id, as_of DESC);

CREATE TABLE IF NOT EXISTS executive_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
  priority_score NUMERIC(5,2) NOT NULL CHECK (priority_score >= 0 AND priority_score <= 100),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  domain TEXT NOT NULL CHECK (domain IN ('growth', 'operations', 'partner', 'customer', 'finance', 'safety_compliance', 'capacity', 'unknown')),
  owner_attribution TEXT NOT NULL CHECK (owner_attribution IN ('sync', 'partner', 'customer', 'capacity', 'compliance', 'finance', 'unknown')),
  source_object_type TEXT NOT NULL,
  source_object_id UUID,
  title TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_summary TEXT NOT NULL,
  recommended_next_step TEXT NOT NULL,
  route TEXT NOT NULL,
  age_days INTEGER CHECK (age_days IS NULL OR age_days >= 0),
  due_at TIMESTAMPTZ,
  impact_amount NUMERIC(14,2) CHECK (impact_amount IS NULL OR impact_amount >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved_by_source_change', 'dismissed', 'snoozed')),
  current BOOLEAN NOT NULL DEFAULT true,
  source_fingerprint TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT executive_actions_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES executive_command_snapshots(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS executive_actions_snapshot_fingerprint_uidx
  ON executive_actions(tenant_id, snapshot_id, source_fingerprint);

CREATE INDEX IF NOT EXISTS executive_actions_current_rank_idx
  ON executive_actions(tenant_id, current, status, priority, priority_score DESC);

CREATE TABLE IF NOT EXISTS executive_blocker_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  blocker_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  owner_attribution TEXT NOT NULL CHECK (owner_attribution IN ('sync', 'partner', 'customer', 'capacity', 'compliance', 'finance', 'unknown')),
  domain TEXT NOT NULL CHECK (domain IN ('growth', 'operations', 'partner', 'customer', 'finance', 'safety_compliance', 'capacity', 'unknown')),
  source_object_type TEXT NOT NULL,
  source_object_id UUID,
  age_days INTEGER CHECK (age_days IS NULL OR age_days >= 0),
  impact_amount NUMERIC(14,2) CHECK (impact_amount IS NULL OR impact_amount >= 0),
  reason_code TEXT NOT NULL,
  reason_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved_by_source_change')),
  source_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT executive_blockers_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES executive_command_snapshots(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS executive_blockers_snapshot_fingerprint_uidx
  ON executive_blocker_snapshots(tenant_id, snapshot_id, source_fingerprint);

CREATE INDEX IF NOT EXISTS executive_blockers_current_idx
  ON executive_blocker_snapshots(tenant_id, snapshot_id, severity);
