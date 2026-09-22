-- Internal crews share field records but are never external partner companies/payees.
ALTER TABLE capacity_providers DROP CONSTRAINT capacity_providers_provider_type_check;
ALTER TABLE capacity_providers ADD CONSTRAINT capacity_providers_provider_type_check CHECK
 (provider_type IN ('subcontractor','crew_provider','equipment_provider','staffing_partner','vendor','internal_workforce'));
ALTER TABLE partner_work_order_versions ADD COLUMN execution_model TEXT NOT NULL DEFAULT 'partner' CHECK (execution_model IN ('partner','internal'));
ALTER TABLE partner_work_order_versions ALTER COLUMN governing_agreement_version_id DROP NOT NULL;
ALTER TABLE partner_work_order_versions ALTER COLUMN rate_schedule_id DROP NOT NULL;
ALTER TABLE partner_work_order_versions ADD CONSTRAINT work_order_execution_contract_check CHECK
 (execution_model = 'internal' OR (governing_agreement_version_id IS NOT NULL AND rate_schedule_id IS NOT NULL));
CREATE TABLE internal_field_clearances (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 work_order_version_id UUID NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('authorized','held','revoked')),
 evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) > 0),
 checklist JSONB NOT NULL,
 valid_until DATE NOT NULL,
 authorized_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,work_order_version_id),
 FOREIGN KEY (tenant_id,work_order_version_id) REFERENCES partner_work_order_versions(tenant_id,id)
);
CREATE TABLE external_partner_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 contractor_payable_id UUID NOT NULL,
 payment_id UUID NOT NULL REFERENCES payments(id),
 amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
 payment_date DATE NOT NULL,
 method TEXT NOT NULL CHECK (method IN ('ach','wire','check','passport','other')),
 reference TEXT NOT NULL,
 evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) > 0),
 idempotency_key TEXT NOT NULL,
 recorded_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,idempotency_key),
 UNIQUE (tenant_id,method,reference),
 FOREIGN KEY (tenant_id,contractor_payable_id) REFERENCES contractor_payables(tenant_id,id)
);
INSERT INTO roles (tenant_id,name,system_key) SELECT id,'Sync Foreman','sync_foreman' FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_id)
SELECT r.tenant_id,r.id,rp.permission_id FROM roles r JOIN roles p ON p.tenant_id=r.tenant_id AND p.system_key='partner_foreman'
JOIN role_permissions rp ON rp.tenant_id=p.tenant_id AND rp.role_id=p.id
JOIN permissions perm ON perm.id=rp.permission_id
WHERE r.system_key='sync_foreman' AND perm.key NOT IN ('partner_compliance.summary.read','partner_notice.foreman.acknowledge')
ON CONFLICT DO NOTHING;
