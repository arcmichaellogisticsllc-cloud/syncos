-- Explicit bounded delegation; no tenant-wide forms or inventory grant.
INSERT INTO permissions(key,name) VALUES('partner_form.delegate','Delegate company-assigned supplemental forms') ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT r.tenant_id,r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.system_key='partner_admin' AND r.deleted_at IS NULL AND p.key='partner_form.delegate'
ON CONFLICT DO NOTHING;
CREATE INDEX company_field_assignment_history ON syncfield_map_assignments(tenant_id,organization_id,id DESC) WHERE deleted_at IS NULL;
