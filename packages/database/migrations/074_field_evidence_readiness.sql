CREATE TABLE field_evidence_policies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 work_order_version_id UUID NOT NULL, revision_number INTEGER NOT NULL CHECK(revision_number>0),
 requirements JSONB NOT NULL CHECK(jsonb_typeof(requirements)='object'),
 capture_time_required BOOLEAN NOT NULL DEFAULT true,
 source_reference TEXT NOT NULL, approved_by UUID NOT NULL REFERENCES users(id),approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,work_order_version_id,revision_number),
 FOREIGN KEY(tenant_id,work_order_version_id) REFERENCES partner_work_order_versions(tenant_id,id)
);
ALTER TABLE daily_production_reports ADD COLUMN evidence_policy_id UUID;
ALTER TABLE daily_production_reports ADD FOREIGN KEY(tenant_id,evidence_policy_id) REFERENCES field_evidence_policies(tenant_id,id);
ALTER TABLE syncfield_field_evidence ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'other' CHECK(evidence_kind IN ('before','during','after','as_built','test_result','permit','other'));
ALTER TABLE syncfield_field_evidence ADD COLUMN captured_at TIMESTAMPTZ;
ALTER TABLE syncfield_field_evidence ADD COLUMN capture_location TEXT;
ALTER TABLE syncfield_field_evidence ADD COLUMN received_revision_number INTEGER;
ALTER TABLE syncfield_field_evidence ADD COLUMN readability_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(readability_status IN ('unreviewed','readable','unreadable'));
ALTER TABLE syncfield_field_evidence ADD UNIQUE(tenant_id,id);
CREATE TABLE field_evidence_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),evidence_id UUID NOT NULL,
 readability_status TEXT NOT NULL CHECK(readability_status IN ('readable','unreadable')),review_notes TEXT NOT NULL,
 reviewed_by UUID NOT NULL REFERENCES users(id),reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES syncfield_field_evidence(tenant_id,id)
);
ALTER TABLE customer_qc_decisions ADD COLUMN accepted_evidence_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE syncfield_field_evidence DROP CONSTRAINT syncfield_field_evidence_mime_type_check;
ALTER TABLE syncfield_field_evidence ADD CONSTRAINT syncfield_field_evidence_mime_type_check CHECK(mime_type IN ('image/jpeg','image/png','image/heic','image/heif','application/pdf','video/mp4','video/quicktime'));
