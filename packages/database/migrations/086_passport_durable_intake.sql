-- Durable preparation only. No provider connection or automatic payment posting is enabled.
CREATE TABLE passport_connections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 environment TEXT NOT NULL DEFAULT 'sandbox' CHECK(environment='sandbox'),
 customer_reference TEXT NOT NULL, account_reference TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false CHECK(enabled=false),
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(environment,customer_reference,account_reference)
);
CREATE UNIQUE INDEX IF NOT EXISTS passport_payable_tenant_identity ON contractor_payables(tenant_id,id);
CREATE TABLE passport_payable_mappings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 connection_id UUID NOT NULL, transaction_reference TEXT NOT NULL, payee_reference TEXT NOT NULL,
 contractor_payable_id UUID NOT NULL, amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
 currency TEXT NOT NULL CHECK(currency='USD'), evidence_reference TEXT NOT NULL,
 approved_by UUID NOT NULL REFERENCES users(id), approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES passport_connections(tenant_id,id),
 FOREIGN KEY(tenant_id,contractor_payable_id) REFERENCES contractor_payables(tenant_id,id),
 UNIQUE(connection_id,transaction_reference)
);
CREATE TABLE passport_refresh_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, connection_id UUID NOT NULL,
 transaction_reference TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','leased','complete','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_token UUID, lease_until TIMESTAMPTZ, last_error_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES passport_connections(tenant_id,id),
 UNIQUE(connection_id,transaction_reference)
);
CREATE TABLE passport_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, connection_id UUID NOT NULL,
 transaction_reference TEXT NOT NULL, normalized_version BIGINT NOT NULL CHECK(normalized_version>0),
 fingerprint TEXT NOT NULL, normalized_metadata JSONB NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES passport_connections(tenant_id,id),
 UNIQUE(connection_id,transaction_reference,normalized_version,fingerprint)
);
CREATE TABLE passport_reconciliation_exceptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, connection_id UUID NOT NULL,
 transaction_reference TEXT NOT NULL, fingerprint TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewed')),
 reviewed_by UUID REFERENCES users(id), review_note TEXT, reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES passport_connections(tenant_id,id),
 UNIQUE(connection_id,transaction_reference,fingerprint,reason),
 CHECK(status='open' OR (reviewed_by IS NOT NULL AND review_note IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE passport_poll_checkpoints (
 tenant_id UUID NOT NULL, connection_id UUID PRIMARY KEY, cursor TEXT,
 version BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES passport_connections(tenant_id,id)
);
CREATE INDEX passport_jobs_ready ON passport_refresh_jobs(status,available_at,lease_until);
CREATE FUNCTION protect_passport_approved_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Approved Passport mapping is immutable; resolve conflicting mapping through controlled review'; END $$;
CREATE TRIGGER passport_mapping_immutable BEFORE UPDATE OR DELETE ON passport_payable_mappings FOR EACH ROW EXECUTE FUNCTION protect_passport_approved_mapping();
CREATE TRIGGER passport_observation_immutable BEFORE UPDATE OR DELETE ON passport_observations FOR EACH ROW EXECUTE FUNCTION protect_passport_approved_mapping();
