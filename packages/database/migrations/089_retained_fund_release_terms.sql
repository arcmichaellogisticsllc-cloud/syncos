-- Explicit release-specific contract evidence; existing releases remain blocked until reviewed.
CREATE TABLE retained_fund_release_terms (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 retainage_release_id UUID NOT NULL,
 commercial_terms_revision_id UUID NOT NULL,
 payment_trigger TEXT NOT NULL CHECK(payment_trigger IN ('release_approval','customer_retainage_receipt','invoice_acceptance','other_contract_event')),
 payment_days INTEGER NOT NULL CHECK(payment_days BETWEEN 0 AND 3660),
 payment_day_basis TEXT NOT NULL CHECK(payment_day_basis IN ('calendar_days','business_days')),
 time_zone TEXT NOT NULL, holidays JSONB NOT NULL, holiday_calendar_through DATE,
 trigger_occurred_at TIMESTAMPTZ, trigger_proof_reference TEXT,
 source_reference TEXT NOT NULL, approved_by UUID NOT NULL REFERENCES users(id), approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,retainage_release_id),
 FOREIGN KEY(tenant_id,retainage_release_id) REFERENCES retainage_releases(tenant_id,id),
 FOREIGN KEY(tenant_id,commercial_terms_revision_id) REFERENCES commercial_terms_revisions(tenant_id,id),
 CHECK(payment_trigger='release_approval' OR (trigger_occurred_at IS NOT NULL AND length(trim(trigger_proof_reference))>=3))
);
CREATE TRIGGER retained_terms_immutable BEFORE UPDATE OR DELETE ON retained_fund_release_terms FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON retained_fund_release_terms FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON retainage_releases FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
ALTER TABLE contractor_payable_items ADD COLUMN source_retainage_item_id UUID,
 ADD FOREIGN KEY(tenant_id,source_retainage_item_id) REFERENCES contractor_payable_items(tenant_id,id);
