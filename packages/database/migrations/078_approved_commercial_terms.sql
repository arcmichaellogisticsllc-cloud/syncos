-- New approvals are explicit. Historical amounts and demo records are not rewritten.
CREATE TABLE commercial_terms_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 contract_id UUID NOT NULL REFERENCES contracts(id), rate_schedule_id UUID NOT NULL REFERENCES rate_schedules(id),
 counterparty_organization_id UUID NOT NULL REFERENCES organizations(id),
 party_type TEXT NOT NULL CHECK(party_type IN ('customer','partner')),
 revision_number INTEGER NOT NULL CHECK(revision_number>0),
 effective_from DATE NOT NULL, effective_until DATE,
 payment_trigger TEXT NOT NULL CHECK(payment_trigger IN ('invoice_issue','invoice_delivery','invoice_acceptance','customer_payment')),
 payment_days INTEGER NOT NULL CHECK(payment_days BETWEEN 0 AND 3660),
 time_zone TEXT NOT NULL, retainage_percent NUMERIC(5,2) NOT NULL CHECK(retainage_percent BETWEEN 0 AND 100),
 rate_snapshot JSONB NOT NULL CHECK(jsonb_typeof(rate_snapshot)='array'),
 source_reference TEXT NOT NULL, approved_by UUID NOT NULL REFERENCES users(id), approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 client_mutation_id UUID NOT NULL, UNIQUE(tenant_id,id), UNIQUE(tenant_id,rate_schedule_id,party_type,revision_number),
 UNIQUE(tenant_id,approved_by,client_mutation_id), CHECK(effective_until IS NULL OR effective_until>=effective_from),
 CHECK(party_type='partner' OR payment_trigger<>'customer_payment')
);
ALTER TABLE accepted_production_financial_sources
 ADD COLUMN customer_terms_revision_id UUID,
 ADD COLUMN partner_terms_revision_id UUID,
 ADD FOREIGN KEY(tenant_id,customer_terms_revision_id) REFERENCES commercial_terms_revisions(tenant_id,id),
 ADD FOREIGN KEY(tenant_id,partner_terms_revision_id) REFERENCES commercial_terms_revisions(tenant_id,id);
ALTER TABLE invoices ADD COLUMN commercial_terms_revision_id UUID,
 ADD COLUMN contractual_due_at TIMESTAMPTZ, ADD COLUMN contract_trigger_at TIMESTAMPTZ,
 ADD FOREIGN KEY(tenant_id,commercial_terms_revision_id) REFERENCES commercial_terms_revisions(tenant_id,id);
CREATE FUNCTION protect_commercial_terms_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Approved commercial terms are immutable; approve a new revision'; END $$;
CREATE TRIGGER commercial_terms_immutable BEFORE UPDATE OR DELETE ON commercial_terms_revisions
 FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
