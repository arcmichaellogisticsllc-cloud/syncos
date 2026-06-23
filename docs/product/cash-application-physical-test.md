# Cash Application Physical Test

Use an authorized finance operator and a second unauthorized user.

1. Open `/cash`.
2. Confirm Cash Application appears in main navigation.
3. Confirm receipt summary cards render.
4. Filter receipts by status, method, date range, unapplied cash, archived state, and q search.
5. Open `/cash/receipts/new`.
6. Create a receipt with gross received amount, payment date, and payment method.
7. Confirm the receipt detail page opens.
8. Confirm receipt creation does not change invoice paid amount or balance amount.
9. Confirm receipt creation does not create payment applications.
10. Confirm no payroll, bank, ACH, card payout, tax, accounting export, reconciliation, deposit, refund, collections, processor, contractor payment, or separate AR records are created.
11. Open receipt detail.
12. Confirm the receipt scorecard shows gross, applied, unapplied, application count, invoice count, receipt status, and payment method.
13. Confirm the Overview tab renders receipt details and references.
14. Confirm the Customer tab renders customer context where available.
15. Open the Payment Applications tab.
16. Apply part of the receipt to an invoice ready for cash application.
17. Confirm a payment application is created.
18. Confirm invoice paid amount increases.
19. Confirm invoice balance amount decreases.
20. Confirm partial payment leaves the invoice open.
21. Apply a full payment to another ready invoice.
22. Confirm full payment sets invoice balance to zero and payment status to paid.
23. Create or use a receipt larger than the target invoice balance.
24. Confirm excess remains unapplied cash by default.
25. Apply one receipt to two invoices.
26. Confirm receipt applied amount equals the sum of active applications.
27. Confirm receipt unapplied amount equals gross received minus active applications.
28. Try applying a customer-specific receipt to a different customer invoice.
29. Confirm customer mismatch requires override.
30. Try applying payment to a disputed invoice.
31. Confirm disputed invoice requires override.
32. Open the Invoice Impact tab.
33. Confirm invoice original amount, paid amount, balance amount, payment status, collection status, and cash application status are read-only.
34. Open the Unapplied Cash tab.
35. Confirm unapplied cash remains visible for future application.
36. Open `/payment-applications`.
37. Filter payment applications by receipt, invoice, customer, status, type, date range, archived state, and q search.
38. Open `/payment-applications/:id`.
39. Confirm application, receipt context, invoice context, customer context, before/after balance area, timeline, and audit render.
40. Void a payment application with a reason.
41. Confirm invoice paid and balance values reverse.
42. Confirm receipt applied and unapplied values reverse.
43. Try voiding a receipt with active applications.
44. Confirm void is blocked or disabled.
45. Void all active applications, then void the receipt with a reason.
46. Archive a receipt with a reason.
47. Archive a payment application with a reason.
48. View cash receipt timeline and confirm cash receipt, payment application, and invoice balance events appear.
49. View payment application timeline.
50. View cash receipt audit as an authorized user.
51. View payment application audit as an authorized user.
52. Confirm audit is hidden or replaced with `You do not have permission to view audit details.` for an unauthorized user.
53. Confirm the Collections placeholder only is visible.
54. Confirm the Reconciliation placeholder only is visible.
55. Confirm the Contractor Payables placeholder only is visible.
56. Confirm there is no UI for bank reconciliation, deposits, payroll, contractor payments, ACH/card payouts, tax, accounting export, processor transactions, refunds, collections automation, customer portal, or separate AR records.
