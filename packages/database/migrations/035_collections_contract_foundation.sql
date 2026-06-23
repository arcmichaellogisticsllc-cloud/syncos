CREATE TABLE IF NOT EXISTS collection_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL,
  customer_organization_id UUID NOT NULL,
  case_number TEXT NOT NULL,
  case_status TEXT NOT NULL DEFAULT 'open',
  collection_priority TEXT NOT NULL DEFAULT 'low',
  risk_level TEXT NOT NULL DEFAULT 'low',
  aging_bucket TEXT NOT NULL DEFAULT 'current',
  dispute_status TEXT NOT NULL DEFAULT 'none',
  escalation_status TEXT NOT NULL DEFAULT 'none',
  writeoff_review_status TEXT NOT NULL DEFAULT 'not_ready',
  assigned_owner_user_id UUID,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  next_action_due_at TIMESTAMPTZ,
  promise_to_pay_date DATE,
  balance_at_open NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  original_invoice_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  last_payment_amount NUMERIC(14,2),
  promise_to_pay_amount NUMERIC(14,2),
  last_payment_at TIMESTAMPTZ,
  next_action_type TEXT,
  close_reason TEXT,
  close_note TEXT,
  notes TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT collection_cases_contract_check CHECK (
    case_status IN ('open', 'in_progress', 'promise_to_pay', 'disputed', 'escalated', 'awaiting_payment', 'resolved', 'closed', 'archived')
    AND collection_priority IN ('low', 'medium', 'high', 'urgent')
    AND risk_level IN ('low', 'medium', 'high', 'critical')
    AND aging_bucket IN ('current', '1_30', '31_60', '61_90', '90_plus')
    AND dispute_status IN ('none', 'open', 'under_review', 'resolved', 'rejected')
    AND escalation_status IN ('none', 'internal_escalation', 'executive_escalation', 'legal_review_later', 'collections_agency_later')
    AND writeoff_review_status IN ('not_applicable', 'not_ready', 'candidate', 'under_review_later', 'approved_later', 'rejected_later')
    AND balance_at_open >= 0
    AND current_balance >= 0
    AND original_invoice_amount >= 0
    AND COALESCE(last_payment_amount, 0) >= 0
    AND COALESCE(promise_to_pay_amount, 0) >= 0
  )
);

CREATE TABLE IF NOT EXISTS collection_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  collection_case_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  customer_organization_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  action_status TEXT NOT NULL DEFAULT 'planned',
  action_date DATE NOT NULL DEFAULT current_date,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  actor_user_id UUID NOT NULL,
  contact_id UUID,
  contact_method TEXT,
  outcome TEXT,
  note TEXT,
  promise_to_pay_date DATE,
  promise_to_pay_amount NUMERIC(14,2),
  dispute_reason TEXT,
  escalation_reason TEXT,
  follow_up_required BOOLEAN NOT NULL DEFAULT false,
  follow_up_due_at TIMESTAMPTZ,
  evidence_reference TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT collection_actions_contract_check CHECK (
    action_type IN ('call', 'email', 'text', 'portal_message', 'internal_note', 'promise_to_pay', 'dispute_opened', 'dispute_updated', 'dispute_resolved', 'payment_reminder', 'follow_up_scheduled', 'escalation_requested', 'escalation_approved', 'writeoff_review_requested', 'case_closed')
    AND action_status IN ('planned', 'completed', 'failed', 'cancelled', 'archived')
    AND (contact_method IS NULL OR contact_method IN ('phone', 'email', 'sms', 'portal', 'in_person', 'internal'))
    AND (outcome IS NULL OR outcome IN ('no_response', 'left_message', 'contacted', 'promise_received', 'payment_received_later', 'dispute_reported', 'wrong_contact', 'follow_up_needed', 'escalated', 'resolved'))
    AND COALESCE(promise_to_pay_amount, 0) >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_cases_tenant_id ON collection_cases (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_cases_tenant_number ON collection_cases (tenant_id, case_number);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_invoice ON collection_cases (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_customer ON collection_cases (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_status ON collection_cases (tenant_id, case_status);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_priority ON collection_cases (tenant_id, collection_priority);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_risk ON collection_cases (tenant_id, risk_level);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_aging ON collection_cases (tenant_id, aging_bucket);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_owner ON collection_cases (tenant_id, assigned_owner_user_id);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_dispute ON collection_cases (tenant_id, dispute_status);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_escalation ON collection_cases (tenant_id, escalation_status);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_writeoff ON collection_cases (tenant_id, writeoff_review_status);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_next_action ON collection_cases (tenant_id, next_action_due_at);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_archived ON collection_cases (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_collection_cases_tenant_created ON collection_cases (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_collection_cases_active_invoice
  ON collection_cases (tenant_id, invoice_id)
  WHERE case_status NOT IN ('closed', 'resolved', 'archived') AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_actions_tenant_id ON collection_actions (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_case ON collection_actions (tenant_id, collection_case_id);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_invoice ON collection_actions (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_customer ON collection_actions (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_type ON collection_actions (tenant_id, action_type);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_status ON collection_actions (tenant_id, action_status);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_action_date ON collection_actions (tenant_id, action_date);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_due ON collection_actions (tenant_id, due_at);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_follow_up ON collection_actions (tenant_id, follow_up_due_at);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_actor ON collection_actions (tenant_id, actor_user_id);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_archived ON collection_actions (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_collection_actions_tenant_created ON collection_actions (tenant_id, created_at);

ALTER TABLE collection_cases DROP CONSTRAINT IF EXISTS fk_collection_cases_tenant_invoice;
ALTER TABLE collection_cases ADD CONSTRAINT fk_collection_cases_tenant_invoice
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) NOT VALID;

ALTER TABLE collection_cases DROP CONSTRAINT IF EXISTS fk_collection_cases_tenant_customer;
ALTER TABLE collection_cases ADD CONSTRAINT fk_collection_cases_tenant_customer
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;

ALTER TABLE collection_cases DROP CONSTRAINT IF EXISTS fk_collection_cases_tenant_owner;
ALTER TABLE collection_cases ADD CONSTRAINT fk_collection_cases_tenant_owner
  FOREIGN KEY (tenant_id, assigned_owner_user_id) REFERENCES tenant_users (tenant_id, user_id) NOT VALID;

ALTER TABLE collection_actions DROP CONSTRAINT IF EXISTS fk_collection_actions_tenant_case;
ALTER TABLE collection_actions ADD CONSTRAINT fk_collection_actions_tenant_case
  FOREIGN KEY (tenant_id, collection_case_id) REFERENCES collection_cases (tenant_id, id) NOT VALID;

ALTER TABLE collection_actions DROP CONSTRAINT IF EXISTS fk_collection_actions_tenant_invoice;
ALTER TABLE collection_actions ADD CONSTRAINT fk_collection_actions_tenant_invoice
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) NOT VALID;

ALTER TABLE collection_actions DROP CONSTRAINT IF EXISTS fk_collection_actions_tenant_customer;
ALTER TABLE collection_actions ADD CONSTRAINT fk_collection_actions_tenant_customer
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;

ALTER TABLE collection_actions DROP CONSTRAINT IF EXISTS fk_collection_actions_tenant_actor;
ALTER TABLE collection_actions ADD CONSTRAINT fk_collection_actions_tenant_actor
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES tenant_users (tenant_id, user_id) NOT VALID;
