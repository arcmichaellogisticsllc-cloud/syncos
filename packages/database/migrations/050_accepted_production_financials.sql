ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_rate_schedule_id UUID;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_customer_rate_schedule_tenant_fk;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_customer_rate_schedule_tenant_fk
  FOREIGN KEY (tenant_id, customer_rate_schedule_id) REFERENCES rate_schedules(tenant_id, id) NOT VALID;

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_deadline DATE;

ALTER TABLE billable_items ALTER COLUMN qc_review_id DROP NOT NULL;
ALTER TABLE billable_items
  ADD COLUMN IF NOT EXISTS customer_qc_decision_id UUID,
  ADD COLUMN IF NOT EXISTS accepted_production_source_id UUID,
  ADD COLUMN IF NOT EXISTS rate_schedule_id UUID,
  ADD COLUMN IF NOT EXISTS rate_schedule_version TEXT,
  ADD COLUMN IF NOT EXISTS rate_effective_date DATE,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS source_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS billing_exception_status TEXT NOT NULL DEFAULT 'none';

ALTER TABLE settlement_items
  ADD COLUMN IF NOT EXISTS accepted_production_source_id UUID,
  ADD COLUMN IF NOT EXISTS partner_rate_schedule_id UUID,
  ADD COLUMN IF NOT EXISTS partner_rate_schedule_version TEXT,
  ADD COLUMN IF NOT EXISTS partner_rate_effective_date DATE,
  ADD COLUMN IF NOT EXISTS partner_organization_id UUID;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS p12_source_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS p12_invoice_balance_basis TEXT NOT NULL DEFAULT 'invoice_minus_applications',
  ADD COLUMN IF NOT EXISTS p12_retained_balance_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS accepted_production_source_id UUID;

ALTER TABLE cash_receipts
  ADD COLUMN IF NOT EXISTS clearance_status TEXT NOT NULL DEFAULT 'not_cleared',
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleared_by UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE contractor_payables
  ADD COLUMN IF NOT EXISTS partner_organization_id UUID,
  ADD COLUMN IF NOT EXISTS eligible_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ineligible_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eligible_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_due_at DATE,
  ADD COLUMN IF NOT EXISTS pay_when_paid_status TEXT NOT NULL DEFAULT 'awaiting_customer_funds';

ALTER TABLE contractor_payable_items
  ADD COLUMN IF NOT EXISTS accepted_production_source_id UUID,
  ADD COLUMN IF NOT EXISTS funded_customer_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eligible_partner_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS accepted_production_financial_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  partner_organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  crew_id UUID,
  production_record_id UUID NOT NULL,
  customer_qc_cycle_id UUID NOT NULL,
  customer_qc_decision_id UUID NOT NULL,
  production_code_id UUID,
  production_code TEXT NOT NULL,
  production_description TEXT,
  accepted_quantity NUMERIC(14,4) NOT NULL CHECK (accepted_quantity > 0),
  unit_of_measure TEXT NOT NULL,
  customer_rate_code_id UUID,
  customer_rate_schedule_id UUID,
  customer_rate NUMERIC(14,4),
  customer_extended_amount NUMERIC(14,2),
  partner_rate_code_id UUID,
  partner_rate_schedule_id UUID,
  partner_rate NUMERIC(14,4),
  partner_extended_amount NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  financial_status TEXT NOT NULL DEFAULT 'eligible',
  source_fingerprint TEXT NOT NULL,
  billable_item_id UUID,
  settlement_item_id UUID,
  invoice_item_id UUID,
  contractor_payable_item_id UUID,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT accepted_production_sources_status_check CHECK (financial_status IN ('eligible', 'billable_created', 'invoiced', 'settled', 'payable_created', 'exception', 'void')),
  CONSTRAINT accepted_production_sources_project_fk FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT accepted_production_sources_work_order_fk FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT accepted_production_sources_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT accepted_production_sources_provider_fk FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT accepted_production_sources_crew_fk FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT accepted_production_sources_record_fk FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records(tenant_id, id),
  CONSTRAINT accepted_production_sources_cycle_fk FOREIGN KEY (tenant_id, customer_qc_cycle_id) REFERENCES customer_qc_cycles(tenant_id, id),
  CONSTRAINT accepted_production_sources_decision_fk FOREIGN KEY (tenant_id, customer_qc_decision_id) REFERENCES customer_qc_decisions(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS accepted_production_sources_decision_uidx
  ON accepted_production_financial_sources(tenant_id, customer_qc_decision_id)
  WHERE deleted_at IS NULL AND financial_status <> 'void';
CREATE INDEX IF NOT EXISTS accepted_production_sources_partner_idx
  ON accepted_production_financial_sources(tenant_id, partner_organization_id, financial_status);
CREATE INDEX IF NOT EXISTS accepted_production_sources_work_order_idx
  ON accepted_production_financial_sources(tenant_id, work_order_id, financial_status);

CREATE TABLE IF NOT EXISTS payment_application_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_application_id UUID NOT NULL,
  invoice_item_id UUID NOT NULL,
  billable_item_id UUID,
  accepted_production_source_id UUID,
  allocated_customer_amount NUMERIC(14,2) NOT NULL CHECK (allocated_customer_amount >= 0),
  allocation_method TEXT NOT NULL DEFAULT 'invoice_item_prorata',
  allocation_version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT payment_application_allocations_method_check CHECK (allocation_method IN ('line_level', 'invoice_item_prorata')),
  CONSTRAINT payment_application_allocations_application_fk FOREIGN KEY (tenant_id, payment_application_id) REFERENCES payment_applications(tenant_id, id),
  CONSTRAINT payment_application_allocations_invoice_item_fk FOREIGN KEY (tenant_id, invoice_item_id) REFERENCES invoice_items(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_application_allocations_unique_uidx
  ON payment_application_allocations(tenant_id, payment_application_id, invoice_item_id, allocation_version)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contractor_payable_eligibility_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contractor_payable_id UUID NOT NULL,
  calculation_version INTEGER NOT NULL,
  cleared_customer_funds NUMERIC(14,2) NOT NULL DEFAULT 0,
  allocated_customer_funds NUMERIC(14,2) NOT NULL DEFAULT 0,
  eligible_partner_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  eligible_at TIMESTAMPTZ,
  payment_due_at DATE,
  source_payment_application_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, contractor_payable_id, calculation_version),
  CONSTRAINT payable_eligibility_snapshots_status_check CHECK (status IN ('awaiting_customer_funds', 'partially_eligible', 'eligible', 'held', 'reversed')),
  CONSTRAINT payable_eligibility_snapshots_payable_fk FOREIGN KEY (tenant_id, contractor_payable_id) REFERENCES contractor_payables(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS financial_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  severity TEXT NOT NULL DEFAULT 'blocking',
  project_id UUID,
  work_order_id UUID,
  partner_organization_id UUID,
  production_record_id UUID,
  customer_qc_decision_id UUID,
  billable_item_id UUID,
  settlement_item_id UUID,
  invoice_id UUID,
  contractor_payable_id UUID,
  message TEXT NOT NULL,
  safe_resolution_hint TEXT NOT NULL,
  source_fingerprint TEXT,
  created_by_user_id UUID REFERENCES users(id),
  resolved_by_user_id UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT financial_exceptions_type_check CHECK (exception_type IN ('missing_customer_rate', 'missing_partner_rate', 'rate_unit_mismatch', 'post_billing_customer_qc_change', 'billing_hold', 'pay_when_paid_allocation', 'financial_scope_mismatch')),
  CONSTRAINT financial_exceptions_status_check CHECK (status IN ('open', 'acknowledged', 'resolved', 'void'))
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_exceptions_fingerprint_uidx
  ON financial_exceptions(tenant_id, exception_type, source_fingerprint)
  WHERE deleted_at IS NULL AND status <> 'void' AND source_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_exceptions_scope_idx ON financial_exceptions(tenant_id, status, exception_type);

CREATE UNIQUE INDEX IF NOT EXISTS billable_items_p12_source_uidx
  ON billable_items(tenant_id, accepted_production_source_id)
  WHERE accepted_production_source_id IS NOT NULL AND status NOT IN ('voided', 'archived') AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS settlement_items_p12_source_uidx
  ON settlement_items(tenant_id, accepted_production_source_id)
  WHERE accepted_production_source_id IS NOT NULL AND status NOT IN ('voided', 'archived') AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_p12_source_uidx
  ON invoice_items(tenant_id, accepted_production_source_id)
  WHERE accepted_production_source_id IS NOT NULL AND status NOT IN ('voided', 'archived') AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contractor_payable_items_p12_source_uidx
  ON contractor_payable_items(tenant_id, accepted_production_source_id)
  WHERE accepted_production_source_id IS NOT NULL AND status NOT IN ('voided', 'archived') AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cash_receipts_idempotency_uidx
  ON cash_receipts(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_billable_fk;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_billable_fk
  FOREIGN KEY (tenant_id, billable_item_id) REFERENCES billable_items(tenant_id, id) NOT VALID;
ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_settlement_item_fk;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_settlement_item_fk
  FOREIGN KEY (tenant_id, settlement_item_id) REFERENCES settlement_items(tenant_id, id) NOT VALID;
ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_invoice_item_fk;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_invoice_item_fk
  FOREIGN KEY (tenant_id, invoice_item_id) REFERENCES invoice_items(tenant_id, id) NOT VALID;
ALTER TABLE accepted_production_financial_sources DROP CONSTRAINT IF EXISTS accepted_production_sources_payable_item_fk;
ALTER TABLE accepted_production_financial_sources ADD CONSTRAINT accepted_production_sources_payable_item_fk
  FOREIGN KEY (tenant_id, contractor_payable_item_id) REFERENCES contractor_payable_items(tenant_id, id) NOT VALID;
