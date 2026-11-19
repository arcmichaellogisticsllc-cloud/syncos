ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_status_check;
ALTER TABLE workers ADD CONSTRAINT workers_status_check CHECK (status IN ('active', 'inactive', 'suspended', 'archived'));
ALTER TABLE partner_agreement_versions ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE partner_agreement_versions ADD COLUMN IF NOT EXISTS termination_reason TEXT;
ALTER TABLE partner_vehicle_assignments ADD COLUMN IF NOT EXISTS aerial_inspection_expires_at DATE;
CREATE INDEX IF NOT EXISTS partner_vehicle_assignments_aerial_inspection_idx
  ON partner_vehicle_assignments(tenant_id, work_order_version_id, crew_id, aerial_inspection_expires_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mobilization_requirement_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requirement_code TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('blocker', 'warning')),
  override_policy TEXT NOT NULL CHECK (override_policy IN ('non_overrideable', 'overrideable_with_expiration', 'warning_only')),
  source_evaluator TEXT NOT NULL,
  external_message TEXT NOT NULL,
  internal_description TEXT,
  active_version INTEGER NOT NULL DEFAULT 1 CHECK (active_version > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_requirement_policies_code_uidx
  ON mobilization_requirement_policies(tenant_id, requirement_code)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS mobilization_context_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  requirement_code TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  required_worker_role TEXT,
  external_message TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT mobilization_context_requirements_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT mobilization_context_requirements_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_context_requirements_active_uidx
  ON mobilization_context_requirements(tenant_id, work_order_version_id, requirement_code)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mobilization_readiness_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  crew_assignment_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  vehicle_assignment_id UUID,
  map_work_package_ref TEXT,
  project_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  evaluator_version TEXT NOT NULL DEFAULT 'p6_mobilization_v1',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  overall_status TEXT NOT NULL CHECK (overall_status IN ('not_evaluated', 'in_progress', 'blocked', 'conditional', 'ready')),
  passed_check_count INTEGER NOT NULL DEFAULT 0 CHECK (passed_check_count >= 0),
  blocker_count INTEGER NOT NULL DEFAULT 0 CHECK (blocker_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  supersedes_evaluation_id UUID REFERENCES mobilization_readiness_evaluations(id),
  superseded_by_evaluation_id UUID REFERENCES mobilization_readiness_evaluations(id),
  current BOOLEAN NOT NULL DEFAULT true,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('explicit_request', 'source_event', 'scheduled_reevaluation', 'decision_attempt', 'notice_attempt', 'production_start_attempt')),
  actor_user_id UUID REFERENCES users(id),
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobilization_readiness_evaluations_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT mobilization_readiness_evaluations_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT mobilization_readiness_evaluations_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT mobilization_readiness_evaluations_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT mobilization_readiness_evaluations_tenant_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT mobilization_readiness_evaluations_tenant_crew_assignment_fk
    FOREIGN KEY (tenant_id, crew_assignment_id) REFERENCES partner_work_order_crew_assignments(tenant_id, id),
  CONSTRAINT mobilization_readiness_evaluations_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT mobilization_readiness_evaluations_tenant_vehicle_fk
    FOREIGN KEY (tenant_id, vehicle_assignment_id) REFERENCES partner_vehicle_assignments(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_readiness_evaluations_tenant_id_uidx ON mobilization_readiness_evaluations(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_readiness_evaluations_current_uidx
  ON mobilization_readiness_evaluations(tenant_id, work_order_version_id, crew_assignment_id)
  WHERE current = true;
CREATE INDEX IF NOT EXISTS mobilization_readiness_evaluations_context_idx
  ON mobilization_readiness_evaluations(tenant_id, organization_id, work_order_version_id, overall_status);

CREATE TABLE IF NOT EXISTS mobilization_readiness_check_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evaluation_id UUID NOT NULL,
  requirement_code TEXT NOT NULL,
  requirement_category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'warning', 'waived', 'not_applicable')),
  severity TEXT NOT NULL CHECK (severity IN ('blocker', 'warning', 'info')),
  override_policy TEXT NOT NULL CHECK (override_policy IN ('non_overrideable', 'overrideable_with_expiration', 'warning_only')),
  external_code TEXT,
  internal_detail TEXT,
  external_detail TEXT,
  source_type TEXT,
  source_record_id UUID,
  source_version TEXT,
  source_observed_state TEXT,
  override_id UUID,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobilization_readiness_check_results_tenant_evaluation_fk
    FOREIGN KEY (tenant_id, evaluation_id) REFERENCES mobilization_readiness_evaluations(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_readiness_check_results_eval_code_uidx
  ON mobilization_readiness_check_results(tenant_id, evaluation_id, requirement_code);
CREATE INDEX IF NOT EXISTS mobilization_readiness_check_results_status_idx
  ON mobilization_readiness_check_results(tenant_id, status, severity);

CREATE TABLE IF NOT EXISTS mobilization_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  crew_assignment_id UUID NOT NULL,
  requirement_code TEXT NOT NULL,
  source_evaluation_id UUID,
  reason TEXT NOT NULL,
  external_condition TEXT,
  internal_notes TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'superseded')),
  approved_by_user_id UUID NOT NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by_user_id UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  supersedes_override_id UUID REFERENCES mobilization_overrides(id),
  superseded_by_override_id UUID REFERENCES mobilization_overrides(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobilization_overrides_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT mobilization_overrides_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT mobilization_overrides_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT mobilization_overrides_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT mobilization_overrides_tenant_crew_assignment_fk
    FOREIGN KEY (tenant_id, crew_assignment_id) REFERENCES partner_work_order_crew_assignments(tenant_id, id),
  CONSTRAINT mobilization_overrides_tenant_evaluation_fk
    FOREIGN KEY (tenant_id, source_evaluation_id) REFERENCES mobilization_readiness_evaluations(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_overrides_tenant_id_uidx ON mobilization_overrides(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_overrides_active_uidx
  ON mobilization_overrides(tenant_id, work_order_version_id, crew_assignment_id, requirement_code)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS mobilization_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  crew_assignment_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  vehicle_assignment_id UUID,
  readiness_evaluation_id UUID,
  decision TEXT NOT NULL CHECK (decision IN ('pending', 'approved_to_mobilize', 'conditionally_approved', 'hold', 'revoked')),
  decision_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_by_user_id UUID NOT NULL REFERENCES users(id),
  external_conditions TEXT[] NOT NULL DEFAULT '{}'::text[],
  internal_notes TEXT,
  expires_at TIMESTAMPTZ,
  revocation_reason TEXT,
  supersedes_decision_id UUID REFERENCES mobilization_decisions(id),
  superseded_by_decision_id UUID REFERENCES mobilization_decisions(id),
  current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobilization_decisions_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT mobilization_decisions_tenant_evaluation_fk
    FOREIGN KEY (tenant_id, readiness_evaluation_id) REFERENCES mobilization_readiness_evaluations(tenant_id, id),
  CONSTRAINT mobilization_decisions_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT mobilization_decisions_tenant_crew_assignment_fk
    FOREIGN KEY (tenant_id, crew_assignment_id) REFERENCES partner_work_order_crew_assignments(tenant_id, id),
  CONSTRAINT mobilization_decisions_tenant_vehicle_fk
    FOREIGN KEY (tenant_id, vehicle_assignment_id) REFERENCES partner_vehicle_assignments(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_decisions_tenant_id_uidx ON mobilization_decisions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_decisions_current_uidx
  ON mobilization_decisions(tenant_id, work_order_version_id, crew_assignment_id)
  WHERE current = true;

CREATE TABLE IF NOT EXISTS notice_to_proceed_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notice_number TEXT NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number > 0),
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  crew_assignment_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  vehicle_assignment_id UUID,
  readiness_evaluation_id UUID NOT NULL,
  mobilization_decision_id UUID NOT NULL,
  production_start_status TEXT NOT NULL DEFAULT 'scheduled' CHECK (production_start_status IN ('not_authorized', 'scheduled', 'authorized', 'held', 'revoked', 'superseded')),
  planned_mobilization_date DATE,
  production_start_date DATE NOT NULL,
  production_start_time TIME NOT NULL,
  timezone TEXT NOT NULL,
  initial_map_work_package_ref TEXT NOT NULL,
  initial_work_area TEXT NOT NULL,
  external_instructions TEXT NOT NULL,
  external_conditions TEXT[] NOT NULL DEFAULT '{}'::text[],
  internal_notes TEXT,
  issued_by_user_id UUID NOT NULL REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'acknowledged', 'scheduled', 'authorized', 'held', 'revoked', 'superseded')),
  supersedes_notice_id UUID REFERENCES notice_to_proceed_versions(id),
  superseded_by_notice_id UUID REFERENCES notice_to_proceed_versions(id),
  current BOOLEAN NOT NULL DEFAULT true,
  hold_reason TEXT,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notice_to_proceed_versions_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT notice_to_proceed_versions_tenant_evaluation_fk
    FOREIGN KEY (tenant_id, readiness_evaluation_id) REFERENCES mobilization_readiness_evaluations(tenant_id, id),
  CONSTRAINT notice_to_proceed_versions_tenant_decision_fk
    FOREIGN KEY (tenant_id, mobilization_decision_id) REFERENCES mobilization_decisions(tenant_id, id),
  CONSTRAINT notice_to_proceed_versions_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT notice_to_proceed_versions_tenant_crew_assignment_fk
    FOREIGN KEY (tenant_id, crew_assignment_id) REFERENCES partner_work_order_crew_assignments(tenant_id, id),
  CONSTRAINT notice_to_proceed_versions_tenant_vehicle_fk
    FOREIGN KEY (tenant_id, vehicle_assignment_id) REFERENCES partner_vehicle_assignments(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS notice_to_proceed_versions_tenant_id_uidx ON notice_to_proceed_versions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS notice_to_proceed_versions_number_uidx
  ON notice_to_proceed_versions(tenant_id, notice_number, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS notice_to_proceed_versions_current_uidx
  ON notice_to_proceed_versions(tenant_id, work_order_version_id, crew_assignment_id)
  WHERE current = true AND status IN ('issued', 'acknowledged', 'scheduled', 'authorized');

CREATE TABLE IF NOT EXISTS notice_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notice_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  acknowledged_by_user_id UUID NOT NULL REFERENCES users(id),
  partner_persona TEXT NOT NULL CHECK (partner_persona IN ('partner_admin', 'partner_foreman')),
  crew_id UUID,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledgment_type TEXT NOT NULL DEFAULT 'receipt' CHECK (acknowledgment_type IN ('receipt', 'operational_start_instructions')),
  acknowledgment_text_version TEXT NOT NULL DEFAULT 'p6_notice_ack_v1',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notice_acknowledgments_tenant_notice_fk
    FOREIGN KEY (tenant_id, notice_id) REFERENCES notice_to_proceed_versions(tenant_id, id),
  CONSTRAINT notice_acknowledgments_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT notice_acknowledgments_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS notice_acknowledgments_notice_user_uidx
  ON notice_acknowledgments(tenant_id, notice_id, acknowledged_by_user_id, acknowledgment_type)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS production_start_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notice_id UUID NOT NULL,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  crew_assignment_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  vehicle_assignment_id UUID,
  authorization_status TEXT NOT NULL CHECK (authorization_status IN ('not_authorized', 'scheduled', 'authorized', 'held', 'revoked', 'superseded')),
  start_date DATE NOT NULL,
  start_time TIME NOT NULL,
  timezone TEXT NOT NULL,
  map_work_package_ref TEXT NOT NULL,
  work_area TEXT NOT NULL,
  authorized_by_user_id UUID NOT NULL REFERENCES users(id),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_authorization_id UUID REFERENCES production_start_authorizations(id),
  superseded_by_authorization_id UUID REFERENCES production_start_authorizations(id),
  current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT production_start_authorizations_tenant_notice_fk
    FOREIGN KEY (tenant_id, notice_id) REFERENCES notice_to_proceed_versions(tenant_id, id),
  CONSTRAINT production_start_authorizations_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT production_start_authorizations_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT production_start_authorizations_tenant_crew_assignment_fk
    FOREIGN KEY (tenant_id, crew_assignment_id) REFERENCES partner_work_order_crew_assignments(tenant_id, id),
  CONSTRAINT production_start_authorizations_tenant_vehicle_fk
    FOREIGN KEY (tenant_id, vehicle_assignment_id) REFERENCES partner_vehicle_assignments(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS production_start_authorizations_tenant_id_uidx ON production_start_authorizations(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS production_start_authorizations_current_uidx
  ON production_start_authorizations(tenant_id, work_order_version_id, crew_assignment_id)
  WHERE current = true AND authorization_status IN ('scheduled', 'authorized');

CREATE TABLE IF NOT EXISTS mobilization_source_event_invalidations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_event_id UUID REFERENCES events(id),
  source_fingerprint TEXT NOT NULL,
  source_event_type TEXT NOT NULL,
  source_aggregate_type TEXT NOT NULL,
  source_aggregate_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  crew_assignment_id UUID NOT NULL,
  readiness_evaluation_id UUID,
  mobilization_decision_id UUID,
  status TEXT NOT NULL CHECK (status IN ('blocked', 'ignored')),
  blocker_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobilization_source_event_invalidations_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT mobilization_source_event_invalidations_tenant_crew_assignment_fk
    FOREIGN KEY (tenant_id, crew_assignment_id) REFERENCES partner_work_order_crew_assignments(tenant_id, id),
  CONSTRAINT mobilization_source_event_invalidations_tenant_evaluation_fk
    FOREIGN KEY (tenant_id, readiness_evaluation_id) REFERENCES mobilization_readiness_evaluations(tenant_id, id),
  CONSTRAINT mobilization_source_event_invalidations_tenant_decision_fk
    FOREIGN KEY (tenant_id, mobilization_decision_id) REFERENCES mobilization_decisions(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_source_event_invalidations_event_context_uidx
  ON mobilization_source_event_invalidations(tenant_id, source_event_id, work_order_version_id, crew_assignment_id)
  WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mobilization_source_event_invalidations_fingerprint_context_uidx
  ON mobilization_source_event_invalidations(tenant_id, source_fingerprint, work_order_version_id, crew_assignment_id);
CREATE INDEX IF NOT EXISTS mobilization_source_event_invalidations_context_idx
  ON mobilization_source_event_invalidations(tenant_id, work_order_version_id, crew_assignment_id, source_event_type);
