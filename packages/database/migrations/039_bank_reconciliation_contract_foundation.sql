CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  institution_name TEXT,
  masked_account_number TEXT,
  routing_last4 TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active',
  opening_balance NUMERIC(14,2),
  current_balance_snapshot NUMERIC(14,2),
  last_statement_date DATE,
  last_reconciled_at TIMESTAMPTZ,
  notes TEXT,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT bank_accounts_contract_check CHECK (
    account_type IN ('operating', 'payroll', 'tax', 'savings', 'escrow', 'credit_card', 'other')
    AND status IN ('active', 'inactive', 'closed', 'archived')
    AND (routing_last4 IS NULL OR length(routing_last4) <= 4)
  )
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  bank_account_id UUID NOT NULL,
  transaction_date DATE NOT NULL,
  posted_date DATE,
  direction TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  bank_reference TEXT,
  external_transaction_id TEXT,
  payment_method TEXT,
  transaction_type TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'unreconciled',
  cleared_status TEXT NOT NULL DEFAULT 'unknown',
  exception_status TEXT NOT NULL DEFAULT 'none',
  exception_reason TEXT,
  ignored_by UUID,
  ignored_at TIMESTAMPTZ,
  ignore_reason TEXT,
  ignore_note TEXT,
  import_batch_id UUID,
  source_type TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT bank_transactions_contract_check CHECK (
    direction IN ('debit', 'credit')
    AND amount > 0
    AND transaction_type IN ('payment_out', 'deposit_in', 'fee', 'transfer', 'reversal', 'chargeback', 'adjustment', 'interest', 'unknown')
    AND reconciliation_status IN ('unreconciled', 'matched', 'partially_matched', 'exception', 'ignored', 'archived')
    AND cleared_status IN ('pending', 'posted', 'cleared', 'returned', 'reversed', 'unknown')
    AND exception_status IN ('none', 'open', 'under_review', 'resolved', 'ignored')
    AND source_type IN ('manual', 'statement_import_later', 'bank_feed_later', 'processor_import_later')
  )
);

CREATE TABLE IF NOT EXISTS reconciliation_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  bank_transaction_id UUID NOT NULL,
  match_type TEXT NOT NULL,
  matched_object_type TEXT NOT NULL,
  matched_object_id UUID,
  payment_batch_id UUID,
  payment_item_id UUID,
  cash_receipt_id UUID,
  payment_application_id UUID,
  invoice_id UUID,
  matched_amount NUMERIC(14,2) NOT NULL,
  match_confidence TEXT NOT NULL DEFAULT 'manual',
  match_status TEXT NOT NULL DEFAULT 'proposed',
  match_reason TEXT,
  variance_amount NUMERIC(14,2),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  rejection_note TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
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
  CONSTRAINT reconciliation_matches_contract_check CHECK (
    match_type IN ('payment_batch', 'payment_item', 'cash_receipt', 'payment_application_context', 'manual_adjustment', 'unknown')
    AND matched_object_type IN ('payment_batch', 'payment_item', 'cash_receipt', 'payment_application', 'invoice', 'manual')
    AND matched_amount > 0
    AND match_confidence IN ('exact', 'high', 'medium', 'low', 'manual')
    AND match_status IN ('proposed', 'reviewed', 'approved', 'rejected', 'voided', 'archived')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_tenant_id ON bank_accounts (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant_name ON bank_accounts (tenant_id, account_name);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant_type ON bank_accounts (tenant_id, account_type);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant_status ON bank_accounts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant_institution ON bank_accounts (tenant_id, institution_name);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant_archived ON bank_accounts (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant_created ON bank_accounts (tenant_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transactions_tenant_id ON bank_transactions (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_account ON bank_transactions (tenant_id, bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_transaction_date ON bank_transactions (tenant_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_posted_date ON bank_transactions (tenant_id, posted_date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_direction ON bank_transactions (tenant_id, direction);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_amount ON bank_transactions (tenant_id, amount);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_reconciliation ON bank_transactions (tenant_id, reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_cleared ON bank_transactions (tenant_id, cleared_status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_exception ON bank_transactions (tenant_id, exception_status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_bank_reference ON bank_transactions (tenant_id, bank_reference);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_external ON bank_transactions (tenant_id, external_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_source ON bank_transactions (tenant_id, source_type);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_archived ON bank_transactions (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_created ON bank_transactions (tenant_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_id ON reconciliation_matches (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_transaction ON reconciliation_matches (tenant_id, bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_type ON reconciliation_matches (tenant_id, match_type);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_object_type ON reconciliation_matches (tenant_id, matched_object_type);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_object_id ON reconciliation_matches (tenant_id, matched_object_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_payment_batch ON reconciliation_matches (tenant_id, payment_batch_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_payment_item ON reconciliation_matches (tenant_id, payment_item_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_cash_receipt ON reconciliation_matches (tenant_id, cash_receipt_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_payment_application ON reconciliation_matches (tenant_id, payment_application_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_invoice ON reconciliation_matches (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_status ON reconciliation_matches (tenant_id, match_status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_confidence ON reconciliation_matches (tenant_id, match_confidence);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_archived ON reconciliation_matches (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant_created ON reconciliation_matches (tenant_id, created_at);

ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS fk_bank_transactions_tenant_account;
ALTER TABLE bank_transactions ADD CONSTRAINT fk_bank_transactions_tenant_account
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES bank_accounts (tenant_id, id) NOT VALID;

ALTER TABLE reconciliation_matches DROP CONSTRAINT IF EXISTS fk_reconciliation_matches_tenant_transaction;
ALTER TABLE reconciliation_matches ADD CONSTRAINT fk_reconciliation_matches_tenant_transaction
  FOREIGN KEY (tenant_id, bank_transaction_id) REFERENCES bank_transactions (tenant_id, id) NOT VALID;

ALTER TABLE reconciliation_matches DROP CONSTRAINT IF EXISTS fk_reconciliation_matches_tenant_payment_batch;
ALTER TABLE reconciliation_matches ADD CONSTRAINT fk_reconciliation_matches_tenant_payment_batch
  FOREIGN KEY (tenant_id, payment_batch_id) REFERENCES payment_batches (tenant_id, id) NOT VALID;

ALTER TABLE reconciliation_matches DROP CONSTRAINT IF EXISTS fk_reconciliation_matches_tenant_payment_item;
ALTER TABLE reconciliation_matches ADD CONSTRAINT fk_reconciliation_matches_tenant_payment_item
  FOREIGN KEY (tenant_id, payment_item_id) REFERENCES payment_items (tenant_id, id) NOT VALID;

ALTER TABLE reconciliation_matches DROP CONSTRAINT IF EXISTS fk_reconciliation_matches_tenant_cash_receipt;
ALTER TABLE reconciliation_matches ADD CONSTRAINT fk_reconciliation_matches_tenant_cash_receipt
  FOREIGN KEY (tenant_id, cash_receipt_id) REFERENCES cash_receipts (tenant_id, id) NOT VALID;

ALTER TABLE reconciliation_matches DROP CONSTRAINT IF EXISTS fk_reconciliation_matches_tenant_payment_application;
ALTER TABLE reconciliation_matches ADD CONSTRAINT fk_reconciliation_matches_tenant_payment_application
  FOREIGN KEY (tenant_id, payment_application_id) REFERENCES payment_applications (tenant_id, id) NOT VALID;

ALTER TABLE reconciliation_matches DROP CONSTRAINT IF EXISTS fk_reconciliation_matches_tenant_invoice;
ALTER TABLE reconciliation_matches ADD CONSTRAINT fk_reconciliation_matches_tenant_invoice
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) NOT VALID;
