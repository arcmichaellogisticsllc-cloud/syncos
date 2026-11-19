-- Keep the payable header aligned with its reviewed schedule after partial payments.
-- This does not allocate bank transactions to installments or rewrite historical snapshots.
CREATE FUNCTION refresh_paid_installment_due() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE schedule JSONB;
BEGIN
 SELECT installments INTO schedule FROM contractor_payable_eligibility_snapshots
 WHERE tenant_id=NEW.tenant_id AND contractor_payable_id=NEW.id AND source_fingerprint IS NOT NULL
 ORDER BY calculation_version DESC LIMIT 1;
 IF schedule IS NOT NULL THEN
  SELECT due_date INTO NEW.payment_due_at FROM (
   SELECT (item->>'due_date')::date AS due_date,
    sum((item->>'amount')::numeric) OVER(ORDER BY item->>'due_at',item->>'allocation_id',ordinal ROWS UNBOUNDED PRECEDING) AS cumulative,
    row_number() OVER(ORDER BY item->>'due_at',item->>'allocation_id',ordinal) AS position
   FROM jsonb_array_elements(schedule) WITH ORDINALITY AS entries(item,ordinal)
  ) amounts WHERE cumulative>COALESCE(NEW.paid_amount,0) ORDER BY position LIMIT 1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payable_paid_due BEFORE UPDATE OF paid_amount ON contractor_payables
 FOR EACH ROW WHEN(OLD.paid_amount IS DISTINCT FROM NEW.paid_amount) EXECUTE FUNCTION refresh_paid_installment_due();
