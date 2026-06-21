ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_status_check;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS coverage_plan_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS coverage_requirement_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS coverage_source_id UUID;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS work_order_name TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS work_order_number TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_work_order_number TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS prime_work_order_number TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS internal_work_order_number TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS scope_summary TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS location_summary TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS route_name TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS node_id TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS segment_id TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS address_range TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS permit_reference TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS map_link TEXT;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS territory_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS readiness_status TEXT NOT NULL DEFAULT 'not_ready';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS readiness_score NUMERIC(8,4);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS readiness_band TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billable_status TEXT NOT NULL DEFAULT 'not_billable';

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS planned_quantity NUMERIC(14,2);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completed_quantity NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS approved_quantity NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billable_quantity NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS unit TEXT;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS planned_start_date DATE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS planned_end_date DATE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS scheduled_start_date TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS scheduled_end_date TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS actual_start_date TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS actual_end_date TIMESTAMPTZ;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assignment_type TEXT NOT NULL DEFAULT 'unassigned';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assigned_organization_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assigned_equipment_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assigned_by UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assignment_note TEXT;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS field_supervisor_user_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_owner_user_id UUID;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS documentation_requirements JSONB;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS production_requirements JSONB;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_validation_requirements JSONB;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billing_package_requirements JSONB;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS risk_notes TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS hold_reason TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS hold_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS hold_release_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS previous_status TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cancellation_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS correction_reason TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS approval_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billable_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS closeout_notes TEXT;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS archived_by UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS archive_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS updated_by UUID;

UPDATE work_orders
SET
  work_order_name = COALESCE(work_order_name, title),
  scope_summary = COALESCE(scope_summary, title),
  location_summary = COALESCE(location_summary, location_description),
  planned_quantity = COALESCE(planned_quantity, expected_units),
  unit = COALESCE(unit, unit_type),
  status = CASE WHEN status = 'created' THEN 'draft' ELSE status END,
  readiness_status = COALESCE(readiness_status, 'not_ready'),
  readiness_band = COALESCE(readiness_band, 'not_ready'),
  qc_status = COALESCE(qc_status, 'not_started'),
  billable_status = COALESCE(billable_status, 'not_billable'),
  assignment_type = COALESCE(
    assignment_type,
    CASE
      WHEN assigned_crew_id IS NOT NULL THEN 'internal_crew'
      WHEN assigned_capacity_provider_id IS NOT NULL THEN 'subcontractor'
      ELSE 'unassigned'
    END
  ),
  archived_at = COALESCE(archived_at, deleted_at)
WHERE true;

ALTER TABLE work_orders ADD CONSTRAINT work_orders_status_check CHECK (status IN (
  'draft',
  'ready_to_assign',
  'assigned',
  'scheduled',
  'in_progress',
  'submitted',
  'qc_review',
  'corrections_required',
  'approved',
  'billable',
  'closed',
  'on_hold',
  'cancelled',
  'archived'
));
ALTER TABLE work_orders ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_readiness_status_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_readiness_status_check CHECK (readiness_status IN ('not_ready', 'ready_to_assign', 'ready_to_start', 'blocked'));
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_readiness_band_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_readiness_band_check CHECK (readiness_band IS NULL OR readiness_band IN ('not_ready', 'needs_assignment', 'ready_with_risk', 'ready_to_start'));
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_qc_status_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_qc_status_check CHECK (qc_status IN ('not_started', 'pending_review', 'corrections_required', 'approved', 'rejected'));
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_billable_status_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_billable_status_check CHECK (billable_status IN ('not_billable', 'pending_approval', 'billable', 'billed_later', 'blocked'));
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_assignment_type_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_assignment_type_check CHECK (assignment_type IN ('unassigned', 'internal_crew', 'subcontractor', 'partner_contractor', 'vendor_equipment', 'staffing_source'));
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_unit_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_unit_check CHECK (unit IN (
  'feet',
  'miles',
  'drops',
  'addresses',
  'passings',
  'splice_cases',
  'nodes',
  'poles',
  'permits',
  'inspections',
  'restoration_items',
  'days',
  'crews',
  'workers',
  'equipment_units',
  'each'
));
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_quantities_non_negative_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_quantities_non_negative_check CHECK (
  planned_quantity >= 0
  AND completed_quantity >= 0
  AND approved_quantity >= 0
  AND billable_quantity >= 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_tenant_id_id ON work_orders (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_project ON work_orders (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_status ON work_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_readiness_status ON work_orders (tenant_id, readiness_status);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_capacity_provider ON work_orders (tenant_id, assigned_capacity_provider_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_crew ON work_orders (tenant_id, assigned_crew_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_coverage_source ON work_orders (tenant_id, coverage_source_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_archived ON work_orders (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_planned_start ON work_orders (tenant_id, planned_start_date);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_scheduled_start ON work_orders (tenant_id, scheduled_start_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_plans_tenant_id_id ON coverage_plans (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_requirements_tenant_id_id ON coverage_requirements (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_sources_tenant_id_id ON coverage_sources (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_tenant_id_id ON equipment (tenant_id, id);

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS fk_work_orders_tenant_coverage_plan;
ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_tenant_coverage_plan
  FOREIGN KEY (tenant_id, coverage_plan_id) REFERENCES coverage_plans (tenant_id, id) NOT VALID;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS fk_work_orders_tenant_coverage_requirement;
ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_tenant_coverage_requirement
  FOREIGN KEY (tenant_id, coverage_requirement_id) REFERENCES coverage_requirements (tenant_id, id) NOT VALID;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS fk_work_orders_tenant_coverage_source;
ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_tenant_coverage_source
  FOREIGN KEY (tenant_id, coverage_source_id) REFERENCES coverage_sources (tenant_id, id) NOT VALID;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS fk_work_orders_tenant_assigned_equipment;
ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_tenant_assigned_equipment
  FOREIGN KEY (tenant_id, assigned_equipment_id) REFERENCES equipment (tenant_id, id) NOT VALID;
