# Operator Button And Action Registry

## Registry Standards

Every operator action must define:

- Button label.
- Route/page.
- Object type.
- Persona.
- Permission required.
- Appears when.
- Disabled when.
- Disabled explanation.
- Style: primary, secondary, danger, ghost, utility.
- Opens modal yes/no.
- Modal title.
- Required fields.
- Backend action.
- Success state.
- Timeline event.
- Audit event.
- Downstream boundary rule.
- E2E test coverage.
- UX priority.

Certified action-state coverage currently includes readiness, modal open/cancel, no forbidden downstream mutation, persona visibility/denial, submit mutation, and release gate coverage.

## Common Coverage References

| Coverage | Meaning |
|---|---|
| Readiness | `tests/e2e/action-states/action-state-readiness.spec.ts` |
| Modal | `tests/e2e/action-states/action-state-modals.spec.ts` |
| Boundary | `tests/e2e/action-states/action-state-boundaries.spec.ts` |
| Persona | `tests/e2e/action-states/action-state-personas.spec.ts` |
| Submit | `tests/e2e/action-states/action-state-submit.spec.ts` |
| Release | `npm run e2e:ci:release`, 576 passed at last local gate |

## Intelligence

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Create Signal | `/intelligence/signals` | Signal | Growth Operator, `signal.create` | Signal feed visible. | Missing create permission: "Your role can review signals but cannot create them." | Primary, modal, requires title/source/category basics. | `POST /signals` | Signal created, timeline/audit create expected; no opportunity created. E2E route only today. | P0 |
| Review Next Signal | Proposed `/intelligence/signals` | Signal | Growth Operator, `signal.read` | Needs Review queue has records. | No records: "No signals need review." | Primary, no modal, opens next detail. | Navigation only. | No mutation. Needs E2E. | P0 |
| Assign Owners | Proposed `/intelligence/signals` | Signals | Growth Operator, `signal.update` or owner permission future | Unassigned signals exist. | No permission or no selected signals. | Secondary, modal, owner required. | Future update route. | Audit owner assignment; no candidate creation. Not implemented. | P1 |
| Convert Ready Signals | Proposed `/intelligence/signals` | Signals | Growth Operator, candidate create permission future | Ready signals selected. | Missing org/evidence/confidence: "Signal is not candidate-ready." | Primary, modal, selected signals required. | Future candidate creation. | Candidate created only after explicit submit. Not implemented. | P1 |
| Categorize | `/intelligence/signals` row | Signal | Growth Operator, `signal.categorize` | Signal not archived. | Archived or missing permission. | Secondary, no current modal. | `/signals/:id/categorize` | Status advances to categorized; no downstream object. E2E route only. | P1 |
| Score | `/intelligence/signals` row | Signal | Growth Operator, `signal.score` | Signal not archived. | Archived or missing permission. | Secondary, no current modal. | `/signals/:id/score` | Confidence updated; audit expected. E2E route only. | P1 |
| Verify | `/intelligence/signals` row | Signal | Growth Operator, `signal.verify` | Evidence exists and signal not archived. | Missing evidence: "Add evidence before verifying." | Primary, no current modal. | `/signals/:id/verify` | Status verified; no candidate unless future conversion. E2E route only. | P1 |
| Archive | `/intelligence/signals` row/detail | Signal | Growth Operator/Admin, `signal.archive` | Signal not archived. | Already archived or missing permission. | Danger, should open modal, archive reason future. | `/signals/:id/archive` | Status archived; audit expected; no deletion. Needs modal E2E. | P1 |

## Opportunity

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Create Candidate | `/opportunities/candidates` | Candidate | Growth Operator | User can create candidate. | Missing permission. | Primary, modal/page, organization/signal/scope. | Existing create route. | Candidate created; no opportunity until explicit conversion. Route E2E. | P1 |
| Create Opportunity | `/opportunities` | Opportunity | Growth Operator | User can create opportunity. | Missing permission or required customer missing. | Primary, create page. | Existing create route. | Opportunity created; no project handoff. Route E2E. | P1 |
| Submit Review | `/opportunities/[id]` future | Opportunity | Growth Operator | Draft opportunity. | Missing required scope/amount/owner. | Primary, modal, submit note. | Existing/future opportunity submit route per product contract. | Review state, audit/timeline. Not action-state certified. | P2 |
| Start Coverage | `/opportunities/[id]` future | Coverage | Ops Manager | Opportunity approved/ready. | Opportunity not ready. | Secondary, modal/page. | Coverage create route. | Coverage plan created only after explicit submit. Route E2E. | P2 |

## Project / Work Order

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Create Work Order | `/work-orders`, `/projects/[id]` | Work order | Ops Manager | Project active. | Project not active or missing permission. | Primary, create page, scope/due date/crew. | Existing create route. | Work order created; no production record. Route E2E. | P0 |
| Open Detail | All lists | Any | Read permission | Row visible. | Not disabled. | Ghost, no modal. | Navigation. | No mutation. Route E2E. | P0 |
| Create Production | `/work-orders/[id]` future | Production | Field Supervisor | Work order active/ready. | Work order closed/blocked. | Primary, create page. | Production create route. | Production draft created; no billing. Route E2E. | P0 |

Phase 4 list-page notes:

- `/work-orders` now exposes queue actions only: Create Work Order, Open Next Blocked Work Order, Review Active Work, queue tab selection, and Open Detail.
- Work Order lifecycle mutations remain on `/work-orders/[id]` through existing backend-backed modals.
- Production Missing is informational until a backend work-order-to-production coverage summary exists.

## Production

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success state/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Submit | `/production/[id]` | Production | Field Supervisor/Admin, `production.submit` | Status `draft`. | Missing submission note or permission. | Primary, modal "Submit", requires Submission Note/Submit Note. | Submit production. | `status=submitted`; timeline submit; audit mutation; must not create settlements, invoices, payment batches, payroll runs, bank transactions, accounting export batches. Certified. | P0 |
| Start Review | `/production/[id]` | Production | QC Manager, review permission | Status `submitted`. | Already in review, missing permission. | Primary, modal "Start Review", no required fields. | Start review. | `status=under_review`; timeline/audit. Certified. | P0 |
| Approve | `/production/[id]` | Production | QC Manager | Status `under_review`. | Missing approved quantity/note, permission. | Primary, modal "Approve", Approved Quantity/Approval Note. | Approve production. | `status=approved`; no downstream finance object. Certified. | P0 |
| Mark Corrected | `/production/[id]` | Production | QC Manager/Field Supervisor policy | Status `correction_required`. | Missing correction note. | Primary, modal "Corrected", Correction Note. | Mark corrected. | `status=corrected`; audit/timeline. Certified. | P0 |
| Mark Billable | `/production/[id]` | Production | QC Manager/Finance policy | Status `approved` and not billable. | Already billable or missing permission. | Primary, modal "Billable", no required fields. | Mark billable. | `billable_status=billable`; no invoice/payment/payroll/bank/export creation. Certified. | P0 |
| Archive | `/production/[id]` | Production | System Admin | Status `voided`. | Not voided or missing permission. | Danger, modal "Archive". | Archive production. | `status=archived`; audit/timeline. Certified. | P0 |

Phase 4 list-page notes:

- `/production` now exposes queue actions only: Create Production Record, Review Submitted Production, Open Corrections, Mark Approved Billable queue, queue tab selection, and Open Detail.
- Submit, Start Review, Approve, Request Correction, Mark Corrected, Mark Billable, Void, Archive, and Evidence actions remain on `/production/[id]`.
- List-page Billable Ready copy explicitly says no invoice or finance record is created.

## QC

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Start Review | `/qc/[id]` | QC review | QC Manager | Status `pending`. | Already in review or missing permission. | Primary, modal "Start Review". | Start QC review. | `review_status=in_review`; no finance downstream. Certified. | P0 |
| Approve | `/qc/[id]` | QC review | QC Manager | Status `in_review`. | Missing review/approval note or permission. | Primary, modal "Approve", Review Note/Approval Note. | Approve QC. | `review_status=approved`; no finance downstream. Certified. | P0 |
| Mark Corrected | `/qc/[id]` | QC review | QC Manager | Status `correction_required`. | Missing correction note. | Primary, modal "Mark Corrected", Correction Note. | Mark corrected. | `review_status=corrected`; audit/timeline. Certified. | P0 |
| Archive | `/qc/[id]` | QC review | System Admin | Status `voided`. | Not voided or missing permission. | Danger, modal "Archive". | Archive QC. | `review_status=archived`; no settlement/invoice/payment/payroll/export. Certified. | P0 |

Phase 4 list-page notes:

- `/qc` now exposes queue actions only: Create QC Review, Review Next QC Item, Open Corrections, View Aging Reviews, queue tab selection, and Open Detail.
- Start Review, Approve, Reject, Request Correction, Mark Corrected, Void, and Archive remain on `/qc/[id]`.
- Aging is client-side display guidance until explicit SLA fields exist.

## Billable

Phase 5 list-page notes:

- `/billable` now exposes queue actions only: Review Next Billable Item, Open Holds, Open Disputes, Create Billable Candidate, queue tab selection, and Open Detail.
- Recalculate Readiness, Release Hold, Resolve Dispute, and Archive remain on `/billable/[id]`.
- Billable list boundary copy explicitly says billable readiness does not create settlement, invoice, cash receipt, payment application, accounting export, or external accounting entry.

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Recalculate Readiness | `/billable/[id]` | Billable item | Finance | Status `candidate`. | Missing permission. | Secondary, modal, no fields. | Recalculate readiness. | No lifecycle mutation required; no settlement/invoice/payment/payroll/export. Certified. | P0 |
| Release Hold | `/billable/[id]` | Billable item | Finance | Status `held`. | Missing release note/hold reason. | Primary, modal "Release Hold", Release Note/Hold Reason. | Release hold. | Status no longer held; audit/timeline. Certified. | P0 |
| Resolve Dispute | `/billable/[id]` | Billable item | Finance | Status `disputed`. | Missing resolution note. | Primary, modal "Resolve Dispute", Resolution Note. | Resolve dispute. | Status no longer disputed. Certified. | P0 |
| Archive | `/billable/[id]` | Billable item | System Admin | Status `voided`. | Not voided or missing permission. | Danger, modal "Archive". | Archive. | `status=archived`; no downstream finance creation. Certified. | P0 |

## Settlement

Phase 5 list-page notes:

- `/settlements` now exposes queue actions only: Review Next Settlement, Recalculate Readiness queue link, Open Disputes, Open Invoice Ready, Create Settlement, queue tab selection, and Open Detail.
- Submit Review, Recalculate Readiness, Reject, Mark Invoice Ready, Resolve Dispute, and Archive remain on `/settlements/[id]`.
- Settlement list boundary copy explicitly says Mark Invoice Ready does not send, post, create cash, or collect payment.

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Submit Review | `/settlements/[id]` | Settlement | Finance | Status `draft`. | Missing required settlement readiness. | Primary, modal "Submit Review". | Submit settlement review. | `status=ready_for_review`; no invoice/payment/payroll/cash/bank/export. Certified. | P0 |
| Recalculate Readiness | `/settlements/[id]` | Settlement item/parent | Finance | Draft item/settlement. | Missing permission. | Secondary, modal "Recalculate Readiness". | Recalculate readiness. | No downstream mutation. Certified. | P0 |
| Reject | `/settlements/[id]` | Settlement | Finance | Status `under_review`. | Missing rejection reason. | Danger, modal "Reject", Rejection Reason. | Reject settlement. | `status=rejected`; no invoice. Certified. | P0 |
| Mark Invoice Ready | `/settlements/[id]` | Settlement | Finance | Status `approved`. | Missing ready note. | Primary, modal "Mark Invoice Ready", Ready Note. | Mark invoice ready. | `invoice_ready=true`; does not create invoice. Certified. | P0 |
| Resolve Dispute | `/settlements/[id]` | Settlement | Finance | Status `disputed`. | Missing resolution note. | Primary, modal, Resolution Note. | Resolve dispute. | Status no longer disputed. Certified. | P0 |
| Archive | `/settlements/[id]` | Settlement | System Admin | Status `voided`. | Not voided or missing permission. | Danger, modal "Archive". | Archive. | `status=archived`; no invoice/payment/payroll/cash/bank/export. Certified. | P0 |

## Invoice

Phase 5 list-page notes:

- `/invoices` now exposes queue actions only: Review Next Invoice, Open Approved Invoices, Open Disputes, Open Aging Invoices, Create Invoice, queue tab selection, and Open Detail.
- Submit Review, Reject, Mark Sent, Resolve Dispute, and Archive remain on `/invoices/[id]`.
- Invoice list boundary copy explicitly says Mark Sent records an external/manual sent state and does not email, post to QuickBooks, create cash receipts, apply cash, or collect payment.

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Submit Review | `/invoices/[id]` | Invoice | Billing Manager | Status `draft`. | Missing required invoice data. | Primary, modal "Submit Review". | Submit invoice review. | `status=ready_for_review`; no cash/payment/bank/payroll/export. Certified. | P0 |
| Reject | `/invoices/[id]` | Invoice/item | Finance | Item invoiced or invoice under review. | Missing rejection reason. | Danger, modal "Reject", Rejection Reason. | Reject invoice/item. | `approval_status=rejected` or `status=rejected`. Certified. | P0 |
| Mark Sent | `/invoices/[id]` | Invoice | Finance | Status `approved`. | Missing sent/delivery note. | Primary, modal "Mark Sent", Sent Note/Delivery Note. | Mark sent. | `status=sent`; no external email/payment. Certified. | P0 |
| Resolve Dispute | `/invoices/[id]` | Invoice | Finance/Admin | Status `disputed`. | Missing resolution note. | Primary, modal, Resolution Note. | Resolve dispute. | Status no longer disputed. Certified. | P0 |
| Archive | `/invoices/[id]` | Invoice | System Admin | Status `voided`. | Not voided or missing permission. | Danger, modal "Archive". | Archive. | `status=archived`; no cash/payment/bank/payroll/export. Certified. | P0 |

## Cash Application

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Apply to Invoice | `/cash/receipts/[id]` | Cash receipt | Finance | Receipt `received` and unapplied. | Missing invoice/applied amount, no permission. | Primary, modal "Apply to Invoice", Invoice, Applied Amount. | Apply receipt. | Payment application created; no payroll/contractor/bank/export. Certified. | P0 |
| Void Receipt | `/cash/receipts/[id]` | Cash receipt | Finance | Receipt `received`. | Missing void reason/note. | Danger, modal "Void Receipt", Void Reason/Note. | Void receipt. | `receipt_status=voided`; audit/timeline. Certified. | P0 |
| Archive Receipt | `/cash/receipts/[id]` | Cash receipt | System Admin | Receipt `voided`. | Not voided. | Danger, modal "Archive Receipt". | Archive receipt. | `receipt_status=archived`; no bank/export. Certified. | P0 |
| Void Payment Application | `/payment-applications/[id]` | Payment application | Finance | Application `applied`. | Missing void reason/note. | Danger, modal, Void Reason/Note. | Void application. | `application_status=voided`; balance impact audited. Certified. | P0 |
| Archive Payment Application | `/payment-applications/[id]` | Payment application | System Admin | Application `voided`. | Not voided. | Danger, modal. | Archive application. | `application_status=archived`; no bank/export. Certified. | P0 |

## Collections

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Assign Owner | `/collections/[id]` | Collection case | Collections Specialist | Case `open`. | Missing assignment note or owner policy. | Primary, modal "Assign Owner", Assignment Note. | Assign owner. | Owner set; no cash/payment/export. Certified. | P0 |
| Archive Case | `/collections/[id]` | Collection case | System Admin | Case `closed`. | Not closed. | Danger, modal "Archive Case". | Archive case. | `case_status=archived`; no cash/payment/export. Certified. | P0 |
| Complete Action | `/collection-actions/[id]` | Collection action | Collections Specialist | Action `planned`. | Missing completion note/outcome. | Primary, modal, Completion Note/Outcome. | Complete action. | `action_status=completed`; audit/timeline. Certified. | P0 |
| Archive Action | `/collection-actions/[id]` | Collection action | Collections Specialist/Admin | Action `completed`. | Not completed. | Danger, modal. | Archive action. | `action_status=archived`; no cash/payment/export. Certified. | P0 |

## Contractor Payable

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Submit Review | `/contractor-payables/[id]` | Contractor payable | Payables/Admin | Status `draft`. | Missing required items/totals. | Primary, modal. | Submit review. | `status=ready_for_review`; no payment/bank/payroll/export. Certified. | P0 |
| Recalculate Totals | `/contractor-payables/[id]` | Contractor payable item/parent | Payables/Admin | Draft item/parent. | Missing permission. | Secondary, modal. | Recalculate totals. | Totals recalculated; no downstream creation. Certified. | P0 |
| Approve | `/contractor-payables/[id]` | Contractor payable | Payables/Admin | Status `under_review`. | Missing approval note. | Primary, modal, Approval Note. | Approve. | `status=approved`; no payment batch. Certified. | P0 |
| Mark Payment Ready | `/contractor-payables/[id]` | Contractor payable | Payables/Admin | Status `approved`. | Missing permission. | Primary, modal. | Mark payment ready. | `payment_readiness_status=ready_for_payment`; no payment movement. Certified. | P0 |
| Resolve Dispute | `/contractor-payables/[id]` | Contractor payable | Payables/Admin | Status `disputed`. | Missing resolution note. | Primary, modal, Resolution Note. | Resolve dispute. | Status no longer disputed. Certified. | P0 |
| Archive | `/contractor-payables/[id]` | Contractor payable | System Admin | Status `voided`. | Not voided. | Danger, modal. | Archive. | `status=archived`; no payment/bank/payroll/export. Certified. | P0 |

## Payroll

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Submit Review | `/payroll/[id]` | Payroll run | Payroll Admin | Status `draft`. | Missing required items/totals. | Primary, modal. | Submit review. | `status=ready_for_review`; no payment/bank/contractor/export. Certified. | P0 |
| Recalculate Totals | `/payroll/[id]` | Payroll item/parent | Payroll Admin | Draft item/parent. | Missing permission. | Secondary, modal. | Recalculate totals. | Totals recalculated; no downstream creation. Certified. | P0 |
| Approve | `/payroll/[id]` | Payroll run | Payroll Admin | Status `under_review`. | Missing approval note. | Primary, modal, Approval Note. | Approve. | `status=approved`; no provider submission. Certified. | P0 |
| Mark Payroll Ready | `/payroll/[id]` | Payroll run | Payroll Admin | Status `approved`. | Missing permission. | Primary, modal. | Mark payroll ready. | `payroll_readiness_status=ready_for_payroll`; no provider submission. Certified. | P0 |
| Resolve Dispute | `/payroll/[id]` | Payroll run | Payroll Admin | Status `disputed`. | Missing resolution note. | Primary, modal. | Resolve dispute. | Status no longer disputed. Certified. | P0 |
| Archive | `/payroll/[id]` | Payroll run | System Admin | Status `voided`. | Not voided. | Danger, modal. | Archive. | `status=archived`; no provider/payment/bank/export. Certified. | P0 |

## Payment Execution

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Submit Review | `/payments/[id]` | Payment batch | Payables Admin | Status `draft`. | Missing items/totals. | Primary, modal. | Submit review. | `status=ready_for_review`; no bank transaction/recon/export. Certified. | P0 |
| Archive Item | `/payment-items/[id]` | Payment item | Admin | Item `draft`. | Not draft or missing permission. | Danger, modal "Archive Payment Item". | Archive item. | `status=archived`; no bank/recon/export. Certified. | P0 |
| Approve | `/payments/[id]` | Payment batch | Admin/Accounting policy | Status `under_review`. | Missing approval note. | Primary, modal, Approval Note. | Approve batch. | `status=approved`; no money movement. Certified. | P0 |
| Schedule | `/payments/[id]` | Payment batch | Admin/Accounting policy | Status `approved`. | Missing scheduled payment date. | Primary, modal, Scheduled Payment Date. | Schedule batch. | `status=scheduled`; no provider/ACH/wire/card/check. Certified. | P0 |
| Void | `/payments/[id]` | Payment batch | Admin | Draft voidable batch. | Missing void reason or executed status. | Danger, modal "Void Payment Batch", Void Reason. | Void batch. | `status=voided`; no bank/recon/export. Certified. | P0 |
| Submit Execution | `/payments/[id]` | Payment batch | Admin/Accounting policy | Status `scheduled`. | Missing submit note/execution reference. | Primary, modal, Submit Note/Execution Reference. | Submit execution. | `status=submitted`; no external payment submission. Certified. | P0 |
| Mark Executed | `/payments/[id]` | Payment batch | Admin/Accounting policy | Status `submitted`. | Missing execution reference/note. | Primary, modal, Execution Reference and Execution Note. | Mark executed. | `status=executed_later`; internal tracking only. Certified. | P0 |
| Archive | `/payments/[id]` | Payment batch | Admin | Status `voided`. | Not voided. | Danger, modal. | Archive batch. | `status=archived`; no bank/recon/export. Certified. | P0 |

## Bank Reconciliation

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Archive Account | `/bank-reconciliation/accounts/[id]` | Bank account | Accounting Manager | Account `inactive`. | Active account or missing permission. | Danger, modal "Archive Bank Account". | Archive account. | `status=archived`; no export/payment application. Certified. | P0 |
| Match Payment Batch | `/bank-reconciliation/transactions/[id]` | Bank transaction | Accounting Manager | Unreconciled debit. | Missing payment batch ID/matched amount. | Primary, modal, Payment Batch ID and Matched Amount. | Create/record match. | Reconciliation match created; no export/payment application. Certified. | P0 |
| Match Cash Receipt | `/bank-reconciliation/transactions/[id]` | Bank transaction | Accounting Manager | Unreconciled credit. | Missing cash receipt ID/matched amount. | Primary, modal, Cash Receipt ID and Matched Amount. | Create/record match. | Reconciliation match created; no export/payment application. Certified. | P0 |
| Open Exception | `/bank-reconciliation/transactions/[id]` | Bank transaction | Accounting Manager | Unreconciled with no exception. | Missing exception reason. | Secondary, modal, Exception Reason. | Open exception. | `exception_status=open`; no export. Certified. | P0 |
| Resolve Exception | `/bank-reconciliation/transactions/[id]` | Bank transaction | Accounting Manager | Exception open. | Missing resolution note. | Primary, modal, Resolution Note. | Resolve exception. | Exception no longer open. Certified. | P0 |
| Ignore | `/bank-reconciliation/transactions/[id]` | Bank transaction | Accounting Manager | Transaction ignorable. | Missing ignore reason. | Danger, modal "Ignore Transaction", Ignore Reason. | Ignore transaction. | `reconciliation_status=ignored`; no export. Certified. | P0 |
| Review Match | `/reconciliation-matches/[id]` | Reconciliation match | Accounting Manager | Match `proposed`. | Missing permission. | Primary, modal "Review Match". | Review match. | `match_status=reviewed`; no export. Certified. | P0 |

## Accounting Export

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Submit Review | `/accounting-exports/[id]` | Export batch | Accounting Manager | Status `draft`. | Missing items/control totals. | Primary, modal. | Submit review. | `status=ready_for_review`; no GL/API/file submission. Certified. | P0 |
| Archive Item | `/accounting-export-items/[id]` | Export item | Admin | Item `pending`. | Missing archive reason. | Danger, modal "Archive Item", Archive Reason. | Archive item. | `export_status=archived`; no GL/API. Certified. | P0 |
| Mark Submitted | `/accounting-exports/[id]` | Export batch | Accounting Manager | Status `generated`. | Missing permission. | Primary, modal. | Mark submitted. | `export_status=submitted_later`; internal tracking only. Certified. | P0 |
| Approve | `/accounting-exports/[id]` | Export batch | Accounting Manager | Status `under_review`. | Missing approval note. | Primary, modal, Approval Note. | Approve. | `approval_status=approved`; no GL/API. Certified. | P0 |
| Mark Accepted | `/accounting-exports/[id]` | Export batch | Accounting Manager | Status `submitted_later`. | Missing acceptance note. | Primary, modal, Acceptance Note. | Mark accepted. | `export_status=accepted_later`; internal tracking only. Certified. | P0 |
| Cancel | `/accounting-exports/[id]` | Export batch | Accounting Manager | Draft cancelable. | Missing cancel reason. | Danger, modal "Cancel", Cancel Reason. | Cancel export. | `status=cancelled`; no GL/API. Certified. | P0 |

## Admin / Session

| Button | Route/page | Object | Persona/permission | Appears when | Disabled when and explanation | Style/modal/fields | Backend action | Success/events/boundary/E2E | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Save Operator Session | Current Signal Feed developer panel | Local session | Developer/test only | Local/dev/test mode only. | Production mode: hidden. | Utility, no modal, token/permissions fields. | Local storage only. | No backend mutation. Current UX problem; remove from operator experience. | P0 |
| Clear Filters | Lists/queues | View state | Any readable persona | Filters active. | No active filters: optional disabled. | Ghost/utility, no modal. | Client state. | No mutation. Needs standardized behavior. | P2 |
| Refresh Queue | Proposed all queues | View state | Any readable persona | Queue visible. | While loading. | Utility, no modal. | GET current queue. | No mutation. Needs E2E per template. | P2 |
