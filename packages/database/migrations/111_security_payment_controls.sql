-- Preserve historical rows. New writes are protected; suspicious historical
-- batches stay visible and require explicit withdrawal/review before advancing.
ALTER TABLE payment_batches ADD COLUMN security_review_required boolean NOT NULL DEFAULT false;
ALTER TABLE payment_items ADD COLUMN security_source_key text;
UPDATE payment_batches SET security_review_required=true
 WHERE deleted_at IS NULL AND (approval_status='approved' OR override_reasons<>'{}'::jsonb OR id IN
 (SELECT payment_batch_id FROM payment_items WHERE deleted_at IS NULL AND override_reasons<>'{}'::jsonb));
CREATE UNIQUE INDEX payment_items_active_security_source ON payment_items(tenant_id,security_source_key)
 WHERE deleted_at IS NULL AND status NOT IN ('voided','archived','cancelled') AND security_source_key IS NOT NULL;
CREATE FUNCTION enforce_payment_item_security() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch payment_batches; source_limit numeric; used numeric; source_parent uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':payment-preparation',0));
 SELECT * INTO batch FROM payment_batches WHERE tenant_id=NEW.tenant_id AND id=NEW.payment_batch_id FOR UPDATE;
 IF batch.id IS NULL THEN RAISE EXCEPTION 'Payment batch unavailable'; END IF;
 IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.payment_batch_id<>OLD.payment_batch_id) THEN RAISE EXCEPTION 'Payment ownership is immutable'; END IF;
 IF batch.status NOT IN ('draft','assembling','rejected') THEN
  IF TG_OP='INSERT' OR (to_jsonb(NEW)-ARRAY['updated_at','updated_by','status','execution_status','execution_reference','executed_at','executed_by','submitted_at','submitted_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','updated_by','status','execution_status','execution_reference','executed_at','executed_by','submitted_at','submitted_by']) THEN
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
CREATE TRIGGER payment_item_security BEFORE INSERT OR UPDATE ON payment_items FOR EACH ROW EXECUTE FUNCTION enforce_payment_item_security();
CREATE FUNCTION freeze_payment_batch_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':payment-preparation',0));
 IF NEW.tenant_id<>OLD.tenant_id THEN RAISE EXCEPTION 'Payment ownership is immutable'; END IF;
 IF OLD.approval_status='approved' AND ROW(NEW.payment_method,NEW.currency,NEW.batch_type,NEW.total_payment_amount,NEW.item_count,NEW.override_reasons) IS DISTINCT FROM ROW(OLD.payment_method,OLD.currency,OLD.batch_type,OLD.total_payment_amount,OLD.item_count,OLD.override_reasons) THEN
  RAISE EXCEPTION 'Withdraw approval before changing payment instructions';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_batch_approval_security BEFORE UPDATE ON payment_batches FOR EACH ROW EXECUTE FUNCTION freeze_payment_batch_approval();
CREATE TABLE payment_security_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,payment_batch_id uuid NOT NULL,
 source_type text NOT NULL CHECK(source_type IN ('payroll','contractor_payable')),source_id uuid NOT NULL,
 source_snapshot jsonb NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
 requested_by uuid NOT NULL REFERENCES users(id),approved_by uuid REFERENCES users(id),
 approval_note text,expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,payment_batch_id) REFERENCES payment_batches(tenant_id,id),
 CHECK(approved_by IS NULL OR approved_by<>requested_by),
 CHECK(status<>'approved' OR (approved_by IS NOT NULL AND length(approval_note)>=5))
);
ALTER TABLE payment_items ADD COLUMN approved_exception_id uuid;
ALTER TABLE payment_items ADD FOREIGN KEY(tenant_id,approved_exception_id) REFERENCES payment_security_exceptions(tenant_id,id);
INSERT INTO permissions(key,name,description) VALUES ('payment_exception.approve','Approve payment exceptions','Independent finance review; source amount, lineage and duplicate protections never bypassed') ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
 SELECT r.tenant_id,r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE p.key='payment_exception.approve' AND r.deleted_at IS NULL AND (coalesce(r.system_key,'')~*'(finance|accounting|payables)' OR r.name~*'(finance|accounting|payables)')
 AND EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions ap ON ap.id=rp.permission_id WHERE rp.role_id=r.id AND rp.tenant_id=r.tenant_id AND ap.key='payment_batch.approve') ON CONFLICT DO NOTHING;
