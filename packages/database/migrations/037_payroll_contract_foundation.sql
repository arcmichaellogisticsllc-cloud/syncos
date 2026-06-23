CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payroll_run_number TEXT NOT NULL,
  payroll_run_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approval_status TEXT NOT NULL DEFAULT 'not_submitted',
  payroll_readiness_status TEXT NOT NULL DEFAULT 'not_ready',
  payroll_cycle TEXT NOT NULL,
  payroll_period_start DATE NOT NULL,
  payroll_period_end DATE NOT NULL,
  pay_date DATE,
  territory_id UUID,
  project_id UUID,
  crew_id UUID,
  gross_pay_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  reimbursement_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  estimated_tax_amount NUMERIC(14,2),
  net_pay_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  worker_count INTEGER NOT NULL DEFAULT 0,
  compliance_status TEXT NOT NULL DEFAULT 'unknown',
  tax_document_status TEXT NOT NULL DEFAULT 'unknown',
  dispute_status TEXT NOT NULL DEFAULT 'none',
  hold_status TEXT NOT NULL DEFAULT 'none',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  rejection_note TEXT,
  hold_reason TEXT,
  hold_note TEXT,
  dispute_reason TEXT,
  dispute_note TEXT,
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
  CONSTRAINT payroll_runs_contract_check CHECK (
    payroll_run_type IN ('regular', 'off_cycle', 'correction', 'bonus', 'reimbursement', 'final_pay', 'manual_adjustment')
    AND status IN ('draft', 'assembling', 'ready_for_review', 'under_review', 'approved', 'rejected', 'held', 'disputed', 'payroll_ready', 'payroll_created_later', 'partially_paid_later', 'paid_later', 'voided', 'archived')
    AND approval_status IN ('not_submitted', 'pending', 'approved', 'rejected', 'withdrawn')
    AND payroll_readiness_status IN ('not_ready', 'ready_with_warning', 'ready_for_payroll', 'blocked')
    AND payroll_cycle IN ('weekly', 'biweekly', 'semimonthly', 'monthly', 'custom')
    AND compliance_status IN ('unknown', 'missing', 'incomplete', 'ready', 'expired', 'blocked')
    AND tax_document_status IN ('unknown', 'missing_w9', 'missing_w4_later', 'ready', 'expired', 'blocked')
    AND dispute_status IN ('none', 'open', 'under_review', 'resolved', 'rejected')
    AND hold_status IN ('none', 'hold', 'released')
    AND payroll_period_start <= payroll_period_end
    AND gross_pay_amount >= 0
    AND reimbursement_amount >= 0
    AND deduction_amount >= 0
    AND (estimated_tax_amount IS NULL OR estimated_tax_amount >= 0)
    AND item_count >= 0
    AND worker_count >= 0
  )
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payroll_run_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  crew_id UUID,
  project_id UUID,
  work_order_id UUID,
  production_record_id UUID,
  source_type TEXT NOT NULL,
  earning_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  worker_classification TEXT NOT NULL,
  work_date DATE,
  hours_regular NUMERIC(12,4),
  hours_overtime NUMERIC(12,4),
  hours_doubletime NUMERIC(12,4),
  quantity NUMERIC(14,4),
  unit TEXT,
  rate_regular NUMERIC(14,2),
  rate_overtime NUMERIC(14,2),
  rate_doubletime NUMERIC(14,2),
  piece_rate NUMERIC(14,2),
  gross_pay_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  reimbursement_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  estimated_tax_amount NUMERIC(14,2),
  net_pay_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  compliance_status TEXT NOT NULL DEFAULT 'unknown',
  tax_document_status TEXT NOT NULL DEFAULT 'unknown',
  dispute_status TEXT NOT NULL DEFAULT 'none',
  hold_status TEXT NOT NULL DEFAULT 'none',
  description TEXT,
  manual_reason TEXT,
  evidence_reference TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_item_id UUID,
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
  CONSTRAINT payroll_items_contract_check CHECK (
    source_type IN ('approved_time', 'production_based', 'per_diem', 'reimbursement', 'bonus', 'adjustment', 'correction', 'manual', 'imported_later')
    AND earning_type IN ('regular', 'overtime', 'doubletime', 'piece_rate', 'per_diem', 'reimbursement', 'bonus', 'incentive', 'adjustment', 'correction', 'deduction', 'penalty')
    AND status IN ('draft', 'ready', 'approved', 'held', 'disputed', 'payroll_ready', 'payroll_created_later', 'voided', 'archived')
    AND worker_classification IN ('w2_employee', 'contractor_1099', 'temp_worker', 'seasonal_worker', 'internal_self_perform', 'union_later', 'unknown')
    AND compliance_status IN ('unknown', 'missing', 'incomplete', 'ready', 'expired', 'blocked')
    AND tax_document_status IN ('unknown', 'missing_w9', 'missing_w4_later', 'ready', 'expired', 'blocked')
    AND dispute_status IN ('none', 'open', 'under_review', 'resolved', 'rejected')
    AND hold_status IN ('none', 'hold', 'released')
    AND (hours_regular IS NULL OR hours_regular >= 0)
    AND (hours_overtime IS NULL OR hours_overtime >= 0)
    AND (hours_doubletime IS NULL OR hours_doubletime >= 0)
    AND (quantity IS NULL OR quantity >= 0)
    AND (rate_regular IS NULL OR rate_regular >= 0)
    AND (rate_overtime IS NULL OR rate_overtime >= 0)
    AND (rate_doubletime IS NULL OR rate_doubletime >= 0)
    AND (piece_rate IS NULL OR piece_rate >= 0)
    AND gross_pay_amount >= 0
    AND reimbursement_amount >= 0
    AND deduction_amount >= 0
    AND (estimated_tax_amount IS NULL OR estimated_tax_amount >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_tenant_id ON payroll_runs (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_tenant_number ON payroll_runs (tenant_id, payroll_run_number);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_type ON payroll_runs (tenant_id, payroll_run_type);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_status ON payroll_runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_approval ON payroll_runs (tenant_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_readiness ON payroll_runs (tenant_id, payroll_readiness_status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_cycle ON payroll_runs (tenant_id, payroll_cycle);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_period_start ON payroll_runs (tenant_id, payroll_period_start);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_period_end ON payroll_runs (tenant_id, payroll_period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_pay_date ON payroll_runs (tenant_id, pay_date);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_territory ON payroll_runs (tenant_id, territory_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_project ON payroll_runs (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_crew ON payroll_runs (tenant_id, crew_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_compliance ON payroll_runs (tenant_id, compliance_status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_tax ON payroll_runs (tenant_id, tax_document_status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_dispute ON payroll_runs (tenant_id, dispute_status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_hold ON payroll_runs (tenant_id, hold_status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_archived ON payroll_runs (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_created ON payroll_runs (tenant_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_items_tenant_id ON payroll_items (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_run ON payroll_items (tenant_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_worker ON payroll_items (tenant_id, worker_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_crew ON payroll_items (tenant_id, crew_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_project ON payroll_items (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_work_order ON payroll_items (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_production ON payroll_items (tenant_id, production_record_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_source ON payroll_items (tenant_id, source_type);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_earning ON payroll_items (tenant_id, earning_type);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_classification ON payroll_items (tenant_id, worker_classification);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_status ON payroll_items (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_archived ON payroll_items (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_payroll_items_tenant_created ON payroll_items (tenant_id, created_at);

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS fk_payroll_runs_tenant_territory;
ALTER TABLE payroll_runs ADD CONSTRAINT fk_payroll_runs_tenant_territory
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories (tenant_id, id) NOT VALID;

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS fk_payroll_runs_tenant_project;
ALTER TABLE payroll_runs ADD CONSTRAINT fk_payroll_runs_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS fk_payroll_runs_tenant_crew;
ALTER TABLE payroll_runs ADD CONSTRAINT fk_payroll_runs_tenant_crew
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews (tenant_id, id) NOT VALID;

ALTER TABLE payroll_items DROP CONSTRAINT IF EXISTS fk_payroll_items_tenant_run;
ALTER TABLE payroll_items ADD CONSTRAINT fk_payroll_items_tenant_run
  FOREIGN KEY (tenant_id, payroll_run_id) REFERENCES payroll_runs (tenant_id, id) NOT VALID;

ALTER TABLE payroll_items DROP CONSTRAINT IF EXISTS fk_payroll_items_tenant_worker;
ALTER TABLE payroll_items ADD CONSTRAINT fk_payroll_items_tenant_worker
  FOREIGN KEY (tenant_id, worker_id) REFERENCES workers (tenant_id, id) NOT VALID;

ALTER TABLE payroll_items DROP CONSTRAINT IF EXISTS fk_payroll_items_tenant_crew;
ALTER TABLE payroll_items ADD CONSTRAINT fk_payroll_items_tenant_crew
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews (tenant_id, id) NOT VALID;

ALTER TABLE payroll_items DROP CONSTRAINT IF EXISTS fk_payroll_items_tenant_project;
ALTER TABLE payroll_items ADD CONSTRAINT fk_payroll_items_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE payroll_items DROP CONSTRAINT IF EXISTS fk_payroll_items_tenant_work_order;
ALTER TABLE payroll_items ADD CONSTRAINT fk_payroll_items_tenant_work_order
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id) NOT VALID;

ALTER TABLE payroll_items DROP CONSTRAINT IF EXISTS fk_payroll_items_tenant_production;
ALTER TABLE payroll_items ADD CONSTRAINT fk_payroll_items_tenant_production
  FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records (tenant_id, id) NOT VALID;
