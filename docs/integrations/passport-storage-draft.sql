-- DESIGN DRAFT ONLY. Not registered in the migration manifest and not applied.
-- Validate foreign-key names, RLS/permissions, upgrade/rollback and retention with
-- the real integration before turning this into a numbered migration.
CREATE TABLE passport_connections (
 id UUID PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 customer_reference TEXT NOT NULL,
 account_reference TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 contract_version TEXT,
 secret_reference TEXT, -- reference to secret manager, never a credential
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id),
 UNIQUE(environment,customer_reference,account_reference)
);
CREATE TABLE passport_observations (
 id UUID PRIMARY KEY,
 tenant_id UUID NOT NULL,
 connection_id UUID NOT NULL,
 transaction_reference TEXT NOT NULL,
 provider_version TEXT NOT NULL, -- ordering semantics must be verified in sandbox
 fingerprint TEXT NOT NULL,
 normalized_metadata JSONB NOT NULL, -- strict safe-field allowlist only
 outcome TEXT NOT NULL CHECK(outcome IN ('pending','exception','recorded')),
 observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(connection_id,tenant_id) REFERENCES passport_connections(id,tenant_id),
 UNIQUE(connection_id,transaction_reference,provider_version)
);
CREATE TABLE passport_payable_mappings (
 id UUID PRIMARY KEY,
 tenant_id UUID NOT NULL,
 connection_id UUID NOT NULL,
 transaction_reference TEXT NOT NULL,
 payee_reference TEXT NOT NULL,
 contractor_payable_id UUID NOT NULL,
 amount NUMERIC(18,2) NOT NULL CHECK(amount > 0),
 currency CHAR(3) NOT NULL,
 approved_by UUID NOT NULL REFERENCES users(id),
 approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(connection_id,tenant_id) REFERENCES passport_connections(id,tenant_id),
 UNIQUE(connection_id,transaction_reference)
 -- Runtime must verify payable tenant, partner identity, acceptance and eligibility
 -- under row lock; add composite payable FK with verified candidate schema.
);
CREATE TABLE passport_reconciliation_exceptions (
 id UUID PRIMARY KEY,
 tenant_id UUID NOT NULL,
 connection_id UUID NOT NULL,
 transaction_reference TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','resolved_by_reconciliation','resolved_by_review')),
 reviewed_by UUID REFERENCES users(id),
 review_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(connection_id,tenant_id) REFERENCES passport_connections(id,tenant_id),
 UNIQUE(connection_id,transaction_reference,fingerprint,reason)
);
-- Recording writes must share the payable row lock and existing manual external
-- payment deduplication. Add provider provenance without impersonating a person.
-- A durable job table/outbox must store refresh hints, retry count and lease;
-- cursor writes must be serialized per connection and crash-safe. Do not connect
-- this draft to existing payments until atomicity/recovery tests pass.
