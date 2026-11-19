CREATE TABLE field_upload_sessions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 user_id UUID NOT NULL REFERENCES users(id), request_key UUID NOT NULL,
 metadata JSONB NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 104857600),
 checksum TEXT NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
 evidence_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days',
 UNIQUE(tenant_id,user_id,request_key), UNIQUE(tenant_id,user_id,id)
);
CREATE TABLE field_upload_chunks (
 session_id UUID NOT NULL REFERENCES field_upload_sessions(id) ON DELETE CASCADE,
 chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 99),
 content BYTEA NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 1048576),
 checksum TEXT NOT NULL, PRIMARY KEY(session_id,chunk_index)
);
CREATE INDEX field_upload_expiry ON field_upload_sessions(expires_at);
CREATE INDEX forms_history ON supplemental_form_versions(tenant_id,created_at DESC,id DESC);
CREATE INDEX form_records_history ON supplemental_form_records(tenant_id,created_at DESC,id DESC);
CREATE INDEX material_history ON material_movements(tenant_id,created_at DESC,id DESC);
CREATE INDEX inquiry_history ON customer_service_inquiries(tenant_id,created_at DESC,id DESC);
