-- Normalized, manually reviewed observations only. No provider polling/webhook
-- activation and no automatic payment posting.
CREATE TABLE external_payment_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 provider TEXT NOT NULL CHECK (provider IN ('passport','bank','other')),
 account_reference TEXT NOT NULL,
 transaction_reference TEXT NOT NULL,
 payee_reference TEXT NOT NULL,
 amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
 currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 observed_status TEXT NOT NULL CHECK (observed_status IN ('pending','completed','failed','returned','reversed')),
 completed_date DATE,
 evidence_reference TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 review_status TEXT NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('needs_review','linked')),
 external_partner_payment_id UUID,
 reviewed_by UUID REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 review_note TEXT,
 received_by UUID NOT NULL REFERENCES users(id),
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,provider,account_reference,transaction_reference,fingerprint),
 CHECK (observed_status <> 'completed' OR completed_date IS NOT NULL),
 CHECK ((review_status='needs_review' AND external_partner_payment_id IS NULL) OR
        (review_status='linked' AND external_partner_payment_id IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX external_partner_payments_tenant_id_uidx ON external_partner_payments(tenant_id,id);
ALTER TABLE external_payment_observations ADD CONSTRAINT external_observation_payment_tenant_fk
 FOREIGN KEY (tenant_id,external_partner_payment_id) REFERENCES external_partner_payments(tenant_id,id);
CREATE INDEX external_observation_review_idx ON external_payment_observations(tenant_id,review_status,received_at);
