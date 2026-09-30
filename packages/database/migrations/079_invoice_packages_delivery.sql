CREATE TABLE invoice_package_policies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),contract_id UUID NOT NULL REFERENCES contracts(id),
 required_documents JSONB NOT NULL CHECK(jsonb_typeof(required_documents)='array'),source_reference TEXT NOT NULL,
 approved_by UUID NOT NULL REFERENCES users(id),approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,id)
);
CREATE TABLE invoice_package_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),invoice_id UUID NOT NULL REFERENCES invoices(id),
 document_kind TEXT NOT NULL,file_name TEXT NOT NULL,mime_type TEXT NOT NULL CHECK(mime_type='application/pdf'),
 content_bytes BYTEA NOT NULL CHECK(octet_length(content_bytes) BETWEEN 1 AND 20971520),checksum TEXT NOT NULL,
 reviewed_by UUID NOT NULL REFERENCES users(id),reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,invoice_id,document_kind,checksum)
);
CREATE TABLE invoice_packages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),invoice_id UUID NOT NULL REFERENCES invoices(id),
 policy_id UUID NOT NULL,revision_number INTEGER NOT NULL,source_fingerprint TEXT NOT NULL,manifest JSONB NOT NULL,
 archive_bytes BYTEA NOT NULL,archive_checksum TEXT NOT NULL,created_by UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,invoice_id,revision_number),FOREIGN KEY(tenant_id,policy_id) REFERENCES invoice_package_policies(tenant_id,id)
);
CREATE TABLE invoice_delivery_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),invoice_id UUID NOT NULL REFERENCES invoices(id),
 package_id UUID NOT NULL,event_type TEXT NOT NULL CHECK(event_type IN ('delivered','rejected','resubmitted','accepted')),
 occurred_at TIMESTAMPTZ NOT NULL,recipient TEXT NOT NULL,proof_reference TEXT NOT NULL,notes TEXT NOT NULL,
 client_mutation_id UUID NOT NULL,recorded_by UUID NOT NULL REFERENCES users(id),recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,recorded_by,client_mutation_id),FOREIGN KEY(tenant_id,package_id) REFERENCES invoice_packages(tenant_id,id)
);
CREATE TRIGGER invoice_package_policy_immutable BEFORE UPDATE OR DELETE ON invoice_package_policies FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
CREATE TRIGGER invoice_package_document_immutable BEFORE UPDATE OR DELETE ON invoice_package_documents FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
CREATE TRIGGER invoice_package_immutable BEFORE UPDATE OR DELETE ON invoice_packages FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
CREATE TRIGGER invoice_delivery_event_immutable BEFORE UPDATE OR DELETE ON invoice_delivery_events FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
