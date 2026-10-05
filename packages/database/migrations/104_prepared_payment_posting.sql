-- Posting lineage for an internal normalized-contract rehearsal. No provider activation.
CREATE UNIQUE INDEX passport_observations_tenant_id ON passport_observations(tenant_id,id);
CREATE TABLE passport_recorded_payments (
 tenant_id UUID NOT NULL,connection_id UUID NOT NULL,transaction_reference TEXT NOT NULL,
 observation_id UUID NOT NULL,external_partner_payment_id UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connection_id,transaction_reference),UNIQUE(tenant_id,external_partner_payment_id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES passport_connections(tenant_id,id),
 FOREIGN KEY(tenant_id,observation_id) REFERENCES passport_observations(tenant_id,id),
 FOREIGN KEY(tenant_id,external_partner_payment_id) REFERENCES external_partner_payments(tenant_id,id)
);
CREATE TRIGGER passport_posting_immutable BEFORE UPDATE OR DELETE ON passport_recorded_payments FOR EACH ROW EXECUTE FUNCTION protect_passport_approved_mapping();
