-- Permit failure details only on the submitted-to-failed transition.
-- Source, amount, payee, tenant and ownership remain frozen.
CREATE OR REPLACE FUNCTION enforce_payment_item_security() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch payment_batches; source_limit numeric; used numeric; source_parent uuid;
 allowed_fields text[] := ARRAY['updated_at','updated_by','status','execution_status','execution_reference','executed_at','executed_by','submitted_at','submitted_by'];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':payment-preparation',0));
 SELECT * INTO batch FROM payment_batches WHERE tenant_id=NEW.tenant_id AND id=NEW.payment_batch_id FOR UPDATE;
 IF batch.id IS NULL THEN RAISE EXCEPTION 'Payment batch unavailable'; END IF;
 IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.payment_batch_id<>OLD.payment_batch_id) THEN RAISE EXCEPTION 'Payment ownership is immutable'; END IF;
 IF TG_OP='UPDATE' AND batch.status='submitted' AND OLD.status='submitted_later' AND NEW.status='failed' AND NEW.execution_status='failed' THEN
  allowed_fields := allowed_fields || ARRAY['failure_reason','failure_note'];
 END IF;
 IF batch.status NOT IN ('draft','assembling','rejected') THEN
  IF TG_OP='INSERT' OR (to_jsonb(NEW)-allowed_fields) IS DISTINCT FROM (to_jsonb(OLD)-allowed_fields) THEN
   RAISE EXCEPTION 'Withdraw approval before changing payment instructions';
  END IF;
 END IF;
 IF NEW.deleted_at IS NOT NULL OR NEW.status IN ('voided','archived','cancelled') THEN RETURN NEW; END IF;
 IF NEW.source_type='payroll' THEN
  SELECT net_pay_amount,payroll_run_id INTO source_limit,source_parent FROM payroll_items WHERE tenant_id=NEW.tenant_id AND id=NEW.payroll_item_id AND deleted_at IS NULL FOR UPDATE;
  IF source_parent IS DISTINCT FROM NEW.payroll_run_id THEN RAISE EXCEPTION 'Payroll source mismatch'; END IF;
  NEW.security_source_key:='payroll:'||NEW.payroll_item_id::text;
  SELECT coalesce(sum(payment_amount),0) INTO used FROM payment_items WHERE tenant_id=NEW.tenant_id AND payroll_item_id=NEW.payroll_item_id AND id<>NEW.id AND deleted_at IS NULL AND status NOT IN ('voided','archived','cancelled');
 ELSIF NEW.source_type='contractor_payable' THEN
  SELECT greatest(net_payable_amount-coalesce(paid_amount,0),0) INTO source_limit FROM contractor_payables WHERE tenant_id=NEW.tenant_id AND id=NEW.contractor_payable_id AND deleted_at IS NULL FOR UPDATE;
  IF NEW.contractor_payable_item_id IS NOT NULL THEN
   SELECT contractor_payable_id INTO source_parent FROM contractor_payable_items WHERE tenant_id=NEW.tenant_id AND id=NEW.contractor_payable_item_id AND deleted_at IS NULL;
   IF source_parent IS DISTINCT FROM NEW.contractor_payable_id THEN RAISE EXCEPTION 'Payable source mismatch'; END IF;
   IF NEW.payment_amount>(SELECT net_payable_amount FROM contractor_payable_items WHERE tenant_id=NEW.tenant_id AND id=NEW.contractor_payable_item_id) THEN RAISE EXCEPTION 'Payment exceeds source amount'; END IF;
  END IF;
  NEW.security_source_key:='payable:'||NEW.contractor_payable_id::text||':'||coalesce(NEW.contractor_payable_item_id::text,'all');
  SELECT coalesce(sum(payment_amount),0) INTO used FROM payment_items WHERE tenant_id=NEW.tenant_id AND contractor_payable_id=NEW.contractor_payable_id AND id<>NEW.id AND deleted_at IS NULL AND status NOT IN ('voided','archived','cancelled');
  -- Both preparation paths reserve the same payable balance. Keep paid amounts
  -- separate; confirmed instructions have already advanced paid_amount.
  used := used + (SELECT coalesce(sum(amount),0) FROM partner_payment_instructions
    WHERE tenant_id=NEW.tenant_id AND contractor_payable_id=NEW.contractor_payable_id
      AND deleted_at IS NULL AND status IN ('draft','pending_approval','approved','submitted','processing'));
 ELSE RAISE EXCEPTION 'Unsupported payment source'; END IF;
 IF source_limit IS NULL OR NEW.payment_amount<=0 OR NEW.payment_amount+used>source_limit THEN RAISE EXCEPTION 'Payment exceeds unreserved source amount'; END IF;
 RETURN NEW;
END $$;
