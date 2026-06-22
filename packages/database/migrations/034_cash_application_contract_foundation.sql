CREATE TABLE IF NOT EXISTS cash_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  receipt_number TEXT NOT NULL,
  customer_organization_id UUID,
  payer_name TEXT,
  payment_date DATE NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_method TEXT NOT NULL,
  payment_reference TEXT,
  external_transaction_id TEXT,
  gross_received_amount NUMERIC(14,2) NOT NULL,
  applied_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  unapplied_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  receipt_status TEXT NOT NULL DEFAULT 'unapplied',
  deposit_status TEXT NOT NULL DEFAULT 'not_deposited',
  reconciliation_status TEXT NOT NULL DEFAULT 'not_reconciled',
  source_type TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  evidence_reference TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  voided_by UUID,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  void_note TEXT,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT cash_receipts_contract_check CHECK (
    payment_method IN ('ach', 'wire', 'check', 'card', 'cash', 'lockbox', 'portal', 'zelle', 'other')
    AND receipt_status IN ('received', 'partially_applied', 'fully_applied', 'unapplied', 'overapplied', 'voided', 'archived')
    AND deposit_status IN ('not_deposited', 'deposited_later', 'pending_later', 'reconciled_later')
    AND reconciliation_status IN ('not_reconciled', 'pending_later', 'reconciled_later', 'exception_later')
    AND source_type IN ('manual', 'bank_import_later', 'processor_import_later', 'customer_portal_later', 'accounting_import_later')
    AND gross_received_amount > 0
    AND applied_amount >= 0
    AND unapplied_amount >= 0
  )
);

CREATE TABLE IF NOT EXISTS payment_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  cash_receipt_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  customer_organization_id UUID NOT NULL,
  applied_amount NUMERIC(14,2) NOT NULL,
  application_date DATE NOT NULL,
  application_status TEXT NOT NULL DEFAULT 'applied',
  application_type TEXT NOT NULL DEFAULT 'standard_payment',
  note TEXT,
  writeoff_amount NUMERIC(14,2),
  discount_amount NUMERIC(14,2),
  adjustment_amount NUMERIC(14,2),
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  voided_by UUID,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  void_note TEXT,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT payment_applications_contract_check CHECK (
    application_status IN ('applied', 'partially_applied', 'reversed_later', 'voided', 'archived')
    AND application_type IN ('standard_payment', 'partial_payment', 'overpayment_application', 'retainage_payment', 'discount', 'writeoff_later', 'adjustment', 'correction')
    AND applied_amount > 0
    AND COALESCE(writeoff_amount, 0) >= 0
    AND COALESCE(discount_amount, 0) >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_receipts_tenant_id ON cash_receipts (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_receipts_tenant_number ON cash_receipts (tenant_id, receipt_number);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_customer ON cash_receipts (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_status ON cash_receipts (tenant_id, receipt_status);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_deposit ON cash_receipts (tenant_id, deposit_status);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_reconciliation ON cash_receipts (tenant_id, reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_payment_date ON cash_receipts (tenant_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_method ON cash_receipts (tenant_id, payment_method);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_external ON cash_receipts (tenant_id, external_transaction_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_archived ON cash_receipts (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_tenant_created ON cash_receipts (tenant_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_applications_tenant_id ON payment_applications (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant_receipt ON payment_applications (tenant_id, cash_receipt_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant_invoice ON payment_applications (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant_customer ON payment_applications (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant_status ON payment_applications (tenant_id, application_status);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant_type ON payment_applications (tenant_id, application_type);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant_date ON payment_applications (tenant_id, application_date);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant_archived ON payment_applications (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant_created ON payment_applications (tenant_id, created_at);

ALTER TABLE cash_receipts DROP CONSTRAINT IF EXISTS fk_cash_receipts_tenant_customer;
ALTER TABLE cash_receipts ADD CONSTRAINT fk_cash_receipts_tenant_customer
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;

ALTER TABLE payment_applications DROP CONSTRAINT IF EXISTS fk_payment_applications_tenant_receipt;
ALTER TABLE payment_applications ADD CONSTRAINT fk_payment_applications_tenant_receipt
  FOREIGN KEY (tenant_id, cash_receipt_id) REFERENCES cash_receipts (tenant_id, id) NOT VALID;

ALTER TABLE payment_applications DROP CONSTRAINT IF EXISTS fk_payment_applications_tenant_invoice;
ALTER TABLE payment_applications ADD CONSTRAINT fk_payment_applications_tenant_invoice
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) NOT VALID;

ALTER TABLE payment_applications DROP CONSTRAINT IF EXISTS fk_payment_applications_tenant_customer;
ALTER TABLE payment_applications ADD CONSTRAINT fk_payment_applications_tenant_customer
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;
