-- Preserve the existing demo personas while enabling the new workspaces for its administrator.
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
 SELECT r.tenant_id,r.id,p.id FROM roles r JOIN tenants t ON t.id=r.tenant_id CROSS JOIN permissions p
 WHERE t.slug='arc-syncos-demo' AND r.system_key='e2e_system_admin' AND r.deleted_at IS NULL
 AND p.key IN ('form.read','form.manage','form.submit','inventory.read','inventory.manage','inventory.adjust','customer_inquiry.read','customer_inquiry.manage')
 ON CONFLICT DO NOTHING;
CREATE INDEX inquiry_duplicate_lookup ON customer_service_inquiries(tenant_id,lower(email),lower(subject));
CREATE FUNCTION protect_customer_inquiry_original() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Original inquiry attachments are immutable'; END $$;
CREATE TRIGGER immutable_inquiry_original BEFORE UPDATE OR DELETE ON customer_inquiry_files FOR EACH ROW EXECUTE FUNCTION protect_customer_inquiry_original();
