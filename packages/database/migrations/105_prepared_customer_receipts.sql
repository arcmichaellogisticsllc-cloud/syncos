-- Provider-independent preparation only. No worker or HTTP posting activation.
CREATE TABLE passport_receivable_mappings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,connection_id UUID NOT NULL,
 transaction_reference TEXT NOT NULL,payer_reference TEXT NOT NULL,invoice_id UUID NOT NULL,
 amount NUMERIC(14,2) NOT NULL CHECK(amount>0),currency TEXT NOT NULL CHECK(currency='USD'),
 evidence_reference TEXT NOT NULL,approved_by UUID NOT NULL REFERENCES users(id),approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,connection_id,transaction_reference),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES passport_connections(tenant_id,id),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id)
);
CREATE TRIGGER passport_receivable_mapping_immutable BEFORE UPDATE OR DELETE ON passport_receivable_mappings FOR EACH ROW EXECUTE FUNCTION protect_passport_approved_mapping();
CREATE TABLE passport_recorded_receipts (
 tenant_id UUID NOT NULL,connection_id UUID NOT NULL,transaction_reference TEXT NOT NULL,
 observation_id UUID NOT NULL,cash_receipt_id UUID NOT NULL,payment_application_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,connection_id,transaction_reference),UNIQUE(tenant_id,cash_receipt_id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES passport_connections(tenant_id,id),
 FOREIGN KEY(tenant_id,observation_id) REFERENCES passport_observations(tenant_id,id),
 FOREIGN KEY(tenant_id,cash_receipt_id) REFERENCES cash_receipts(tenant_id,id),
 FOREIGN KEY(tenant_id,payment_application_id) REFERENCES payment_applications(tenant_id,id)
);
CREATE TRIGGER passport_receipt_immutable BEFORE UPDATE OR DELETE ON passport_recorded_receipts FOR EACH ROW EXECUTE FUNCTION protect_passport_approved_mapping();
