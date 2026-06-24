# Canonical Demo Path

## Demo Story

Canonical story: **Cedar Ridge Fiber Expansion**.

ARC SyncOS Demo Tenant discovers and executes a Cedar Ridge fiber build. The customer is Cedar Ridge Utility Authority, the program stakeholder is Cedar Ridge Broadband Office, the subcontractor is Blue Splice Fiber Services, the field crew is Blue Splice Crew A, and Alex Rivera is the worker used for payroll certification.

This story is the proposed default browser E2E demo path. It must be confirmed before seed implementation.

## Deterministic Naming Rules

* Tenant: `ARC SyncOS Demo Tenant`
* Slug prefix: `arc-demo`
* Scenario prefix: `CR`
* Object references should include `CR` and a stable sequence where the backend allows human references.
* Test-created copies should append `E2E-<run_id>`.
* Canonical seed records should be deterministic and reset by recreating the database, not by mutating production-like data.

## Canonical Objects

| Domain | Object | Deterministic name |
| --- | --- | --- |
| Tenant | Tenant | ARC SyncOS Demo Tenant |
| Territory | Territory | Cedar Ridge North |
| Territory | Territory | Cedar Ridge South |
| Organization | Customer | Cedar Ridge Utility Authority |
| Organization | Stakeholder | Cedar Ridge Broadband Office |
| Organization | Capacity provider | Blue Splice Fiber Services |
| Organization | Internal | ARC SyncOS Demo Operations |
| Contact | Customer contact | Dana Lewis |
| Contact | Stakeholder contact | Morgan Ellis |
| Contact | Provider contact | Luis Moreno |
| Capacity | Provider | Blue Splice Fiber Services |
| Capacity | Crew | Blue Splice Crew A |
| Labor | Worker | Alex Rivera |
| Growth | Signal | Cedar Ridge Fiber Expansion RFP Discovered |
| Growth | Relationship Map | Cedar Ridge Access Map |
| Growth | Opportunity Candidate | Cedar Ridge Phase 1 Candidate |
| Opportunity | Opportunity | Cedar Ridge Phase 1 Fiber Build |
| Coverage | Coverage Plan | Cedar Ridge Phase 1 Coverage Plan |
| Handoff | Project Handoff | Cedar Ridge Phase 1 Handoff |
| Project | Project | Cedar Ridge Phase 1 Fiber Build |
| Work Order | Work Order | WO-CR-001 Underground Fiber Segment A |
| Production | Production Record | PRD-CR-001 Daily Production Segment A |
| QC | QC Review | QC-CR-001 Internal QC Segment A |
| Revenue | Billable Item | BILL-CR-001 Segment A Billable |
| Revenue | Settlement | SET-CR-001 Cedar Ridge Settlement |
| Revenue | Invoice | INV-CR-001 Cedar Ridge Invoice |
| Revenue | Cash Receipt | RCPT-CR-001 Cedar Ridge Partial Payment |
| Revenue | Collection Case | COLL-CR-001 Cedar Ridge Balance Follow-Up |
| Cost | Contractor Payable | PAY-CR-001 Blue Splice Payable |
| Labor | Payroll Run | PR-CR-001 Weekly Payroll |
| Payment | Payment Batch | PB-CR-001 Payment Batch |
| Bank | Bank Account | ARC Operating Account |
| Bank | Bank Transaction | BTX-CR-001 Manual Bank Clearing |
| Accounting | Accounting Export Batch | AEX-CR-001 Accounting Export |

## Step-By-Step Canonical Path

### A. Growth To Opportunity

1. Growth Operator opens `/intelligence/signals`.
2. Create or open `Cedar Ridge Fiber Expansion RFP Discovered`.
3. Add signal evidence and verify the signal.
4. Open or create `Cedar Ridge Utility Authority`.
5. Open or create Dana Lewis as customer program manager.
6. Create `Cedar Ridge Access Map` with Cedar Ridge Utility Authority, Cedar Ridge Broadband Office, and Blue Splice Fiber Services context.
7. Create or open `Cedar Ridge Phase 1 Candidate`.
8. Attach the Cedar Ridge signal to the candidate.
9. Qualify candidate.
10. Convert candidate to `Cedar Ridge Phase 1 Fiber Build` opportunity if backend contract supports conversion.
11. Submit and approve/pursuit-approve the opportunity.

Required assertions:

* Relationship weakness remains a warning/override, not an undocumented hard blocker.
* No project, work order, production, finance, payment, bank, or accounting export records are created from growth steps unless the existing backend route explicitly does so.

### B. Opportunity To Project

1. Operations / Project Manager opens the approved opportunity.
2. Create or open `Cedar Ridge Phase 1 Coverage Plan`.
3. Add coverage requirements, sources, and gaps.
4. Resolve or override gaps as required.
5. Approve coverage for handoff.
6. Create or open `Cedar Ridge Phase 1 Handoff`.
7. Complete checklist/risk/approval items as existing backend allows.
8. Create project from approved handoff only if the existing route supports it.
9. Open `Cedar Ridge Phase 1 Fiber Build` project.

Required assertions:

* Coverage approval creates no project by itself.
* Project handoff creates only the allowed project record.
* No work orders, production, settlement, invoice, payment, payroll, bank, or accounting export records are auto-created.

### C. Project To QC

1. Operations / Project Manager opens the project.
2. Create or open `WO-CR-001 Underground Fiber Segment A`.
3. Assign provider/crew, schedule, start, and submit where allowed.
4. Field Supervisor creates `PRD-CR-001 Daily Production Segment A`.
5. Add evidence metadata where supported.
6. Submit production.
7. QC Reviewer starts review and approves part/all production.
8. Create/open `QC-CR-001 Internal QC Segment A`.
9. Approve, reject, or request correction as the test variant requires.

Required assertions:

* Work Order does not create production automatically.
* Production does not create finance.
* QC does not create settlement.
* Planned, claimed, approved, rejected, correction-required, and billable-candidate quantities remain distinct.

### D. QC To Revenue

1. Billing / Finance User creates or opens `BILL-CR-001 Segment A Billable` from approved QC context.
2. Mark billable ready for settlement.
3. Create `SET-CR-001 Cedar Ridge Settlement`.
4. Add settlement item from ready billable.
5. Submit/start/approve settlement.
6. Mark invoice ready.
7. Create `INV-CR-001 Cedar Ridge Invoice`.
8. Add invoice item from invoice-ready settlement item.
9. Submit/approve/mark sent.
10. Mark ready for cash application.
11. Create `RCPT-CR-001 Cedar Ridge Partial Payment`.
12. Apply receipt to invoice.
13. Create `COLL-CR-001 Cedar Ridge Balance Follow-Up` for remaining balance.
14. Add promise/dispute/escalation collection action.

Required assertions:

* Cash receipt alone does not update invoice balance.
* Payment application is the only tested invoice balance mutation.
* Collections does not create cash receipt, payment application, accounting export, or tax.

### E. Settlement To Contractor Payable And Payment Execution

1. Open settlement with payable-ready item.
2. Create `PAY-CR-001 Blue Splice Payable`.
3. Add payable item from settlement item.
4. Submit/start/approve payable.
5. Mark payment ready.
6. Create `PB-CR-001 Payment Batch`.
7. Add contractor payable item.
8. Submit/start/approve payment batch.
9. Schedule.
10. Submit execution status-only.
11. Mark executed status-only or failed.

Required assertions:

* Contractor Payable approval creates no payment.
* Payment Ready sends no money.
* Payment Execution creates no ACH/check/card/wire, payroll provider submission, bank transaction, tax, or accounting export.

### F. Payroll To Payment Execution

1. Payables / Payroll Admin creates `PR-CR-001 Weekly Payroll`.
2. Add payroll item for Alex Rivera.
3. Validate classification, earnings, reimbursements, and deductions.
4. Submit/start/approve payroll run.
5. Mark payroll ready.
6. Add payroll item to `PB-CR-001 Payment Batch` or a payroll-specific payment batch variant if product confirms.
7. Submit/start/approve/schedule/submit execution status-only.

Required assertions:

* Payroll approval creates no payment.
* Payroll ready creates no ACH/check/card/payroll provider submission.
* No tax, W2, 1099, benefit, or garnishment record is created.

### G. Bank Reconciliation

1. Accounting Manager creates `ARC Operating Account` with masked account data only.
2. Create manual debit `BTX-CR-001 Manual Bank Clearing`.
3. Match debit to payment batch or payment item.
4. Review/approve match.
5. Create manual credit transaction for Cedar Ridge payment.
6. Match credit to cash receipt.
7. Review/approve match.
8. Open/resolve exception variant.
9. Ignore/archive transaction variant.

Required assertions:

* Matching does not create payment execution.
* Matching does not create cash receipt.
* Matching does not create payment application.
* Matching does not update invoice balance.
* Matching does not create accounting export.

### H. Accounting Export

1. Accounting Manager creates `AEX-CR-001 Accounting Export`.
2. Add source items from supported source types where seeded:
   * invoice
   * cash receipt
   * payment application
   * contractor payable
   * payroll run
   * payment batch
   * bank transaction or reconciliation match
3. Review mapping status.
4. Edit mapping fields.
5. Generate status-only.
6. Submit/start/approve.
7. Mark submitted manually.
8. Mark accepted manually.
9. Mark failed variant.

Required assertions:

* Accounting Export does not mutate source records.
* Generate does not call QuickBooks/ERP.
* Mark submitted does not call external accounting API.
* No GL entry, journal, tax filing, payment, bank transaction, accounting close, or file download is created.

## Required Confirmation

Product must confirm that Cedar Ridge Fiber Expansion is the approved canonical demo story before seed or browser test implementation.
