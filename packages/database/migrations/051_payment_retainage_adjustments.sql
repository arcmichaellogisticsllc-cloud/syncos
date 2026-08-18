ALTER TABLE contractor_payables
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS in_flight_payment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retained_balance_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_execution_status TEXT NOT NULL DEFAULT 'not_started';

UPDATE contractor_payables
SET retained_balance_amount = retainage_amount
WHERE retained_balance_amount = 0 AND retainage_amount > 0;

CREATE TABLE IF NOT EXISTS partner_payment_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  contractor_payable_id UUID NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT NOT NULL DEFAULT 'priority_passport',
  payment_profile_id UUID,
  status TEXT NOT NULL DEFAULT 'approved',
  requested_by_user_id UUID REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by_user_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  provider_reference TEXT,
  failure_reason_safe TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT partner_payment_instructions_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_payment_instructions_provider_fk FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_payment_instructions_payable_fk FOREIGN KEY (tenant_id, contractor_payable_id) REFERENCES contractor_payables(tenant_id, id),
  CONSTRAINT partner_payment_instructions_profile_fk FOREIGN KEY (tenant_id, payment_profile_id) REFERENCES partner_payment_profiles(tenant_id, id),
  CONSTRAINT partner_payment_instructions_status_check CHECK (status IN ('draft', 'pending_approval', 'approved', 'submitted', 'processing', 'confirmed', 'failed', 'returned', 'void'))
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_payment_instructions_idempotency_uidx
  ON partner_payment_instructions(tenant_id, idempotency_key)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS partner_payment_instructions_payable_idx
  ON partner_payment_instructions(tenant_id, contractor_payable_id, status);
CREATE INDEX IF NOT EXISTS partner_payment_instructions_partner_idx
  ON partner_payment_instructions(tenant_id, partner_organization_id, status);

CREATE TABLE IF NOT EXISTS partner_payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_instruction_id UUID NOT NULL,
  contractor_payable_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider_name TEXT NOT NULL DEFAULT 'local_test_provider',
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason_safe TEXT,
  idempotency_key TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, payment_instruction_id, attempt_number),
  CONSTRAINT partner_payment_attempts_instruction_fk FOREIGN KEY (tenant_id, payment_instruction_id) REFERENCES partner_payment_instructions(tenant_id, id),
  CONSTRAINT partner_payment_attempts_payable_fk FOREIGN KEY (tenant_id, contractor_payable_id) REFERENCES contractor_payables(tenant_id, id),
  CONSTRAINT partner_payment_attempts_status_check CHECK (status IN ('submitted', 'processing', 'confirmed', 'failed', 'returned', 'void'))
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_payment_attempts_idempotency_uidx
  ON partner_payment_attempts(tenant_id, idempotency_key)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS partner_payment_attempts_provider_uidx
  ON partner_payment_attempts(tenant_id, provider_reference)
  WHERE provider_reference IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS retainage_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_organization_id UUID NOT NULL,
  contractor_payable_id UUID NOT NULL,
  settlement_item_id UUID,
  retained_amount NUMERIC(14,2) NOT NULL CHECK (retained_amount >= 0),
  release_amount NUMERIC(14,2) NOT NULL CHECK (release_amount > 0),
  release_reason TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  authorized_by_user_id UUID REFERENCES users(id),
  authorized_at TIMESTAMPTZ,
  release_payable_id UUID,
  idempotency_key TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT retainage_releases_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT retainage_releases_payable_fk FOREIGN KEY (tenant_id, contractor_payable_id) REFERENCES contractor_payables(tenant_id, id),
  CONSTRAINT retainage_releases_item_fk FOREIGN KEY (tenant_id, settlement_item_id) REFERENCES settlement_items(tenant_id, id),
  CONSTRAINT retainage_releases_release_payable_fk FOREIGN KEY (tenant_id, release_payable_id) REFERENCES contractor_payables(tenant_id, id),
  CONSTRAINT retainage_releases_status_check CHECK (status IN ('pending', 'authorized', 'released_to_payable', 'void'))
);

CREATE UNIQUE INDEX IF NOT EXISTS retainage_releases_idempotency_uidx
  ON retainage_releases(tenant_id, idempotency_key)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS retainage_releases_payable_idx
  ON retainage_releases(tenant_id, contractor_payable_id, status);

CREATE TABLE IF NOT EXISTS financial_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  project_id UUID,
  work_order_id UUID,
  partner_organization_id UUID,
  original_invoice_id UUID,
  original_invoice_item_id UUID,
  billable_item_id UUID,
  accepted_production_source_id UUID,
  contractor_payable_id UUID,
  customer_qc_decision_id UUID,
  original_quantity NUMERIC(14,4),
  corrected_quantity NUMERIC(14,4),
  unit_of_measure TEXT,
  original_rate NUMERIC(14,4),
  adjustment_amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  replacement_billable_item_id UUID,
  partner_recovery_exception_id UUID,
  idempotency_key TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT financial_adjustments_status_check CHECK (status IN ('created', 'review_required', 'applied', 'void')),
  CONSTRAINT financial_adjustments_type_check CHECK (adjustment_type IN ('customer_credit', 'rebill', 'invoice_reversal', 'partner_payable_adjustment', 'partner_recovery_exception')),
  CONSTRAINT financial_adjustments_invoice_fk FOREIGN KEY (tenant_id, original_invoice_id) REFERENCES invoices(tenant_id, id),
  CONSTRAINT financial_adjustments_invoice_item_fk FOREIGN KEY (tenant_id, original_invoice_item_id) REFERENCES invoice_items(tenant_id, id),
  CONSTRAINT financial_adjustments_billable_fk FOREIGN KEY (tenant_id, billable_item_id) REFERENCES billable_items(tenant_id, id),
  CONSTRAINT financial_adjustments_source_fk FOREIGN KEY (tenant_id, accepted_production_source_id) REFERENCES accepted_production_financial_sources(tenant_id, id),
  CONSTRAINT financial_adjustments_payable_fk FOREIGN KEY (tenant_id, contractor_payable_id) REFERENCES contractor_payables(tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_adjustments_idempotency_uidx
  ON financial_adjustments(tenant_id, idempotency_key)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS financial_adjustments_source_idx
  ON financial_adjustments(tenant_id, accepted_production_source_id, status);

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
    'post_billing_adjustment_required'
  )
);
