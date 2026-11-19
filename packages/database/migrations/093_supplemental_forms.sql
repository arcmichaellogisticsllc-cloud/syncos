-- Supplemental records cannot replace the fixed safety or financial control tables.
CREATE TABLE supplemental_form_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 request_key UUID NOT NULL, family_id UUID NOT NULL, version INTEGER NOT NULL CHECK(version>0), schema JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 created_by UUID NOT NULL REFERENCES users(id), published_by UUID REFERENCES users(id), published_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,request_key), UNIQUE(tenant_id,family_id,version)
);
CREATE TABLE supplemental_form_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),
 version_id UUID NOT NULL, schema_snapshot JSONB NOT NULL, answers JSONB NOT NULL,
 submitted_by UUID NOT NULL REFERENCES users(id), request_key UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,request_key),
 FOREIGN KEY(tenant_id,version_id) REFERENCES supplemental_form_versions(tenant_id,id)
);
CREATE FUNCTION protect_supplemental_form_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='published' OR NEW.schema<>OLD.schema OR NEW.family_id<>OLD.family_id OR NEW.version<>OLD.version OR NEW.tenant_id<>OLD.tenant_id THEN RAISE EXCEPTION 'Form versions are immutable; create a new revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_version BEFORE UPDATE OR DELETE ON supplemental_form_versions FOR EACH ROW EXECUTE FUNCTION protect_supplemental_form_version();
CREATE FUNCTION protect_supplemental_form_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Submitted form records are immutable'; END $$;
CREATE TRIGGER protect_record BEFORE UPDATE OR DELETE ON supplemental_form_records FOR EACH ROW EXECUTE FUNCTION protect_supplemental_form_record();
INSERT INTO permissions(key,name) VALUES ('form.read','Read supplemental forms'),('form.manage','Create and publish supplemental forms'),('form.submit','Submit supplemental forms') ON CONFLICT(key) DO NOTHING;
-- Deliberate initial grant only to existing system administrators; further role grants are governed.
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
 SELECT r.tenant_id,r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE r.system_key='system_admin' AND r.deleted_at IS NULL AND p.key IN ('form.read','form.manage','form.submit') ON CONFLICT DO NOTHING;
