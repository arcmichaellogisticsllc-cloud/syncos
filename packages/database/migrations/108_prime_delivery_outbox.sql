CREATE TABLE prime_delivery_destinations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),contract_id uuid NOT NULL REFERENCES contracts(id),
 name text NOT NULL,endpoint text NOT NULL,credential_env text NOT NULL,recipient text NOT NULL,source_reference text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,approved_by uuid NOT NULL REFERENCES users(id),approved_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id)
);
CREATE TRIGGER prime_destination_immutable BEFORE UPDATE OR DELETE ON prime_delivery_destinations FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
CREATE TABLE prime_delivery_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),invoice_id uuid NOT NULL REFERENCES invoices(id),package_id uuid NOT NULL,
 destination_id uuid NOT NULL,requested_by uuid NOT NULL REFERENCES users(id),client_mutation_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','delivered','review','cancelled','failed')),
 event_type text NOT NULL CHECK(event_type IN ('delivered','resubmitted')),attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,receipt jsonb,last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,package_id) REFERENCES invoice_packages(tenant_id,id),FOREIGN KEY(tenant_id,destination_id) REFERENCES prime_delivery_destinations(tenant_id,id),
 UNIQUE(tenant_id,requested_by,client_mutation_id),UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX prime_delivery_one_pending_invoice ON prime_delivery_jobs(tenant_id,invoice_id) WHERE status IN ('queued','processing','review');
CREATE INDEX prime_delivery_queue ON prime_delivery_jobs(next_attempt_at) WHERE status='queued';
CREATE TABLE prime_delivery_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,job_id uuid NOT NULL,attempt integer NOT NULL,
 outcome text NOT NULL,receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,job_id) REFERENCES prime_delivery_jobs(tenant_id,id),UNIQUE(job_id,attempt)
);
CREATE TRIGGER prime_delivery_attempt_immutable BEFORE UPDATE OR DELETE ON prime_delivery_attempts FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
CREATE TABLE prime_delivery_destination_revocations (
 destination_id uuid PRIMARY KEY REFERENCES prime_delivery_destinations(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 reason text NOT NULL,revoked_by uuid NOT NULL REFERENCES users(id),revoked_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,destination_id) REFERENCES prime_delivery_destinations(tenant_id,id)
);
CREATE TRIGGER prime_destination_revocation_immutable BEFORE UPDATE OR DELETE ON prime_delivery_destination_revocations FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
