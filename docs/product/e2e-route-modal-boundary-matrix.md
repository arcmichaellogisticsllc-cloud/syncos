# E2E Route, Modal, And Boundary Matrix

## Route Coverage Matrix

Rules:

* `must-test` routes are required for E2E certification.
* ID routes must use seeded records. Placeholder UUID route-load checks are not enough for certification.
* Screenshot required means at least one certification artifact must capture the route in a stable state.

| Route group | Route | Persona | Seeded object required | Expected heading | Primary CTA | Status | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Growth | `/intelligence` | Growth Operator | No | Intelligence | Signal navigation | must-test | No |
| Growth | `/intelligence/signals` | Growth Operator | Optional | Signal Feed | Create Signal | must-test | Yes |
| Growth | `/intelligence/signals/:id` | Growth Operator | Signal | Signal detail | Add Evidence / Verify | must-test | Yes |
| Growth | `/intelligence/organizations` | Growth Operator | Optional | Organizations | Create Organization | must-test | Yes |
| Growth | `/intelligence/organizations/new` | Growth Operator | No | Organization | Save/Create | must-test | Yes |
| Growth | `/intelligence/organizations/:id` | Growth Operator | Organization | Organization detail | Qualify / Edit | must-test | Yes |
| Growth | `/intelligence/organizations/:id/edit` | Growth Operator | Organization | Edit Organization | Save | must-test | No |
| Growth | `/intelligence/contacts` | Growth Operator | Optional | Contacts | Create Contact | must-test | Yes |
| Growth | `/intelligence/contacts/new` | Growth Operator | Organization | Contact | Save/Create | must-test | Yes |
| Growth | `/intelligence/contacts/:id` | Growth Operator | Contact | Contact detail | Verify / Assign | must-test | Yes |
| Growth | `/intelligence/contacts/:id/edit` | Growth Operator | Contact | Edit Contact | Save | must-test | No |
| Growth | `/intelligence/relationship-maps` | Growth Operator | Optional | Relationship Maps | Create Relationship Map | must-test | Yes |
| Growth | `/intelligence/relationship-maps/new` | Growth Operator | Organization/Contact | Relationship Map | Save/Create | must-test | Yes |
| Growth | `/intelligence/relationship-maps/:id` | Growth Operator | Relationship Map | Relationship Map detail | Add Path | must-test | Yes |
| Growth | `/intelligence/relationship-maps/:id/edit` | Growth Operator | Relationship Map | Edit Relationship Map | Save | must-test | No |
| Opportunity | `/opportunities` | Growth Operator | No | Opportunities | Pipeline navigation | must-test | No |
| Opportunity | `/opportunities/candidates` | Growth Operator | Optional | Candidates | Create Candidate | must-test | Yes |
| Opportunity | `/opportunities/candidates/new` | Growth Operator | Signal/Organization | Candidate | Save/Create | must-test | Yes |
| Opportunity | `/opportunities/candidates/:id` | Growth Operator | Candidate | Candidate detail | Qualify / Convert | must-test | Yes |
| Opportunity | `/opportunities/candidates/:id/edit` | Growth Operator | Candidate | Edit Candidate | Save | must-test | No |
| Opportunity | `/opportunities/pipeline` | Growth Operator | Optional | Pipeline | Create Opportunity | must-test | Yes |
| Opportunity | `/opportunities/new` | Growth Operator | Candidate/Organization | Opportunity | Save/Create | must-test | Yes |
| Opportunity | `/opportunities/:id` | Growth Operator | Opportunity | Opportunity detail | Submit / Approve | must-test | Yes |
| Opportunity | `/opportunities/:id/edit` | Growth Operator | Opportunity | Edit Opportunity | Save | must-test | No |
| Coverage | `/opportunities/coverage` | Ops Manager | Optional | Coverage | Create Coverage Plan | must-test | Yes |
| Coverage | `/opportunities/coverage/new` | Ops Manager | Opportunity | Coverage Plan | Save/Create | must-test | Yes |
| Coverage | `/opportunities/coverage/:id` | Ops Manager | Coverage Plan | Coverage Plan detail | Add Requirement / Approve | must-test | Yes |
| Coverage | `/opportunities/coverage/:id/edit` | Ops Manager | Coverage Plan | Edit Coverage Plan | Save | must-test | No |
| Execution | `/projects` | Ops Manager | Optional | Projects | Open Project | must-test | Yes |
| Execution | `/projects/:id` | Ops Manager | Project | Project detail | Recalculate / Start | must-test | Yes |
| Execution | `/projects/:id/edit` | Ops Manager | Project | Edit Project | Save | must-test | No |
| Execution | `/work-orders` | Ops Manager | Optional | Work Orders | Create Work Order | must-test | Yes |
| Execution | `/work-orders/new` | Ops Manager | Project | Work Order | Save/Create | must-test | Yes |
| Execution | `/work-orders/:id` | Ops Manager | Work Order | Work Order detail | Assign / Schedule / Start | must-test | Yes |
| Execution | `/work-orders/:id/edit` | Ops Manager | Work Order | Edit Work Order | Save | must-test | No |
| Execution | `/production` | Field Supervisor | Optional | Production | Create Production | must-test | Yes |
| Execution | `/production/new` | Field Supervisor | Work Order | Production | Save/Create | must-test | Yes |
| Execution | `/production/:id` | Field Supervisor/QC Reviewer | Production | Production detail | Submit / Review / Approve | must-test | Yes |
| Execution | `/production/:id/edit` | Field Supervisor | Production | Edit Production | Save | must-test | No |
| Execution | `/qc` | QC Reviewer | Optional | QC | Create QC Review | must-test | Yes |
| Execution | `/qc/new` | QC Reviewer | Production | QC Review | Save/Create | must-test | Yes |
| Execution | `/qc/:id` | QC Reviewer | QC Review | QC detail | Start / Approve / Reject | must-test | Yes |
| Execution | `/qc/:id/edit` | QC Reviewer | QC Review | Edit QC Review | Save | must-test | No |
| Revenue | `/billable` | Finance User | Optional | Billable | Create Billable Item | must-test | Yes |
| Revenue | `/billable/new` | Finance User | QC/Production | Billable Item | Save/Create | must-test | Yes |
| Revenue | `/billable/:id` | Finance User | Billable Item | Billable detail | Mark Ready | must-test | Yes |
| Revenue | `/billable/:id/edit` | Finance User | Billable Item | Edit Billable | Save | must-test | No |
| Revenue | `/settlements` | Finance User | Optional | Settlements | Create Settlement | must-test | Yes |
| Revenue | `/settlements/new` | Finance User | Billable Item | Settlement | Save/Create | must-test | Yes |
| Revenue | `/settlements/:id` | Finance User | Settlement | Settlement detail | Add Item / Approve | must-test | Yes |
| Revenue | `/settlements/:id/edit` | Finance User | Settlement | Edit Settlement | Save | must-test | No |
| Revenue | `/invoices` | Finance User | Optional | Invoices | Create Invoice | must-test | Yes |
| Revenue | `/invoices/new` | Finance User | Settlement | Invoice | Save/Create | must-test | Yes |
| Revenue | `/invoices/:id` | Finance User | Invoice | Invoice detail | Add Item / Approve / Send | must-test | Yes |
| Revenue | `/invoices/:id/edit` | Finance User | Invoice | Edit Invoice | Save | must-test | No |
| Revenue | `/cash` | Finance User | Optional | Cash | Create Cash Receipt | must-test | Yes |
| Revenue | `/cash/receipts/new` | Finance User | Invoice | Cash Receipt | Save/Create | must-test | Yes |
| Revenue | `/cash/receipts/:id` | Finance User | Cash Receipt | Cash Receipt detail | Apply To Invoice | must-test | Yes |
| Revenue | `/cash/receipts/:id/edit` | Finance User | Cash Receipt | Edit Cash Receipt | Save | must-test | No |
| Revenue | `/payment-applications` | Finance User | Payment Application | Payment Applications | Open Application | must-test | Yes |
| Revenue | `/payment-applications/:id` | Finance User | Payment Application | Payment Application detail | Void / Archive | must-test | Yes |
| Revenue | `/collections` | Collections Specialist | Optional | Collections | Create Collection Case | must-test | Yes |
| Revenue | `/collections/new` | Collections Specialist | Invoice | Collection Case | Save/Create | must-test | Yes |
| Revenue | `/collections/:id` | Collections Specialist | Collection Case | Collection detail | Add Action / Close | must-test | Yes |
| Revenue | `/collections/:id/edit` | Collections Specialist | Collection Case | Edit Collection | Save | must-test | No |
| Revenue | `/collection-actions` | Collections Specialist | Collection Action | Collection Actions | Open Action | must-test | Yes |
| Revenue | `/collection-actions/:id` | Collections Specialist | Collection Action | Action detail | Complete / Cancel | must-test | Yes |
| Cost/Labor | `/contractor-payables` | Payables Admin | Optional | Contractor Payables | Create Payable | must-test | Yes |
| Cost/Labor | `/contractor-payables/new` | Payables Admin | Settlement | Contractor Payable | Save/Create | must-test | Yes |
| Cost/Labor | `/contractor-payables/:id` | Payables Admin | Contractor Payable | Payable detail | Add Item / Approve | must-test | Yes |
| Cost/Labor | `/contractor-payables/:id/edit` | Payables Admin | Contractor Payable | Edit Payable | Save | must-test | No |
| Cost/Labor | `/payroll` | Payables Admin | Optional | Payroll | Create Payroll Run | must-test | Yes |
| Cost/Labor | `/payroll/new` | Payables Admin | Worker | Payroll Run | Save/Create | must-test | Yes |
| Cost/Labor | `/payroll/:id` | Payables Admin | Payroll Run | Payroll detail | Add Item / Approve | must-test | Yes |
| Cost/Labor | `/payroll/:id/edit` | Payables Admin | Payroll Run | Edit Payroll | Save | must-test | No |
| Payment | `/payments` | Payables Admin | Optional | Payments | Create Payment Batch | must-test | Yes |
| Payment | `/payments/new` | Payables Admin | Payable/Payroll | Payment Batch | Save/Create | must-test | Yes |
| Payment | `/payments/:id` | Payables Admin | Payment Batch | Payment Batch detail | Add Item / Schedule / Submit | must-test | Yes |
| Payment | `/payments/:id/edit` | Payables Admin | Payment Batch | Edit Payment Batch | Save | must-test | No |
| Payment | `/payment-items/:id` | Payables Admin | Payment Item | Payment Item detail | Edit / Void / Archive | must-test | Yes |
| Verification | `/bank-reconciliation` | Accounting Manager | Optional | Bank Reconciliation | Create Account / Transaction | must-test | Yes |
| Verification | `/bank-reconciliation/accounts/new` | Accounting Manager | No | Bank Account | Save/Create | must-test | Yes |
| Verification | `/bank-reconciliation/accounts/:id` | Accounting Manager | Bank Account | Bank Account detail | Edit / Archive | must-test | Yes |
| Verification | `/bank-reconciliation/accounts/:id/edit` | Accounting Manager | Bank Account | Edit Bank Account | Save | must-test | No |
| Verification | `/bank-reconciliation/transactions/new` | Accounting Manager | Bank Account | Bank Transaction | Save/Create | must-test | Yes |
| Verification | `/bank-reconciliation/transactions/:id` | Accounting Manager | Bank Transaction | Bank Transaction detail | Match / Exception | must-test | Yes |
| Verification | `/bank-reconciliation/transactions/:id/edit` | Accounting Manager | Bank Transaction | Edit Bank Transaction | Save | must-test | No |
| Verification | `/reconciliation-matches/:id` | Accounting Manager | Reconciliation Match | Reconciliation Match detail | Review / Approve / Reject | must-test | Yes |
| Accounting | `/accounting-exports` | Accounting Manager | Optional | Accounting Exports | Create Export Batch | must-test | Yes |
| Accounting | `/accounting-exports/new` | Accounting Manager | Source objects | Accounting Export | Save/Create | must-test | Yes |
| Accounting | `/accounting-exports/:id` | Accounting Manager | Export Batch | Export Batch detail | Add Item / Generate / Approve | must-test | Yes |
| Accounting | `/accounting-exports/:id/edit` | Accounting Manager | Export Batch | Edit Export Batch | Save | must-test | No |
| Accounting | `/accounting-export-items/:id` | Accounting Manager | Export Item | Export Item detail | Edit / Archive | must-test | Yes |

## Modal Coverage Matrix

Each modal/action must be tested with success and failure assertions. Backend routes listed here are expected routes from existing contracts; exact request bodies must be confirmed during future implementation.

| Area | Modal/action | Route context | Persona | Required fields | Backend route expected | Success assertion | Failure assertion | Forbidden assertion | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Growth | Create Signal | `/intelligence/signals` | Growth Operator | title/source/type | `POST /signals` | signal appears in list/detail | missing required rejected | no opportunity/project/finance created | Yes |
| Growth | Add Signal Evidence | signal detail | Growth Operator | evidence/source | `POST /signals/:id/evidence` | evidence row appears | missing evidence rejected | no candidate auto-created | Yes |
| Growth | Verify Signal | signal detail | Growth Operator | evidence exists | `POST /signals/:id/verify` | status verified, timeline event | verify blocked without evidence | no opportunity/project auto-created | Yes |
| Growth | Archive Signal | signal detail | Growth Operator | archive_reason | `POST /signals/:id/archive` | status archived | missing reason rejected | no source deletion | Yes |
| Growth | Create Candidate from Signal | signal detail | Growth Operator | opportunity name if required | `POST /signals/:id/create-candidate` | candidate linked | invalid signal rejected | no opportunity unless conversion action | Yes |
| Growth | Create Organization | organizations | Growth Operator | name/type | `POST /organizations` | organization appears | invalid required fields rejected | no contact auto-created | Yes |
| Growth | Assign/Qualify/Archive Organization | organization detail | Growth Operator | owner/reason as applicable | `/organizations/:id/*` | status/owner changes | missing reason/user rejected | no opportunity auto-created | Yes |
| Growth | Create/Verify/Assign/Status Contact | contact routes | Growth Operator | contact fields/reasons | `/contacts*` | contact lifecycle updates | missing reason rejected | no relationship map auto-created | Yes |
| Growth | Create Relationship Map/Path/Rank/Archive | relationship map routes | Growth Operator | map/path fields/reason | `/relationship-maps*`, `/relationship-paths*` | path/map updates | invalid/missing rejected | no opportunity auto-created | Yes |
| Opportunity | Candidate lifecycle | candidate routes | Growth Operator | action-specific reason/note | `/opportunity-candidates/:id/*` | status changes, timeline event | missing reason rejected | no project/finance created | Yes |
| Opportunity | Convert Candidate | candidate detail | Growth Operator | opportunity name | `POST /opportunity-candidates/:id/convert-to-opportunity` | opportunity created | unqualified/duplicate rejected unless override | no coverage/project auto-created | Yes |
| Opportunity | Opportunity lifecycle | opportunity routes | Growth Operator | review/approval/reason fields | `/opportunities/:id/*` | status changes | missing reason rejected | no project/work/finance auto-created | Yes |
| Coverage | Coverage plan and child records | coverage routes | Ops Manager | requirement/source/gap fields | `/coverage-plans*`, `/coverage-gaps*` | plan readiness updates | unresolved blocker rejected | no project until handoff create-project | Yes |
| Project | Project lifecycle | project detail | Ops Manager | reason/note as applicable | `/projects/:id/*` | status/readiness changes | blockers enforced | no work order auto-created | Yes |
| Work Order | Work order lifecycle | work order detail | Ops Manager | assignment/schedule/reasons | `/work-orders/:id/*` | status changes | missing reason rejected | no production/finance auto-created | Yes |
| Production | Production/evidence lifecycle | production detail | Field Supervisor | quantities/evidence/reasons | `/production*` | production status/quantities update | invalid quantity rejected | no settlement/invoice/payment/payroll/bank | Yes |
| QC | QC lifecycle | QC detail | QC Reviewer | review/reason fields | `/qc*` or `qc_review` routes | QC status changes | missing reason rejected | no settlement/invoice/payment/payroll | Yes |
| Revenue | Billable lifecycle | billable detail | Finance User | readiness/reasons | `/billable-items*` | ready/hold/dispute states | missing reason rejected | no settlement/invoice/payment/payroll | Yes |
| Revenue | Settlement lifecycle/items | settlement detail | Finance User | item/review/reasons | `/settlements*`, `/settlement-items*` | totals/status update | missing reason rejected | no invoice/payment/payroll/cash/bank | Yes |
| Revenue | Invoice lifecycle/items | invoice detail | Finance User | item/review/send/reasons | `/invoices*`, `/invoice-items*` | totals/status update | missing reason rejected | no cash/payment/bank/payroll/tax | Yes |
| Revenue | Cash receipt/apply | cash receipt detail | Finance User | receipt/apply amount | `/cash-receipts*` | payment application created by apply only | overapply rejected | no payroll/payable/bank/accounting/tax | Yes |
| Revenue | Collections case/action | collection routes | Collections Specialist | owner/action/reason | `/collection-cases*`, `/collection-actions*` | action/case status updates | missing reason rejected | no cash receipt/payment application/balance mutation | Yes |
| Cost | Contractor payable lifecycle/items | payable detail | Payables Admin | item/review/reasons | `/contractor-payables*` | payable status/totals update | missing reason rejected | no payment/ACH/check/card/bank/payroll/tax | Yes |
| Labor | Payroll lifecycle/items | payroll detail | Payables Admin | item/review/reasons | `/payroll-runs*`, `/payroll-items*` | payroll status/totals update | missing reason rejected | no payment/provider/tax/W2/1099 | Yes |
| Payment | Payment batch/item lifecycle | payment detail | Payables Admin | item/review/schedule/refs/reasons | `/payment-batches*`, `/payment-items*` | status-only execution updates | missing required rejected | no ACH/check/wire/card/provider/bank/tax/accounting | Yes |
| Bank | Bank account/transaction/match | bank reconciliation routes | Accounting Manager | masked account/transaction/match fields | `/bank-accounts*`, `/bank-transactions*`, `/reconciliation-matches*` | match/status updates | wrong direction/reason rejected | no feed/import/payment/cash/invoice/accounting/tax | Yes |
| Accounting | Accounting export lifecycle/items | accounting export routes | Accounting Manager | item/mapping/status/reasons | `/accounting-export-batches*`, `/accounting-export-items*` | status-only export updates | mapping/reason rejection shown | no QuickBooks/ERP/GL/journal/tax/payment/bank/source mutation | Yes |

## Forbidden Downstream Creation Matrix

Tests must capture object/table counts before and after each browser action. Only intended object counts may change.

| Workspace | Must not create |
| --- | --- |
| Work Order | production records, QC evidence, settlement, invoice, payment, payroll |
| Production | settlement, invoice, payment, payroll, tax, bank transaction |
| QC | settlement, invoice, payment, payroll |
| Billable | settlement, invoice, payment, payroll |
| Settlement | invoice, payment, payroll, cash, bank transaction |
| Invoice | separate AR object, cash receipt, payment, bank transaction, payroll, tax |
| Cash Application | payroll, contractor payment, bank reconciliation, accounting export, tax |
| Collections | cash receipt, payment application, invoice balance mutation, legal filing, accounting export, tax |
| Contractor Payable | payment, ACH, card payout, check, bank transaction, payroll, tax |
| Payroll | payment, ACH, card payout, check, bank transaction, payroll provider submission, tax filing, W2, 1099 |
| Payment Execution | ACH, check, wire, card payout, payroll provider submission, bank transaction, tax, accounting export |
| Bank Reconciliation | bank feed, statement import, processor import, payment execution, cash receipt, payment application, invoice balance mutation, accounting export, tax |
| Accounting Export | QuickBooks API call, ERP API call, GL entry, journal, tax filing, payment, bank transaction, accounting close, source record mutation |

## Suggested Boundary Assertion Helper

Future implementation should provide a test helper that:

1. Captures relevant counts and source field snapshots.
2. Performs the browser action.
3. Captures counts and snapshots again.
4. Asserts intended object changes.
5. Asserts forbidden object counts are unchanged.
6. Asserts protected source fields are unchanged unless the action explicitly allows mutation.

Open confirmation: use direct DB helpers in CI unless product requires read-only API count endpoints.
