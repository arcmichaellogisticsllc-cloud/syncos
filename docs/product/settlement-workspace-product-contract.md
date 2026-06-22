# Settlement Workspace Product Contract

Settlement Workspace is future UI scope. It must expose the hardened Settlement backend without creating invoices, invoice items, AR, payments, cash, payroll, ACH, card payouts, bank transactions, or tax records.

Future routes should include:

- `/settlements`
- `/settlements/new`
- `/settlements/:id`
- `/settlements/:id/edit`

Required sections:

- Settlement Queue
- Settlement Detail
- Billable Source Context
- Settlement Items
- Customer Billable
- Contractor Payable
- Retainage
- Deductions / Chargebacks
- Margin
- Readiness
- Approval
- Invoice Readiness
- Payable Readiness
- Holds & Disputes
- Timeline
- Audit
- Future Invoice placeholder
- Future Payable/Payroll placeholder

The workspace must use backend routes only. It must hide or disable actions based on settlement and settlement item permissions, while leaving backend authorization authoritative.

Ready for invoice and ready for payable are statuses only. They do not create downstream finance records.
