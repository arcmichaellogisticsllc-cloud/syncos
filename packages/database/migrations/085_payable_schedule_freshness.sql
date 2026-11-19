-- Preserve historical calculations; missing fingerprints require explicit recalculation.
ALTER TABLE contractor_payable_eligibility_snapshots ADD COLUMN source_fingerprint TEXT;
-- Serialize finance inputs and payment decisions per tenant, including legacy writers.
CREATE FUNCTION lock_financial_schedule_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.tenant_id,OLD.tenant_id)::text,85));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON cash_receipts FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON payment_applications FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON payment_application_allocations FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON accepted_production_financial_sources FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON contractor_payable_items FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON partner_payment_trigger_events FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
CREATE TRIGGER schedule_input_lock BEFORE INSERT OR UPDATE OR DELETE ON contractor_payables FOR EACH ROW EXECUTE FUNCTION lock_financial_schedule_inputs();
