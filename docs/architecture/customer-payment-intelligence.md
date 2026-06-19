# Customer Payment Intelligence

Sprint 8 stores customer payment intelligence in `customer_payment_stats`.

The existing `organizations` table does not include payment intelligence fields. A dedicated tenant-scoped stats table keeps the metrics separate from core organization identity data while supporting the approved Sprint 8 fields:

- `average_days_to_pay`
- `payment_count`
- `short_pay_count`
- `last_payment_at`

Payment reconciliation updates these metrics in the same write-action transaction as the payment reconciliation outcome. No automated collections, payment processor integration, forecasting, or portal behavior is implemented in Sprint 8.
