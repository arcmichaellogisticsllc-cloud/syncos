ALTER TABLE contractor_payables ADD COLUMN commercial_terms_revision_id UUID,
 ADD FOREIGN KEY(tenant_id,commercial_terms_revision_id) REFERENCES commercial_terms_revisions(tenant_id,id);
CREATE TABLE partner_payment_trigger_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),contractor_payable_id UUID NOT NULL REFERENCES contractor_payables(id),
 trigger_type TEXT NOT NULL CHECK(trigger_type IN ('invoice_issue','invoice_delivery','invoice_acceptance')),
 occurred_at TIMESTAMPTZ NOT NULL,proof_reference TEXT NOT NULL,recorded_by UUID NOT NULL REFERENCES users(id),recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,contractor_payable_id,trigger_type)
);
CREATE TRIGGER partner_trigger_immutable BEFORE UPDATE OR DELETE ON partner_payment_trigger_events FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
