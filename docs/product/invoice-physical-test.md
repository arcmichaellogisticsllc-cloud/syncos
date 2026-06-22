# Invoice Physical Test

Use an authorized operator and a second unauthorized user.

1. Open `/invoices`.
2. Confirm the Invoice Queue renders summary cards, filters, quick filters, sorting controls, and the invoice table.
3. Filter by status, approval status, delivery status, cash application status, payment status, collection status, customer, project, settlement, invoice date, due date, payment terms, balance, overdue, archived, and search text.
4. Confirm quick filters for Draft, Ready For Review, Approved, Sent, Disputed, Ready For Cash Application, Unpaid, Partially Paid, Paid Later, Not Due, Due, Overdue, and Balance Outstanding.
5. Open `/invoices/new`.
6. Create an invoice with a customer organization and optional settlement/project/date/terms/currency fields.
7. Confirm invoice creation creates no cash receipt, payment, payroll, tax, ACH, card payout, bank transaction, accounting export, or separate AR record.
8. Open the created invoice detail.
9. Confirm the demand-for-payment scorecard is visible.
10. Confirm the header shows invoice number, type, status, approval, delivery, cash application, payment, collection, customer, project, settlement, dates, terms, total, original, paid, balance, aging, currency, and recommended next action.
11. Add an invoice item from an invoice-ready settlement item.
12. Confirm contractor payable settlement items cannot be invoiced to the customer.
13. Confirm duplicate settlement items are blocked unless the backend accepts an override.
14. Confirm no cash/payment/payroll/tax/bank/ACH/card/accounting records are created by item add.
15. View the Invoice Items tab and confirm item traceability to settlement, project, work order, production, and QC.
16. Void an invoice item with a reason.
17. Archive an invoice item with a reason.
18. View Customer tab.
19. View Settlement tab.
20. View Project tab.
21. View Financial Summary tab and confirm subtotal, retainage, adjustment, tax, fee, total, original, paid, balance, and currency.
22. View Receivable State tab and confirm original amount, paid amount, balance amount, aging days, payment status, collection status, and cash application status.
23. Submit invoice for review.
24. Approve invoice with an approval note.
25. Confirm original amount, paid amount, balance amount, payment status, and collection status are visible.
26. Confirm approval creates no separate AR record.
27. Mark invoice sent with a sent note.
28. Confirm Mark Sent creates no cash/payment/bank/payroll/tax records.
29. Mark invoice ready for cash application with a ready note.
30. Confirm Ready For Cash Application creates no cash receipt, payment, bank transaction, ACH, card payout, payroll, tax, or accounting export record.
31. Dispute invoice with a reason.
32. Resolve dispute with a resolution note.
33. Reject an invoice with a reason in an eligible state.
34. Void invoice with a reason.
35. Archive invoice with a reason.
36. Open Timeline tab and confirm invoice and invoice item events appear.
37. Open Audit tab as an authorized user and confirm audit entries render.
38. Open Audit tab as an unauthorized user and confirm audit payloads are hidden.
39. Confirm Future Cash Application placeholder appears and contains no payment/cash button.
40. Confirm Future Collections placeholder appears and contains no collections automation button.
41. Confirm `/invoices/:id/edit` exposes only backend-supported editable fields and does not bypass lifecycle actions.
42. Confirm voided/archived invoices are read-only.
43. Confirm sent/paid-later/fully-applied-later invoices are read-only unless backend explicitly allows limited updates.
