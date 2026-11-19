-- Preserve a client request key when cleared cash is applied to an invoice.
ALTER TABLE payment_applications ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS payment_applications_idempotency_uidx
ON payment_applications(tenant_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
