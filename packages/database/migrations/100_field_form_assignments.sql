CREATE TABLE supplemental_form_assignments (
 tenant_id UUID NOT NULL,version_id UUID NOT NULL,assignment_id UUID NOT NULL REFERENCES syncfield_map_assignments(id),
 assigned_by UUID NOT NULL REFERENCES users(id),active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,version_id,assignment_id),FOREIGN KEY(tenant_id,version_id) REFERENCES supplemental_form_versions(tenant_id,id)
);
ALTER TABLE supplemental_form_records ADD COLUMN assignment_id UUID REFERENCES syncfield_map_assignments(id);
CREATE INDEX supplemental_field_records ON supplemental_form_records(tenant_id,assignment_id,created_at DESC,id DESC);
