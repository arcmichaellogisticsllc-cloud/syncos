CREATE TABLE customer_service_inquiries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),request_key UUID NOT NULL,
 customer_name TEXT NOT NULL,email TEXT NOT NULL,subject TEXT NOT NULL,details TEXT NOT NULL,source_reference TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','assigned','awaiting_customer','qualified','closed')),
 owner_user_id UUID REFERENCES users(id),opportunity_id UUID REFERENCES opportunities(id),project_id UUID REFERENCES projects(id),
 follow_up_note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,request_key)
);
CREATE TABLE customer_inquiry_files (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),inquiry_id UUID NOT NULL,
 file_name TEXT NOT NULL,mime_type TEXT NOT NULL,checksum TEXT NOT NULL,content BYTEA NOT NULL,
 created_by UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,inquiry_id) REFERENCES customer_service_inquiries(tenant_id,id),UNIQUE(tenant_id,inquiry_id,checksum),CHECK(octet_length(content)<=5242880)
);
INSERT INTO permissions(key,name) VALUES ('customer_inquiry.read','Read customer service inquiries'),('customer_inquiry.manage','Manage customer service inquiries') ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT r.tenant_id,r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_key='system_admin' AND r.deleted_at IS NULL AND p.key IN ('customer_inquiry.read','customer_inquiry.manage') ON CONFLICT DO NOTHING;
