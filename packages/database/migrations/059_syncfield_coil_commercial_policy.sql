ALTER TABLE accepted_production_financial_sources
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'accepted_production',
  ADD COLUMN IF NOT EXISTS coil_observation_id UUID,
  ADD COLUMN IF NOT EXISTS customer_coil_policy_id UUID,
  ADD COLUMN IF NOT EXISTS partner_coil_policy_id UUID,
  ADD COLUMN IF NOT EXISTS commercial_treatment TEXT,
  ADD COLUMN IF NOT EXISTS policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS rate_revision_locked_at TIMESTAMPTZ;

ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_kind_check;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_kind_check CHECK (
  source_kind IN ('accepted_production', 'customer_coil_supplement', 'partner_coil_supplement')
);

ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_commercial_treatment_check;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_commercial_treatment_check CHECK (
  commercial_treatment IS NULL OR commercial_treatment IN ('billable_as_footage', 'included_in_route_rate', 'separate_pay_item', 'non_billable', 'unconfirmed')
);

CREATE TABLE IF NOT EXISTS syncfield_coil_commercial_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID,
  work_order_id UUID NOT NULL,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer', 'partner')),
  counterparty_organization_id UUID NOT NULL,
  production_code_id UUID,
  coil_type TEXT CHECK (coil_type IS NULL OR coil_type IN ('front_easement','rear_easement','express_splice','butt_splice','riser_slack','general_slack','customer_required','field_condition','other')),
  easement_type TEXT CHECK (easement_type IS NULL OR easement_type IN ('front','rear','unknown','not_applicable')),
  treatment TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (treatment IN ('billable_as_footage', 'included_in_route_rate', 'separate_pay_item', 'non_billable', 'unconfirmed')),
  separate_production_code_id UUID,
  effective_from DATE NOT NULL,
  effective_to DATE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  source_type TEXT NOT NULL DEFAULT 'other' CHECK (source_type IN ('customer_rate_sheet','partner_rate_sheet','msa','work_order','change_order','customer_email','partner_agreement','written_direction','other')),
  source_file_object_id UUID,
  source_reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'void')),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by_policy_id UUID,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT syncfield_coil_commercial_policies_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT syncfield_coil_commercial_policies_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT syncfield_coil_commercial_policies_counterparty_fk
    FOREIGN KEY (tenant_id, counterparty_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT syncfield_coil_commercial_policies_code_fk
    FOREIGN KEY (tenant_id, production_code_id) REFERENCES syncfield_production_codes(tenant_id, id),
  CONSTRAINT syncfield_coil_commercial_policies_separate_code_fk
    FOREIGN KEY (tenant_id, separate_production_code_id) REFERENCES syncfield_production_codes(tenant_id, id),
  CONSTRAINT syncfield_coil_commercial_policies_source_file_fk
    FOREIGN KEY (tenant_id, source_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id),
  CONSTRAINT syncfield_coil_commercial_policies_superseded_fk
    FOREIGN KEY (tenant_id, superseded_by_policy_id) REFERENCES syncfield_coil_commercial_policies(tenant_id, id),
  CONSTRAINT syncfield_coil_commercial_policies_dates_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT syncfield_coil_commercial_policies_separate_code_check
    CHECK (treatment <> 'separate_pay_item' OR separate_production_code_id IS NOT NULL),
  CONSTRAINT syncfield_coil_commercial_policies_source_check
    CHECK (treatment = 'unconfirmed' OR source_file_object_id IS NOT NULL OR NULLIF(trim(COALESCE(source_reference, '')), '') IS NOT NULL OR NULLIF(trim(COALESCE(notes, '')), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS syncfield_coil_commercial_policies_scope_idx
  ON syncfield_coil_commercial_policies(tenant_id, work_order_id, party_type, status, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS syncfield_coil_commercial_policies_counterparty_idx
  ON syncfield_coil_commercial_policies(tenant_id, counterparty_organization_id, party_type);
CREATE INDEX IF NOT EXISTS syncfield_coil_commercial_policies_specificity_idx
  ON syncfield_coil_commercial_policies(tenant_id, work_order_id, party_type, production_code_id, coil_type, easement_type)
  WHERE deleted_at IS NULL AND status = 'active';

ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_coil_fk;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_coil_fk
  FOREIGN KEY (tenant_id, coil_observation_id) REFERENCES syncfield_coil_observations(tenant_id, id) NOT VALID;
ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_customer_coil_policy_fk;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_customer_coil_policy_fk
  FOREIGN KEY (tenant_id, customer_coil_policy_id) REFERENCES syncfield_coil_commercial_policies(tenant_id, id) NOT VALID;
ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_partner_coil_policy_fk;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_partner_coil_policy_fk
  FOREIGN KEY (tenant_id, partner_coil_policy_id) REFERENCES syncfield_coil_commercial_policies(tenant_id, id) NOT VALID;

DROP INDEX IF EXISTS accepted_production_sources_decision_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS accepted_production_sources_decision_base_uidx
  ON accepted_production_financial_sources(tenant_id, customer_qc_decision_id)
  WHERE deleted_at IS NULL AND financial_status <> 'void' AND source_kind = 'accepted_production';
CREATE UNIQUE INDEX IF NOT EXISTS accepted_production_sources_customer_coil_uidx
  ON accepted_production_financial_sources(tenant_id, customer_qc_decision_id, coil_observation_id)
  WHERE deleted_at IS NULL AND financial_status <> 'void' AND source_kind = 'customer_coil_supplement';
CREATE UNIQUE INDEX IF NOT EXISTS accepted_production_sources_partner_coil_uidx
  ON accepted_production_financial_sources(tenant_id, customer_qc_decision_id, coil_observation_id)
  WHERE deleted_at IS NULL AND financial_status <> 'void' AND source_kind = 'partner_coil_supplement';
CREATE INDEX IF NOT EXISTS accepted_production_sources_kind_idx
  ON accepted_production_financial_sources(tenant_id, source_kind, financial_status);

ALTER TABLE financial_exceptions DROP CONSTRAINT IF EXISTS financial_exceptions_type_check;
ALTER TABLE financial_exceptions ADD CONSTRAINT financial_exceptions_type_check CHECK (
  exception_type IN (
    'missing_customer_rate',
    'missing_partner_rate',
    'rate_unit_mismatch',
    'post_billing_customer_qc_change',
    'billing_hold',
    'pay_when_paid_allocation',
    'financial_scope_mismatch',
    'payment_destination_not_ready',
    'payment_provider_failure',
    'partner_recovery_required',
    'post_billing_adjustment_required',
    'coil_commercial_clarification',
    'missing_coil_rate_mapping'
  )
);
