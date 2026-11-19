CREATE TABLE prime_correction_policies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 work_order_version_id UUID NOT NULL REFERENCES partner_work_order_versions(id),
 revision_number INTEGER NOT NULL CHECK(revision_number>0),
 effective_from TIMESTAMPTZ NOT NULL, effective_until TIMESTAMPTZ,
 duration INTEGER NOT NULL CHECK(duration BETWEEN 0 AND 3660),
 duration_unit TEXT NOT NULL CHECK(duration_unit IN ('hours','calendar_days','business_days')),
 trigger_event TEXT NOT NULL CHECK(trigger_event IN ('customer_received','decision_recorded')),
 time_zone TEXT NOT NULL, holidays JSONB NOT NULL DEFAULT '[]',
 source_reference TEXT NOT NULL, approved_by UUID NOT NULL REFERENCES users(id), approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 client_mutation_id UUID NOT NULL, UNIQUE(tenant_id,id), UNIQUE(tenant_id,work_order_version_id,revision_number),
 UNIQUE(tenant_id,approved_by,client_mutation_id), CHECK(effective_until IS NULL OR effective_until>effective_from)
);
ALTER TABLE production_corrections
 ADD COLUMN deadline_policy_id UUID,
 ADD COLUMN deadline_status TEXT NOT NULL DEFAULT 'needs_policy_review' CHECK(deadline_status IN ('needs_policy_review','needs_received_time','scheduled')),
 ADD COLUMN customer_received_at TIMESTAMPTZ,
 ADD COLUMN deadline_trigger_at TIMESTAMPTZ,
 ADD COLUMN due_at TIMESTAMPTZ,
 ADD COLUMN deadline_time_zone TEXT,
 ADD COLUMN responsible_user_id UUID REFERENCES users(id),
 ADD FOREIGN KEY(tenant_id,deadline_policy_id) REFERENCES prime_correction_policies(tenant_id,id);
-- Existing manually entered dates are preserved, but are not certified as policy-derived.
CREATE INDEX production_corrections_deadline_review ON production_corrections(tenant_id,deadline_status,due_at) WHERE deleted_at IS NULL;
