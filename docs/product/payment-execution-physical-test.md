# Payment Execution Physical Test

Backend foundation validation:

- Run `npm run payment-execution:smoke`.
- Confirm unauthorized requests are blocked.
- Confirm missing permission requests are blocked.
- Confirm cross-tenant access is blocked.
- Create a payment batch.
- Confirm payment batch number is tenant-unique.
- Confirm invalid batch type is rejected.
- Confirm invalid payment method is rejected.
- Confirm `mixed_later` is blocked without override.
- Add a payment-ready contractor payable.
- Confirm a non-ready contractor payable is rejected.
- Confirm duplicate source payment items are blocked without override.
- Add a payroll-ready payroll item.
- Confirm whole payroll run intake without `payroll_item_id` is blocked in the first implementation.
- Recalculate totals.
- Submit review.
- Start review.
- Approve.
- Schedule.
- Submit execution.
- Confirm submit execution creates status only.
- Mark executed.
- Confirm mark executed creates status only.
- Mark failed.
- Cancel.
- Void.
- Archive.
- Void and archive payment items.
- Confirm list/detail endpoints return enriched fields and boundary summary.
- Confirm timeline returns payment batch and item events.
- Confirm audit endpoint enforces `payment_batch.audit.read`.
- Confirm search includes payment batches and payment items.
- Confirm no ACH, card payout, check, wire, bank transaction, payroll provider submission, tax filing, W2, 1099, benefit, garnishment, accounting export, bank reconciliation, portal, or real money movement records are created.
