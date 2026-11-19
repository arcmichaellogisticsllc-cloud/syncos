CREATE UNIQUE INDEX IF NOT EXISTS contracts_tenant_id_id_uidx ON contracts(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS rate_schedules_tenant_id_id_uidx ON rate_schedules(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS rate_codes_tenant_id_id_uidx ON rate_codes(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_id_id_uidx ON projects(tenant_id, id);

ALTER TABLE partner_restricted_file_objects DROP CONSTRAINT IF EXISTS partner_restricted_file_objects_category_check;
ALTER TABLE partner_restricted_file_objects ADD CONSTRAINT partner_restricted_file_objects_category_check CHECK (category IN (
  'worker_headshot',
  'worker_credential_evidence',
  'partner_msa_executed',
  'partner_msa_amendment_executed',
  'partner_work_order_executed',
  'partner_vehicle_agreement_executed'
));

ALTER TABLE partner_restricted_file_objects DROP CONSTRAINT IF EXISTS partner_restricted_file_objects_related_entity_type_check;
ALTER TABLE partner_restricted_file_objects ADD CONSTRAINT partner_restricted_file_objects_related_entity_type_check CHECK (related_entity_type IN (
  'worker',
  'worker_headshot',
  'worker_credential',
  'partner_agreement_version',
  'partner_work_order_version',
  'partner_vehicle_assignment'
));

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS partner_organization_id UUID;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS capacity_provider_id UUID;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS agreement_lifecycle_status TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS agreement_effective_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS agreement_terminated_at TIMESTAMPTZ;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS agreement_termination_reason TEXT;
ALTER TABLE contracts ADD CONSTRAINT contracts_tenant_partner_org_fk
  FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id);
ALTER TABLE contracts ADD CONSTRAINT contracts_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id);

CREATE TABLE IF NOT EXISTS partner_agreement_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  amendment BOOLEAN NOT NULL DEFAULT false,
  prior_version_id UUID REFERENCES partner_agreement_versions(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_executed', 'executed', 'effective', 'superseded', 'voided', 'terminated')),
  issued_date DATE,
  effective_date DATE,
  executed_at TIMESTAMPTZ,
  artifact_file_object_id UUID,
  artifact_verified_at TIMESTAMPTZ,
  artifact_verified_by_user_id UUID REFERENCES users(id),
  pay_when_paid BOOLEAN NOT NULL DEFAULT true,
  partner_invoice_required BOOLEAN NOT NULL DEFAULT false,
  payout_after_cleared_funds_business_days INTEGER NOT NULL DEFAULT 3 CHECK (payout_after_cleared_funds_business_days >= 0),
  partial_customer_payment_pro_rata BOOLEAN NOT NULL DEFAULT true,
  customer_retainage_pass_through_may_apply BOOLEAN NOT NULL DEFAULT true,
  settlement_dispute_window_calendar_days INTEGER NOT NULL DEFAULT 10 CHECK (settlement_dispute_window_calendar_days > 0),
  workmanship_warranty_months INTEGER NOT NULL DEFAULT 12 CHECK (workmanship_warranty_months >= 0),
  no_guaranteed_work BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_agreement_versions_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_agreement_versions_tenant_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_agreement_versions_tenant_contract_fk
    FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts(tenant_id, id),
  CONSTRAINT partner_agreement_versions_tenant_artifact_fk
    FOREIGN KEY (tenant_id, artifact_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_agreement_versions_tenant_id_uidx ON partner_agreement_versions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_agreement_versions_current_uidx
  ON partner_agreement_versions(tenant_id, contract_id)
  WHERE deleted_at IS NULL AND status IN ('draft', 'issued', 'partially_executed', 'executed', 'effective');
CREATE UNIQUE INDEX IF NOT EXISTS partner_agreement_versions_number_uidx
  ON partner_agreement_versions(tenant_id, contract_id, version_number)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS partner_agreement_versions_org_idx ON partner_agreement_versions(tenant_id, organization_id, status);

CREATE TABLE IF NOT EXISTS partner_document_signatories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('master_agreement', 'work_order', 'vehicle_agreement')),
  document_version_id UUID NOT NULL,
  contact_id UUID,
  tenant_user_id UUID,
  full_legal_name TEXT NOT NULL,
  title TEXT NOT NULL,
  signer_role TEXT NOT NULL CHECK (signer_role IN ('partner_representative_1', 'partner_representative_2', 'sync_representative')),
  authorization_status TEXT NOT NULL DEFAULT 'authorized' CHECK (authorization_status IN ('pending', 'authorized', 'inactive', 'revoked')),
  effective_start_date DATE DEFAULT CURRENT_DATE,
  effective_end_date DATE,
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_document_signatories_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_document_signatories_tenant_contact_fk
    FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id),
  CONSTRAINT partner_document_signatories_tenant_tenant_user_fk
    FOREIGN KEY (tenant_id, tenant_user_id) REFERENCES tenant_users(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_document_signatories_tenant_id_uidx ON partner_document_signatories(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_document_signatories_role_uidx
  ON partner_document_signatories(tenant_id, document_type, document_version_id, signer_role)
  WHERE deleted_at IS NULL AND authorization_status <> 'revoked';

CREATE TABLE IF NOT EXISTS partner_document_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  signatory_id UUID NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('master_agreement', 'work_order', 'vehicle_agreement')),
  document_version_id UUID NOT NULL,
  signer_role TEXT NOT NULL,
  signed_date DATE NOT NULL,
  submission_source TEXT NOT NULL DEFAULT 'manual_metadata' CHECK (submission_source IN ('manual_metadata', 'manual_artifact')),
  verification_status TEXT NOT NULL DEFAULT 'submitted' CHECK (verification_status IN ('submitted', 'verified', 'returned', 'rejected', 'withdrawn')),
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_document_signatures_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_document_signatures_tenant_signatory_fk
    FOREIGN KEY (tenant_id, signatory_id) REFERENCES partner_document_signatories(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_document_signatures_tenant_id_uidx ON partner_document_signatures(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_document_signatures_current_uidx
  ON partner_document_signatures(tenant_id, signatory_id)
  WHERE deleted_at IS NULL AND verification_status IN ('submitted', 'verified');

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS partner_organization_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS partner_rate_schedule_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS governing_agreement_version_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS partner_execution_status TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS partner_effective_date DATE;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_tenant_partner_org_fk
  FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id);
ALTER TABLE work_orders ADD CONSTRAINT work_orders_tenant_partner_rate_schedule_fk
  FOREIGN KEY (tenant_id, partner_rate_schedule_id) REFERENCES rate_schedules(tenant_id, id);
ALTER TABLE work_orders ADD CONSTRAINT work_orders_tenant_governing_agreement_version_fk
  FOREIGN KEY (tenant_id, governing_agreement_version_id) REFERENCES partner_agreement_versions(tenant_id, id);

CREATE TABLE IF NOT EXISTS partner_work_order_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number > 0),
  prior_version_id UUID REFERENCES partner_work_order_versions(id),
  governing_agreement_version_id UUID NOT NULL,
  assigned_crew_id UUID NOT NULL,
  rate_schedule_id UUID NOT NULL,
  rate_code_id UUID,
  work_order_number TEXT NOT NULL,
  scope_summary TEXT NOT NULL,
  primary_work_area TEXT,
  map_work_package_ref TEXT NOT NULL,
  production_unit TEXT NOT NULL,
  performance_target NUMERIC(14,2),
  housing_responsibility TEXT NOT NULL DEFAULT 'project_specific' CHECK (housing_responsibility IN ('partner', 'sync', 'customer', 'project_specific', 'not_applicable')),
  traffic_control_responsibility TEXT NOT NULL DEFAULT 'project_specific' CHECK (traffic_control_responsibility IN ('partner', 'sync', 'customer', 'project_specific', 'not_applicable')),
  fuel_tolls_responsibility TEXT NOT NULL DEFAULT 'partner' CHECK (fuel_tolls_responsibility IN ('partner', 'sync', 'customer', 'project_specific')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_executed', 'executed', 'active', 'suspended', 'terminated', 'superseded', 'voided')),
  issued_date DATE,
  effective_date DATE,
  artifact_file_object_id UUID,
  artifact_verified_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_work_order_versions_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_work_order_versions_tenant_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_work_order_versions_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT partner_work_order_versions_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT partner_work_order_versions_tenant_agreement_fk
    FOREIGN KEY (tenant_id, governing_agreement_version_id) REFERENCES partner_agreement_versions(tenant_id, id),
  CONSTRAINT partner_work_order_versions_tenant_crew_fk
    FOREIGN KEY (tenant_id, assigned_crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT partner_work_order_versions_tenant_rate_schedule_fk
    FOREIGN KEY (tenant_id, rate_schedule_id) REFERENCES rate_schedules(tenant_id, id),
  CONSTRAINT partner_work_order_versions_tenant_rate_code_fk
    FOREIGN KEY (tenant_id, rate_code_id) REFERENCES rate_codes(tenant_id, id),
  CONSTRAINT partner_work_order_versions_tenant_artifact_fk
    FOREIGN KEY (tenant_id, artifact_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_work_order_versions_tenant_id_uidx ON partner_work_order_versions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_work_order_versions_current_uidx
  ON partner_work_order_versions(tenant_id, work_order_id)
  WHERE deleted_at IS NULL AND status IN ('draft', 'issued', 'partially_executed', 'executed', 'active', 'suspended');
CREATE UNIQUE INDEX IF NOT EXISTS partner_work_order_versions_number_uidx
  ON partner_work_order_versions(tenant_id, work_order_id, version_number)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS partner_work_order_versions_org_idx ON partner_work_order_versions(tenant_id, organization_id, status);

CREATE TABLE IF NOT EXISTS partner_work_order_crew_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'superseded')),
  assigned_by_user_id UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  ended_by_user_id UUID REFERENCES users(id),
  ended_reason TEXT,
  CONSTRAINT partner_work_order_crew_assignments_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_work_order_crew_assignments_tenant_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_work_order_crew_assignments_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT partner_work_order_crew_assignments_tenant_version_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT partner_work_order_crew_assignments_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_work_order_crew_assignments_active_uidx
  ON partner_work_order_crew_assignments(tenant_id, work_order_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS partner_work_order_crew_assignments_tenant_id_uidx ON partner_work_order_crew_assignments(tenant_id, id);

CREATE TABLE IF NOT EXISTS partner_vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  equipment_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  rental_provider TEXT,
  sync_possession_date DATE,
  partner_custody_start_date DATE,
  partner_return_release_date DATE,
  daily_allocation_amount NUMERIC(14,2) NOT NULL CHECK (daily_allocation_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  allocation_unit TEXT NOT NULL DEFAULT 'calendar_day' CHECK (allocation_unit IN ('calendar_day')),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  odometer_at_assignment NUMERIC(14,1) CHECK (odometer_at_assignment IS NULL OR odometer_at_assignment >= 0),
  odometer_at_return NUMERIC(14,1) CHECK (odometer_at_return IS NULL OR odometer_at_return >= 0),
  fuel_level_at_assignment TEXT,
  fuel_level_at_return TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_execution', 'assigned', 'active_custody', 'return_pending', 'returned', 'closed', 'suspended', 'voided')),
  artifact_file_object_id UUID,
  artifact_verified_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id),
  returned_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_vehicle_assignments_dates_check CHECK (
    partner_custody_start_date IS NULL OR partner_return_release_date IS NULL OR partner_return_release_date >= partner_custody_start_date
  ),
  CONSTRAINT partner_vehicle_assignments_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_vehicle_assignments_tenant_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_vehicle_assignments_tenant_equipment_fk
    FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id),
  CONSTRAINT partner_vehicle_assignments_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT partner_vehicle_assignments_tenant_version_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT partner_vehicle_assignments_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT partner_vehicle_assignments_tenant_artifact_fk
    FOREIGN KEY (tenant_id, artifact_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_vehicle_assignments_tenant_id_uidx ON partner_vehicle_assignments(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_vehicle_assignments_active_equipment_uidx
  ON partner_vehicle_assignments(tenant_id, equipment_id)
  WHERE deleted_at IS NULL AND status IN ('assigned', 'active_custody', 'return_pending');
CREATE INDEX IF NOT EXISTS partner_vehicle_assignments_org_idx ON partner_vehicle_assignments(tenant_id, organization_id, status);

CREATE TABLE IF NOT EXISTS partner_vehicle_operator_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  vehicle_assignment_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  authorization_role TEXT NOT NULL DEFAULT 'operator' CHECK (authorization_role IN ('driver', 'operator', 'driver_operator')),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  qualification_status TEXT NOT NULL DEFAULT 'approved' CHECK (qualification_status IN ('approved', 'expired', 'revoked')),
  approved_by_user_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_by_user_id UUID REFERENCES users(id),
  ended_reason TEXT,
  CONSTRAINT partner_vehicle_operator_authorizations_dates_check CHECK (end_date IS NULL OR end_date >= effective_date),
  CONSTRAINT partner_vehicle_operator_authorizations_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_vehicle_operator_authorizations_tenant_assignment_fk
    FOREIGN KEY (tenant_id, vehicle_assignment_id) REFERENCES partner_vehicle_assignments(tenant_id, id),
  CONSTRAINT partner_vehicle_operator_authorizations_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT partner_vehicle_operator_authorizations_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_vehicle_operator_authorizations_active_uidx
  ON partner_vehicle_operator_authorizations(tenant_id, vehicle_assignment_id, worker_id)
  WHERE end_date IS NULL AND qualification_status = 'approved';
CREATE UNIQUE INDEX IF NOT EXISTS partner_vehicle_operator_authorizations_tenant_id_uidx ON partner_vehicle_operator_authorizations(tenant_id, id);

CREATE TABLE IF NOT EXISTS partner_vehicle_condition_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  vehicle_assignment_id UUID NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('pre_assignment', 'return')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  odometer NUMERIC(14,1) CHECK (odometer IS NULL OR odometer >= 0),
  fuel_level TEXT,
  known_damage TEXT,
  tires_status TEXT,
  lights_status TEXT,
  brakes_steering_status TEXT,
  pto_hydraulics_status TEXT,
  outriggers_status TEXT,
  boom_bucket_controls_status TEXT,
  emergency_lowering_status TEXT,
  fall_protection_anchor_status TEXT,
  safety_equipment_status TEXT,
  leaks_warning_lights TEXT,
  external_notes TEXT,
  internal_notes TEXT,
  recorded_by_user_id UUID REFERENCES users(id),
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_vehicle_condition_records_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_vehicle_condition_records_tenant_assignment_fk
    FOREIGN KEY (tenant_id, vehicle_assignment_id) REFERENCES partner_vehicle_assignments(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_vehicle_condition_records_tenant_id_uidx ON partner_vehicle_condition_records(tenant_id, id);
