# Invoice Physical Test

1. Create invoice from invoice-ready settlement context.
2. Confirm no `ar_records`, payments, cash receipts, payroll, tax, bank, ACH, card payout, or accounting export records are created.
3. Add invoice item from invoice-ready settlement item.
4. Confirm contractor payable settlement item cannot become customer invoice item.
5. Confirm duplicate settlement item is blocked without override.
6. Recalculate invoice totals.
7. Submit invoice for review.
8. Approve invoice and confirm `original_amount`, `paid_amount`, `balance_amount`, `payment_status`, and `collection_status`.
9. Mark invoice sent.
10. Mark invoice ready for cash application and confirm no cash/payment records are created.
11. Confirm legacy submit route creates no `ar_records`.
12. Dispute and resolve invoice.
13. Void invoice item.
14. Void invoice.
15. Archive invoice.
16. View timeline as authorized user.
17. View audit as authorized user.
18. Confirm audit is denied without permission.
19. Confirm search includes invoices and invoice items.
