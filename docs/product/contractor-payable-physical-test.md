# Contractor Payable Physical Test

Manual validation for Contractor Payable Workspace:

1. Open `/contractor-payables`.
2. Confirm `Contractor Payables` appears in main navigation.
3. Filter payables by status, party, compliance, tax document, hold, dispute, due date, archived state, and search text.
4. Open `/contractor-payables/new`.
5. Create a contractor payable for a capacity provider or crew.
6. Confirm create does not create payment, payroll, bank, tax, accounting, contractor portal, vendor portal, or cash movement records.
7. Open payable detail.
8. Add a payable item from a payable-ready settlement item.
9. Confirm source settlement, settlement item, billable, QC, production, work order, project, provider, and crew traceability is visible.
10. Confirm customer-billable-only settlement items are rejected unless an override is supplied.
11. Confirm duplicate active settlement item consumption is blocked unless an override is supplied.
12. Recalculate totals.
13. View payable party.
14. View provider/crew context.
15. View settlement context.
16. View project context.
17. View financial summary.
18. View compliance/tax readiness.
19. View retainage.
20. View deductions/chargebacks.
21. Submit review.
22. Start review.
23. Approve.
24. Mark payment ready.
25. Confirm no payment, payroll, ACH/card payout, check, bank transaction, tax filing, accounting export, contractor portal, vendor portal, or cash movement record is created.
26. Place hold.
27. Release hold.
28. Open dispute.
29. Resolve dispute.
30. Void payable item with reason.
31. Archive payable item with reason.
32. Reject payable with reason.
33. Void payable with reason.
34. Archive payable with reason.
35. View timeline.
36. View audit as an authorized user.
37. Confirm audit is hidden from unauthorized users.
38. Confirm Payment placeholder only.
39. Confirm Payroll placeholder only.
40. Confirm Bank / Accounting placeholder only.
