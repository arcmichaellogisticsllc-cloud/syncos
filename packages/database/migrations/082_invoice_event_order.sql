-- Invoice row locking serializes event insertion. Use insertion order rather than
-- transaction-start timestamps so queued requests cannot reorder audit history.
ALTER TABLE invoice_delivery_events ADD COLUMN event_sequence BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE INDEX invoice_delivery_event_order ON invoice_delivery_events(tenant_id,invoice_id,event_sequence);
