CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID REFERENCES organizations(id),
  opportunity_id UUID REFERENCES opportunities(id),
  name TEXT NOT NULL,
  contract_number TEXT,
  contract_type TEXT,
  payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  retainage_percent NUMERIC(5,2) CHECK (retainage_percent IS NULL OR (retainage_percent >= 0 AND retainage_percent <= 100)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE rate_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contract_id UUID REFERENCES contracts(id),
  organization_id UUID REFERENCES organizations(id),
  name TEXT NOT NULL,
  effective_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE rate_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rate_schedule_id UUID NOT NULL REFERENCES rate_schedules(id),
  code TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL,
  unit_type TEXT,
  amount NUMERIC(14,2) NOT NULL,
  customer_rate NUMERIC(14,2),
  contractor_rate NUMERIC(14,2),
  margin_amount NUMERIC(14,2),
  margin_percent NUMERIC(5,2),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contract_id UUID REFERENCES contracts(id),
  customer_organization_id UUID REFERENCES organizations(id),
  capacity_provider_id UUID REFERENCES capacity_providers(id),
  billing_period_start DATE,
  billing_period_end DATE,
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  retainage_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  chargeback_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'internal_review', 'ready_to_submit', 'submitted', 'customer_review', 'approved', 'disputed', 'archived')),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  dispute_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE settlement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  settlement_id UUID NOT NULL REFERENCES settlements(id),
  production_record_id UUID REFERENCES production_records(id),
  rate_code_id UUID REFERENCES rate_codes(id),
  quantity NUMERIC(14,2),
  unit_rate NUMERIC(14,2),
  gross_amount NUMERIC(14,2),
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID REFERENCES organizations(id),
  settlement_id UUID REFERENCES settlements(id),
  invoice_number TEXT,
  invoice_date DATE,
  due_date DATE,
  invoice_amount NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'overdue', 'archived')),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID REFERENCES invoices(id),
  settlement_id UUID REFERENCES settlements(id),
  amount NUMERIC(14,2) NOT NULL,
  payment_amount NUMERIC(14,2),
  payment_date DATE NOT NULL,
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'reconciled', 'short_paid', 'overpaid', 'archived')),
  overpay_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  short_pay_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE ar_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  customer_organization_id UUID REFERENCES organizations(id),
  amount_open NUMERIC(14,2) NOT NULL DEFAULT 0,
  age_days INTEGER NOT NULL DEFAULT 0,
  aging_bucket TEXT NOT NULL DEFAULT 'current' CHECK (aging_bucket IN ('current', '30', '60', '90', '120_plus')),
  balance NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciled', 'short_paid', 'overpaid', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE customer_payment_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_organization_id UUID NOT NULL REFERENCES organizations(id),
  average_days_to_pay NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_count INTEGER NOT NULL DEFAULT 0,
  short_pay_count INTEGER NOT NULL DEFAULT 0,
  last_payment_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_organization_id)
);
