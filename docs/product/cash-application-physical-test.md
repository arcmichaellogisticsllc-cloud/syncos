# Cash Application Physical Test

Use an authorized finance operator and a second unauthorized user.

1. Create or identify an invoice with `cash_application_status = ready_for_cash_application`.
2. Confirm the invoice shows original amount, paid amount, balance amount, payment status, collection status, and cash application status.
3. Create a cash receipt with amount, payment date, payment method, and optional customer/reference fields.
4. Confirm cash receipt creation does not change invoice `paid_amount` or `balance_amount`.
5. Apply part of the receipt to the invoice.
6. Confirm a payment application is created.
7. Confirm invoice `paid_amount` increases and `balance_amount` decreases.
8. Confirm partial payment sets payment status to partially paid and leaves the invoice open.
9. Apply a full payment to another ready invoice.
10. Confirm full payment sets invoice balance to zero, payment status to paid, and collection status to resolved.
11. Create a receipt larger than the invoice balance.
12. Confirm only invoice balance can be applied and excess remains unapplied cash.
13. Apply one receipt to two invoices.
14. Confirm receipt applied amount equals the sum of active applications.
15. Confirm receipt unapplied amount equals gross received minus active applications.
16. Try applying a customer-specific receipt to a different customer invoice.
17. Confirm customer mismatch requires override.
18. Try applying payment to a disputed invoice.
19. Confirm disputed invoice requires override.
20. Void a payment application with a reason.
21. Confirm invoice paid/balance values reverse.
22. Confirm receipt applied/unapplied values reverse.
23. Try voiding a receipt with active applications.
24. Confirm void is blocked.
25. Void all active applications, then void the receipt with a reason.
26. Archive a receipt with a reason.
27. View cash receipt detail and confirm payment applications and invoice context render.
28. View payment application detail and confirm receipt, invoice, and customer context render.
29. View cash receipt timeline and confirm cash receipt, payment application, and invoice balance events appear.
30. View cash receipt audit as an authorized user.
31. Confirm audit is blocked for an unauthorized user.
32. Search by receipt number, payment reference, invoice number, payer, and customer.
33. Confirm no payroll, contractor payment, ACH/card payout, bank transaction, deposit batch, bank reconciliation, tax, accounting export, refund, collections automation, or separate AR records are created.
