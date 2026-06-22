# Settlement Physical Test

Validate:

- Open Settlement Queue when UI exists.
- Create settlement with type.
- Add settlement item from a `ready_for_settlement` billable item.
- Confirm source billable, QC, production, work order, and project traceability.
- Confirm duplicate active settlement item is blocked unless override is supplied.
- Confirm totals recalculate from active settlement items.
- Confirm retainage, deduction, chargeback, net, contractor payable, and margin values are visible.
- Recalculate readiness.
- Submit review.
- Start review.
- Approve settlement.
- Confirm approval creates no invoice, invoice item, AR, payment, cash, payroll, ACH, card payout, bank transaction, or tax record.
- Mark invoice ready.
- Confirm no invoice is created.
- Mark payable ready.
- Confirm no payment, payroll, or bank transaction is created.
- Place hold with reason.
- Release hold with note.
- Dispute with reason.
- Resolve dispute with note.
- Reject with reason.
- Void settlement item with reason and confirm totals exclude it.
- Void settlement with reason.
- Archive settlement with reason.
- View timeline.
- View audit as authorized user.
- Confirm audit hidden for unauthorized user.
- Confirm future Invoice placeholder only.
- Confirm future Payable/Payroll placeholder only.
