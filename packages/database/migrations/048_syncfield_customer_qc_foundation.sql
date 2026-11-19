ALTER TABLE projects ADD COLUMN IF NOT EXISTS qc_authority_organization_id UUID;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_qc_authority_tenant_fk;
ALTER TABLE projects ADD CONSTRAINT projects_qc_authority_tenant_fk
  FOREIGN KEY (tenant_id, qc_authority_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_authority_organization_id UUID;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_qc_authority_tenant_fk;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_qc_authority_tenant_fk
  FOREIGN KEY (tenant_id, qc_authority_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;

ALTER TABLE daily_production_reports ADD COLUMN IF NOT EXISTS completeness_status TEXT NOT NULL DEFAULT 'not_reviewed';
ALTER TABLE daily_production_reports ADD COLUMN IF NOT EXISTS completeness_reviewed_by_user_id UUID REFERENCES users(id);
ALTER TABLE daily_production_reports ADD COLUMN IF NOT EXISTS completeness_reviewed_at TIMESTAMPTZ;
ALTER TABLE daily_production_reports ADD COLUMN IF NOT EXISTS completeness_return_reason TEXT;
ALTER TABLE daily_production_reports ADD COLUMN IF NOT EXISTS customer_qc_outcome TEXT NOT NULL DEFAULT 'pending_customer_qc';
ALTER TABLE daily_production_reports DROP CONSTRAINT IF EXISTS daily_production_reports_completeness_status_check;
ALTER TABLE daily_production_reports ADD CONSTRAINT daily_production_reports_completeness_status_check
  CHECK (completeness_status IN ('not_reviewed', 'complete', 'incomplete', 'returned'));
ALTER TABLE daily_production_reports DROP CONSTRAINT IF EXISTS daily_production_reports_customer_qc_outcome_check;
ALTER TABLE daily_production_reports ADD CONSTRAINT daily_production_reports_customer_qc_outcome_check
  CHECK (customer_qc_outcome IN ('pending_customer_qc', 'customer_accepted', 'customer_partially_accepted', 'customer_correction_required', 'customer_rejected'));

CREATE TABLE IF NOT EXISTS customer_qc_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  daily_report_id UUID NOT NULL,
  daily_report_revision_id UUID NOT NULL,
  partner_organization_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  qc_authority_organization_id UUID NOT NULL,
  cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
  status TEXT NOT NULL DEFAULT 'awaiting_customer',
  submitted_to_customer_at TIMESTAMPTZ,
  decision_received_at TIMESTAMPTZ,
  decision_recorded_at TIMESTAMPTZ,
  decision_recorded_by_user_id UUID REFERENCES users(id),
  source_type TEXT NOT NULL DEFAULT 'manual_recorded_from_customer',
  source_reference TEXT NOT NULL,
  source_evidence_file_id UUID,
  customer_reference_number TEXT,
  general_customer_notes TEXT,
  client_mutation_id TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT customer_qc_cycles_status_check CHECK (status IN ('awaiting_customer', 'customer_response_received', 'correction_required', 'partially_accepted', 'accepted', 'rejected', 'awaiting_partner_correction', 'awaiting_reinspection', 'closed')),
  CONSTRAINT customer_qc_cycles_source_type_check CHECK (source_type IN ('email', 'customer_portal', 'customer_report', 'customer_spreadsheet', 'field_qc_report', 'api', 'manual_recorded_from_customer')),
  CONSTRAINT customer_qc_cycles_report_fk FOREIGN KEY (tenant_id, daily_report_id) REFERENCES daily_production_reports(tenant_id, id),
  CONSTRAINT customer_qc_cycles_revision_fk FOREIGN KEY (tenant_id, daily_report_revision_id) REFERENCES daily_production_report_revisions(tenant_id, id),
  CONSTRAINT customer_qc_cycles_project_fk FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT customer_qc_cycles_work_order_fk FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT customer_qc_cycles_wov_fk FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT customer_qc_cycles_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT customer_qc_cycles_crew_fk FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT customer_qc_cycles_authority_fk FOREIGN KEY (tenant_id, qc_authority_organization_id) REFERENCES organizations(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_qc_cycles_tenant_id_uidx ON customer_qc_cycles(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_qc_cycles_number_uidx
  ON customer_qc_cycles(tenant_id, daily_report_id, cycle_number)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_qc_cycles_mutation_uidx
  ON customer_qc_cycles(tenant_id, created_by_user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_qc_cycles_report_idx ON customer_qc_cycles(tenant_id, daily_report_id, status);
CREATE INDEX IF NOT EXISTS customer_qc_cycles_partner_idx ON customer_qc_cycles(tenant_id, partner_organization_id, status);

CREATE TABLE IF NOT EXISTS customer_qc_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  qc_cycle_id UUID NOT NULL,
  production_record_id UUID NOT NULL,
  decision TEXT NOT NULL,
  reported_quantity NUMERIC(14,2) NOT NULL CHECK (reported_quantity >= 0),
  customer_accepted_quantity NUMERIC(14,2) CHECK (customer_accepted_quantity IS NULL OR customer_accepted_quantity >= 0),
  unit_of_measure TEXT NOT NULL,
  customer_reason_code TEXT,
  customer_comments TEXT,
  correction_required BOOLEAN NOT NULL DEFAULT false,
  current BOOLEAN NOT NULL DEFAULT true,
  superseded_by_decision_id UUID,
  recorded_by_user_id UUID NOT NULL REFERENCES users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_reference TEXT,
  client_mutation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT customer_qc_decisions_decision_check CHECK (decision IN ('accepted', 'partially_accepted', 'correction_required', 'rejected')),
  CONSTRAINT customer_qc_decisions_quantity_required_check CHECK (
    (decision IN ('accepted', 'partially_accepted') AND customer_accepted_quantity IS NOT NULL)
    OR (decision IN ('correction_required', 'rejected'))
  ),
  CONSTRAINT customer_qc_decisions_adjustment_reason_check CHECK (
    customer_accepted_quantity IS NULL
    OR customer_accepted_quantity <= reported_quantity
    OR customer_reason_code IS NOT NULL
  ),
  CONSTRAINT customer_qc_decisions_cycle_fk FOREIGN KEY (tenant_id, qc_cycle_id) REFERENCES customer_qc_cycles(tenant_id, id),
  CONSTRAINT customer_qc_decisions_record_fk FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records(tenant_id, id),
  CONSTRAINT customer_qc_decisions_superseded_fk FOREIGN KEY (tenant_id, superseded_by_decision_id) REFERENCES customer_qc_decisions(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_qc_decisions_tenant_id_uidx ON customer_qc_decisions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_qc_decisions_current_uidx
  ON customer_qc_decisions(tenant_id, qc_cycle_id, production_record_id)
  WHERE current = true AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_qc_decisions_mutation_uidx
  ON customer_qc_decisions(tenant_id, recorded_by_user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_qc_decisions_record_idx ON customer_qc_decisions(tenant_id, production_record_id, decision);

CREATE TABLE IF NOT EXISTS production_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  qc_cycle_id UUID NOT NULL,
  customer_qc_decision_id UUID NOT NULL,
  daily_report_id UUID NOT NULL,
  production_record_id UUID NOT NULL,
  partner_organization_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  correction_type TEXT NOT NULL,
  allowed_fields TEXT[] NOT NULL DEFAULT '{}'::text[],
  customer_reason TEXT NOT NULL,
  partner_safe_instructions TEXT NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  acknowledged_by_user_id UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  resubmitted_by_user_id UUID REFERENCES users(id),
  resubmitted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  superseded_by_correction_id UUID,
  client_mutation_id TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT production_corrections_type_check CHECK (correction_type IN ('quantity', 'production_code', 'location', 'asset_identifier', 'route_endpoint', 'missing_note', 'missing_photo', 'workmanship', 'rework', 'other')),
  CONSTRAINT production_corrections_status_check CHECK (status IN ('open', 'acknowledged', 'in_progress', 'resubmitted', 'awaiting_customer_reinspection', 'resolved', 'cancelled')),
  CONSTRAINT production_corrections_cycle_fk FOREIGN KEY (tenant_id, qc_cycle_id) REFERENCES customer_qc_cycles(tenant_id, id),
  CONSTRAINT production_corrections_decision_fk FOREIGN KEY (tenant_id, customer_qc_decision_id) REFERENCES customer_qc_decisions(tenant_id, id),
  CONSTRAINT production_corrections_report_fk FOREIGN KEY (tenant_id, daily_report_id) REFERENCES daily_production_reports(tenant_id, id),
  CONSTRAINT production_corrections_record_fk FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records(tenant_id, id),
  CONSTRAINT production_corrections_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT production_corrections_crew_fk FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT production_corrections_superseded_fk FOREIGN KEY (tenant_id, superseded_by_correction_id) REFERENCES production_corrections(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS production_corrections_tenant_id_uidx ON production_corrections(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS production_corrections_active_decision_uidx
  ON production_corrections(tenant_id, customer_qc_decision_id)
  WHERE deleted_at IS NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS production_corrections_mutation_uidx
  ON production_corrections(tenant_id, resubmitted_by_user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_corrections_partner_idx ON production_corrections(tenant_id, partner_organization_id, status);
CREATE INDEX IF NOT EXISTS production_corrections_crew_idx ON production_corrections(tenant_id, crew_id, status);

CREATE TABLE IF NOT EXISTS customer_qc_evidence_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  qc_cycle_id UUID NOT NULL,
  customer_qc_decision_id UUID,
  restricted_file_object_id UUID NOT NULL,
  partner_visible BOOLEAN NOT NULL DEFAULT false,
  safe_label TEXT NOT NULL,
  uploaded_by_user_id UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT customer_qc_evidence_cycle_fk FOREIGN KEY (tenant_id, qc_cycle_id) REFERENCES customer_qc_cycles(tenant_id, id),
  CONSTRAINT customer_qc_evidence_decision_fk FOREIGN KEY (tenant_id, customer_qc_decision_id) REFERENCES customer_qc_decisions(tenant_id, id),
  CONSTRAINT customer_qc_evidence_file_fk FOREIGN KEY (tenant_id, restricted_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_qc_evidence_tenant_id_uidx ON customer_qc_evidence_links(tenant_id, id);
CREATE INDEX IF NOT EXISTS customer_qc_evidence_cycle_idx ON customer_qc_evidence_links(tenant_id, qc_cycle_id);
