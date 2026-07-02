# Operator Modal Registry

## Modal Behavior Standards

Every mutation modal must follow these standards:

- Submit is disabled while submitting.
- Cancel is disabled while submitting.
- Close is disabled while submitting.
- Repeated submits are blocked.
- Successful backend mutation closes the modal only after page/detail reload succeeds.
- Backend or validation error keeps the modal open.
- Error region uses `role="alert"`.
- Destructive actions use danger styling.
- Destructive actions explain irreversible or hard-to-reverse consequence.
- Boundary copy states what will not happen downstream.
- Required fields are visible before submit.
- Keyboard users can open, tab through, submit, cancel, and close.
- Focus should return to trigger or the success region after close.
- Modal title must match the action label and object.
- Submit label must repeat the action verb, not generic "OK".

## Common Modal Fields

| Field type | Standard |
|---|---|
| Note | Optional only when action is low-risk and backend permits it. |
| Reason | Required for reject, void, cancel, ignore, archive where business policy requires it. |
| Amount | Required for cash application and reconciliation matching. |
| Date | Required when scheduling payment execution. |
| Reference | Required when marking execution or external-facing internal tracking state. |
| Owner | Required for assignment when owner selection exists; current certified Assign Owner requires Assignment Note. |

## Certified Modal Registry

| Modal title | Purpose | Opens from | Trigger | State required | Fields | Validation | Submit / cancel / close | Success | Error | Backend mutation | Audit/timeline | E2E coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Submit | Submit production for review. | `/production/[id]` | Submit | Production draft. | Submission Note/Submit Note. | Note required by modal/test expectation. | Submit; cancel closes with no mutation; close same as cancel when idle. | Status submitted, modal closes after reload. | Alert stays open. | Production submit. | Submit event and audit mutation. | Certified readiness/modal/boundary/persona/submit/release. |
| Start Review | Begin production or QC review. | `/production/[id]`, `/qc/[id]` | Start Review | Production submitted or QC pending. | None certified. | State and permission. | Start Review. | Status under_review or review_status in_review. | Alert stays open. | Start review. | Review started event. | Certified. |
| Approve | Approve production, QC, payable, payroll, payment batch, accounting export. | Detail pages by domain. | Approve | Under review/in review. | Production: Approved Quantity/Approval Note; QC: Review/Approval Note; payable/payroll/payment/export: Approval Note. | Required note/quantity where present. | Approve. | Approved state, modal closes. | Alert stays open. | Domain approve route. | Approval event and audit. | Certified. |
| Mark Corrected | Mark correction work complete. | `/production/[id]`, `/qc/[id]` | Mark Corrected | Correction required. | Correction Note. | Required. | Mark Corrected. | Corrected status. | Alert stays open. | Mark corrected. | Correction event and audit. | Certified. |
| Mark Billable | Mark approved production billable. | `/production/[id]` | Mark Billable | Approved and not billable. | None certified. | State/permission. | Mark Billable. | billable_status=billable. | Alert stays open. | Mark billable. | Billable marker event. | Certified. |
| Archive | Archive voided production/QC/billable/settlement/invoice/payable/payroll/payment batch. | Detail pages. | Archive | Object voided. | None certified for most archive modals. | State/permission. | Archive. | Archived state. | Alert stays open. | Domain archive route. | Archive event and audit. | Certified. |

## Phase 4 Execution Queue Modal Notes

- `/work-orders`, `/production`, and `/qc` list pages do not introduce new mutation modals.
- List pages only change queue/filter state or navigate to create/detail routes.
- Existing high-risk Work Order lifecycle modals remain on `/work-orders/[id]`.
- Existing high-risk Production lifecycle modals remain on `/production/[id]` for Submit, Start Review, Approve, Reject, Request Correction, Mark Corrected, Mark Billable, Void, Archive, and Evidence metadata actions.
- Existing high-risk QC lifecycle modals remain on `/qc/[id]` for Start Review, Approve, Reject, Request Correction, Mark Corrected, Void, and Archive.
- Phase 4 preserves backend validation, tenant authorization, timeline, audit, and system action behavior.

## Phase 5 Finance Workbench Modal Notes

- `/billable`, `/settlements`, and `/invoices` list pages do not introduce new mutation modals.
- List pages only change queue/filter state or navigate to create/detail routes.
- Existing Billable lifecycle modals remain on `/billable/[id]` for Recalculate Readiness, Mark Ready For Settlement, Place Hold, Release Hold, Dispute, Resolve Dispute, Void, and Archive.
- Existing Settlement lifecycle modals remain on `/settlements/[id]` for Add Settlement Item, Submit Review, Start Review, Approve, Reject, Mark Invoice Ready, Mark Payable Ready, Place Hold, Release Hold, Dispute, Resolve Dispute, Void, Archive, and item actions.
- Existing Invoice lifecycle modals remain on `/invoices/[id]` for Add Invoice Item, Recalculate Totals, Submit Review, Approve, Reject, Mark Sent, Mark Ready For Cash Application, Dispute, Resolve Dispute, Void, Archive, and item actions.
- Phase 5 preserves backend validation, tenant authorization, timeline, audit, system action behavior, and finance boundary rules.

| Recalculate Readiness | Recompute readiness on billable or settlement item/parent. | `/billable/[id]`, `/settlements/[id]` | Recalculate Readiness | Candidate/draft state. | None. | Permission. | Recalculate. | No unsafe downstream mutation. | Alert stays open. | Recalculate route. | Recalculate event if emitted. | Certified. |
| Release Hold | Release held billable item. | `/billable/[id]` | Release Hold | Held status. | Release Note/Hold Reason. | Required. | Release Hold. | Status no longer held. | Alert stays open. | Release hold. | Hold released event. | Certified. |
| Resolve Dispute | Resolve dispute across billable, settlement, invoice, contractor payable, payroll. | Detail pages. | Resolve Dispute | Disputed status. | Resolution Note. | Required. | Resolve Dispute. | Status no longer disputed. | Alert stays open. | Resolve dispute. | Dispute resolved event. | Certified. |
| Submit Review | Submit settlement, invoice, contractor payable, payroll, payment batch, accounting export for review. | Detail pages. | Submit Review | Draft. | None certified. | Required readiness by backend. | Submit Review. | ready_for_review status. | Alert stays open. | Submit review. | Submit review event. | Certified. |
| Reject | Reject settlement or invoice/item under review. | `/settlements/[id]`, `/invoices/[id]` | Reject | Under review or item rejection state. | Rejection Reason. | Required. | Reject. | Rejected state. | Alert stays open. | Reject route. | Rejection event and audit. | Certified. |
| Mark Invoice Ready | Mark settlement ready for invoicing. | `/settlements/[id]` | Mark Invoice Ready | Settlement approved. | Ready Note. | Required. | Mark Invoice Ready. | invoice_ready true. | Alert stays open. | Mark invoice ready. | Invoice-ready event. | Certified. |
| Mark Sent | Mark invoice sent internally. | `/invoices/[id]` | Mark Sent | Invoice approved. | Sent Note/Delivery Note. | Required. | Mark Sent. | Invoice status sent. | Alert stays open. | Mark sent. | Sent event and audit. | Certified. |
| Apply to Invoice | Apply cash receipt to invoice. | `/cash/receipts/[id]` | Apply to Invoice | Receipt received/unapplied. | Invoice, Applied Amount. | Invoice and positive amount required. | Apply to Invoice. | Payment application created. | Alert stays open. | Apply receipt. | Cash application event and audit. | Certified. |
| Void Receipt | Void cash receipt. | `/cash/receipts/[id]` | Void Receipt | Receipt received. | Void Reason/Void Note. | Required. | Void Receipt. | receipt_status voided. | Alert stays open. | Void receipt. | Void event and audit. | Certified. |
| Archive Receipt | Archive voided receipt. | `/cash/receipts/[id]` | Archive Receipt | Receipt voided. | None certified. | State/permission. | Archive Receipt. | receipt_status archived. | Alert stays open. | Archive receipt. | Archive event. | Certified. |
| Void Payment Application | Void payment application. | `/payment-applications/[id]` | Void | Application applied. | Void Reason/Void Note. | Required. | Void Payment Application. | application_status voided. | Alert stays open. | Void application. | Application void event. | Certified. |
| Archive Payment Application | Archive voided application. | `/payment-applications/[id]` | Archive | Application voided. | None certified. | State/permission. | Archive Payment Application. | application_status archived. | Alert stays open. | Archive application. | Archive event. | Certified. |
| Assign Owner | Assign collection case owner. | `/collections/[id]` | Assign Owner | Case open. | Assignment Note. | Required. | Assign Owner. | assigned_owner_user_id set. | Alert stays open. | Assign owner. | Assignment event. | Certified. |
| Archive Case | Archive closed collection case. | `/collections/[id]` | Archive Case | Case closed. | None certified. | State/permission. | Archive Case. | case_status archived. | Alert stays open. | Archive case. | Archive event. | Certified. |
| Complete Action | Complete collection action. | `/collection-actions/[id]` | Complete | Action planned. | Completion Note/Outcome. | Required. | Complete Action. | action_status completed. | Alert stays open. | Complete action. | Completion event. | Certified. |
| Archive Action | Archive completed collection action. | `/collection-actions/[id]` | Archive Action | Action completed. | None certified. | State/permission. | Archive Action. | action_status archived. | Alert stays open. | Archive action. | Archive event. | Certified. |

## Phase 6 Cash And Collections Workbench Modal Notes

- Phase 6 preserves existing detail-page modals for Apply to Invoice, Void Receipt, Archive Receipt, Void Payment Application, Archive Payment Application, Assign Owner, Complete Action, Archive Case, and Archive Action.
- Cash and collections list pages add queue/navigation actions only; they do not introduce new mutating list-page modals or fake backend behavior.
- Cash Application list boundary copy clarifies that receipt and application workflows do not pull bank feeds, move money, process cards, initiate ACH, refund money, or post accounting entries.
- Collections list boundary copy clarifies that collection cases and actions do not automatically email customers, make calls, collect money, report credit, or create legal action.
- Phase 6 preserves backend validation, tenant authorization, timeline, audit, system action behavior, and cash/collections boundary rules.
| Recalculate Totals | Recalculate contractor payable or payroll totals. | `/contractor-payables/[id]`, `/payroll/[id]` | Recalculate Totals | Draft item/parent. | None. | Permission. | Recalculate Totals. | Totals recalculated, no downstream object. | Alert stays open. | Recalculate totals. | Recalculate event. | Certified. |
| Mark Payment Ready | Mark contractor payable internally payment ready. | `/contractor-payables/[id]` | Mark Payment Ready | Payable approved. | None certified. | State/permission. | Mark Payment Ready. | payment_readiness_status ready_for_payment. | Alert stays open. | Mark payment ready. | Payment-ready event. | Certified. |
| Mark Payroll Ready | Mark payroll run internally ready. | `/payroll/[id]` | Mark Payroll Ready | Payroll approved. | None certified. | State/permission. | Mark Payroll Ready. | payroll_readiness_status ready_for_payroll. | Alert stays open. | Mark payroll ready. | Payroll-ready event. | Certified. |
| Archive Payment Item | Archive payment item. | `/payment-items/[id]` | Archive Item | Item draft. | None certified. | State/permission. | Archive Item. | status archived. | Alert stays open. | Archive item. | Archive item event. | Certified. |
| Schedule | Schedule internal payment batch. | `/payments/[id]` | Schedule | Batch approved. | Scheduled Payment Date. | Required date. | Schedule. | status scheduled. | Alert stays open. | Schedule batch. | Schedule event. No external payment. | Certified. |
| Void Payment Batch | Void payment batch. | `/payments/[id]` | Void | Draft voidable. | Void Reason. | Required. | Void Payment Batch. | status voided. | Alert stays open. | Void batch. | Void event. | Certified. |
| Submit Execution | Submit internal execution tracking. | `/payments/[id]` | Submit Execution | Batch scheduled. | Submit Note/Execution Reference. | Required. | Submit Execution. | status submitted. | Alert stays open. | Submit execution. | Execution submitted event. No provider call. | Certified. |
| Mark Executed | Mark internal batch executed later. | `/payments/[id]` | Mark Executed | Batch submitted. | Execution Reference, Execution Note. | Required. | Mark Executed. | status executed_later. | Alert stays open. | Mark executed. | Execution marked event. No payment movement. | Certified. |
| Archive Bank Account | Archive inactive bank account. | `/bank-reconciliation/accounts/[id]` | Archive | Account inactive. | None certified. | State/permission. | Archive Bank Account. | status archived. | Alert stays open. | Archive account. | Archive event. | Certified. |
| Match Payment Batch | Match bank debit to payment batch. | `/bank-reconciliation/transactions/[id]` | Match Payment Batch | Transaction unreconciled debit. | Payment Batch ID, Matched Amount. | Required and amount valid. | Match Payment Batch. | Reconciliation match created. | Alert stays open. | Create match. | Match event. No export/payment application. | Certified. |
| Match Cash Receipt | Match bank credit to cash receipt. | `/bank-reconciliation/transactions/[id]` | Match Cash Receipt | Transaction unreconciled credit. | Cash Receipt ID, Matched Amount. | Required and amount valid. | Match Cash Receipt. | Reconciliation match created. | Alert stays open. | Create match. | Match event. No export/payment application. | Certified. |
| Open Exception | Open reconciliation exception. | `/bank-reconciliation/transactions/[id]` | Open Exception | No open exception. | Exception Reason. | Required. | Open Exception. | exception_status open. | Alert stays open. | Open exception. | Exception event. | Certified. |
| Resolve Exception | Resolve reconciliation exception. | `/bank-reconciliation/transactions/[id]` | Resolve Exception | Exception open. | Resolution Note. | Required. | Resolve Exception. | exception_status not open. | Alert stays open. | Resolve exception. | Resolution event. | Certified. |
| Ignore Transaction | Ignore bank transaction. | `/bank-reconciliation/transactions/[id]` | Ignore | Ignorable unreconciled transaction. | Ignore Reason. | Required. | Ignore Transaction. | reconciliation_status ignored. | Alert stays open. | Ignore transaction. | Ignore event. | Certified. |
| Review Match | Review proposed reconciliation match. | `/reconciliation-matches/[id]` | Review | Match proposed. | None certified. | State/permission. | Review Match. | match_status reviewed. | Alert stays open. | Review match. | Review event. | Certified. |
| Archive Item | Archive accounting export item. | `/accounting-export-items/[id]` | Archive Item | Export item pending. | Archive Reason. | Required. | Archive Item. | export_status archived. | Alert stays open. | Archive item. | Archive event. | Certified. |
| Mark Submitted | Mark accounting export internally submitted. | `/accounting-exports/[id]` | Mark Submitted | Export generated. | None certified. | State/permission. | Mark Submitted. | export_status submitted_later. | Alert stays open. | Mark submitted. | Submitted event. No GL/API. | Certified. |
| Mark Accepted | Mark accounting export internally accepted. | `/accounting-exports/[id]` | Mark Accepted | Export submitted_later. | Acceptance Note. | Required. | Mark Accepted. | export_status accepted_later. | Alert stays open. | Mark accepted. | Accepted event. No GL/API. | Certified. |
| Cancel | Cancel accounting export. | `/accounting-exports/[id]` | Cancel | Draft cancelable. | Cancel Reason. | Required. | Cancel. | status cancelled. | Alert stays open. | Cancel export. | Cancel event. No GL/API. | Certified. |

## Modal Gaps

1. Not all domains use the recently hardened submitting-state pattern.
2. Disabled reasons are not consistently visible.
3. Focus return after close is not explicitly tested.
4. Destructive confirmations are not uniformly worded.
5. Some archive modals do not require reasons; product policy should decide whether that is acceptable.
6. Modal titles and button labels are certified, but operator consequence copy needs a consistent template.
7. Create/edit modals and pages are not covered by the action-state registry.
