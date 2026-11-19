ALTER TABLE daily_jsa_participants ADD COLUMN acknowledged_by UUID REFERENCES users(id);
ALTER TABLE daily_jsa_participants ADD COLUMN acknowledged_at TIMESTAMPTZ;
-- Existing acknowledged flags are historical, not independently verified identities.
ALTER TABLE partner_work_order_versions ADD COLUMN pre_bore_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partner_work_order_versions ADD COLUMN safety_scope_reviewed_at TIMESTAMPTZ;
ALTER TABLE partner_work_order_versions ADD COLUMN safety_scope_reviewed_by UUID REFERENCES users(id);
ALTER TABLE partner_work_order_versions ADD COLUMN safety_scope_evidence_reference TEXT;
CREATE TABLE work_safety_controls (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 work_order_id UUID NOT NULL, crew_id UUID, work_location TEXT,
 control_type TEXT NOT NULL CHECK(control_type IN ('pre_bore','stop')),
 reason TEXT NOT NULL, utility_strike BOOLEAN NOT NULL DEFAULT false,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','approved','released','revoked')),
 daily_jsa_id UUID, required_approvals TEXT[] NOT NULL,
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 resolved_by UUID REFERENCES users(id), resolved_at TIMESTAMPTZ,
 revocation_reason TEXT, revoked_by UUID REFERENCES users(id), revoked_at TIMESTAMPTZ,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,work_order_id) REFERENCES work_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,crew_id) REFERENCES crews(tenant_id,id),
 FOREIGN KEY(tenant_id,daily_jsa_id) REFERENCES daily_jsas(tenant_id,id),
 CHECK(control_type<>'pre_bore' OR (crew_id IS NOT NULL AND daily_jsa_id IS NOT NULL AND work_location IS NOT NULL))
);
CREATE TABLE work_safety_approvals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL, control_id UUID NOT NULL,
 approval_kind TEXT NOT NULL CHECK(approval_kind IN ('construction_supervisor','utility_owner','safety','operations')),
 approver_name TEXT NOT NULL, evidence_reference TEXT NOT NULL,
 recorded_by UUID NOT NULL REFERENCES users(id), approved_at TIMESTAMPTZ NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,control_id) REFERENCES work_safety_controls(tenant_id,id),
 UNIQUE(tenant_id,control_id,approval_kind)
);
CREATE INDEX work_safety_active_idx ON work_safety_controls(tenant_id,work_order_id,status);
-- Preserve existing stop facts and require reviewed restart; never invent approval.
ALTER TABLE work_safety_controls ADD COLUMN source_production_record_id UUID;
ALTER TABLE work_safety_controls ADD FOREIGN KEY(tenant_id,source_production_record_id) REFERENCES production_records(tenant_id,id);
ALTER TABLE work_safety_controls ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE work_safety_controls ADD CHECK(created_by IS NOT NULL OR source_production_record_id IS NOT NULL);
CREATE UNIQUE INDEX work_safety_record_active_idx ON work_safety_controls(tenant_id,source_production_record_id) WHERE status='active' AND source_production_record_id IS NOT NULL;
INSERT INTO work_safety_controls(tenant_id,work_order_id,crew_id,control_type,reason,status,required_approvals,created_by,created_at,source_production_record_id)
SELECT tenant_id,work_order_id,crew_id,'stop',COALESCE(stop_work_reason,'Existing shutdown; verify source record before restart'),'active',ARRAY['safety','operations'],stop_work_by,COALESCE(stop_work_at,created_at),id
FROM production_records WHERE stop_work_status='active' AND work_order_id IS NOT NULL;
ALTER TABLE work_safety_controls ADD COLUMN classification_review_required BOOLEAN NOT NULL DEFAULT false;
UPDATE work_safety_controls SET classification_review_required=true WHERE source_production_record_id IS NOT NULL;
