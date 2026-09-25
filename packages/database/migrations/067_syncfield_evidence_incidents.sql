CREATE TABLE syncfield_field_evidence (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 daily_report_id UUID NOT NULL, production_record_id UUID, crew_id UUID NOT NULL,
 organization_id UUID NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','application/pdf')),
 content_bytes BYTEA NOT NULL CHECK(octet_length(content_bytes) BETWEEN 1 AND 2097152),
 description TEXT NOT NULL, checksum TEXT NOT NULL, uploaded_by_user_id UUID NOT NULL,
 client_mutation_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id, uploaded_by_user_id, client_mutation_id),
 FOREIGN KEY (tenant_id,daily_report_id) REFERENCES daily_production_reports(tenant_id,id)
);
CREATE INDEX syncfield_field_evidence_report ON syncfield_field_evidence(tenant_id,daily_report_id);
CREATE TABLE syncfield_field_incidents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 crew_id UUID NOT NULL, organization_id UUID NOT NULL, work_order_id UUID NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL, incident_type TEXT NOT NULL CHECK(incident_type IN ('injury','near_miss','property_damage','environmental','other')),
 location TEXT NOT NULL, description TEXT NOT NULL, immediate_action TEXT NOT NULL,
 reported_by_user_id UUID NOT NULL, client_mutation_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(tenant_id,reported_by_user_id,client_mutation_id)
);
