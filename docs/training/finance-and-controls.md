# Finance and controls: click-by-click training

Updated for the financial handoff repair on 2026-09-25. **Evidence: source-reviewed procedures, not a claim that each click was executed in a browser.** Use the accompanying verification report for observed test results. New repairs made during the audit may supersede a finding below.

## Before the session

1. Sign in with the named internal account assigned to the exercise. Confirm the training tenant and record names with the supervisor.
2. Open **Finance**. If a module is absent, ask the supervisor to verify the account's actual permissions. Job titles alone do not establish access.
3. Use designated pilot records or an isolated test environment. Do not void, archive, overwrite, or settle shared demo records to practice.
4. Record each starting ID, amount, quantity and status. After each save, reopen the same record and compare the result. Capture the displayed error when an operation fails.
5. Use customer-accepted quantities for financial exercises. Internal QC, submission, settlement readiness, payment readiness and actual payment are separate facts.

Both workforce types can generate customer billing. Sync employee production must not generate partner settlement or contractor debt. Foremen do not receive these finance controls. Partner administrators use their company-scoped portal views rather than these internal workbenches.

**Current payment rule:** an authorized finance operator may record a payment that completed externally with proof. The future Passport connection will automate that recording after sandbox validation. Selecting `passport` as a method does not connect to Passport or send funds.

## F01. Review the finance position

**Entry:** `/finance`; dashboard access. Downstream links also require the destination permission.

1. Open **Finance Command Center**.
2. Read settlement conversion, cash conversion, AR aging and payment states.
3. Click **Review Billables**, **Open Invoices**, or **Record Cash** to enter the appropriate workbench. These links navigate; clicking them does not create a record.
4. In **Cash control**, open Billables, Invoices, Cash receipts or Collections. In **Partner payment control**, open Settlements, Contractor payables, Payments or Accounting exports.
5. Confirm the heading and customer/partner before taking an action.

**Result:** review and navigation only. Empty metrics are not proof that a source workflow completed.

## F02. Review accepted production and coil commercial policy

**Entry:** `/accepted-production-financials`; `billing.read`. Saving policy additionally requires `billing.create_billable` and authorized work-order choices. Organization selection requires `organization.read`.

1. Open **Accepted Production Financials**.
2. Review **Customer Revenue Chain** and **Partner Payable Chain** separately.
3. Under **Coil Commercial Policy**, choose **Work order**.
4. Leave **Counterparty organization** at “Use the work order customer or partner” unless the authorized contract identifies a specific matching counterparty.
5. Choose **Party**: Customer or Partner. Choose **Treatment**: Unconfirmed, Billable as footage, Included in route rate, Separate pay item, or Non-billable.
6. Set **Coil type**, **Easement**, **Effective From**, **Source type**, **Source Reference**, and **Notes** from the approved written instruction. For Separate pay item, choose **Separate production item**.
7. Click **Save Coil Policy** once. Confirm “Coil policy saved.” and the version/source in the policy list. Review **Coil Commercial Review** below it.
8. If choices fail, click the relevant **Retry work order choices**, **Retry organization choices**, or **Retry production items**. A failed save preserves entries. If the page says the policy saved but the list needs refreshing, refresh before attempting another save.

### Complete the accepted-production financial handoff

Open the numbered sections under **Complete the financial handoff**. A section appears only when your account has its action permission. Named choices come from current tenant records. Start with verified customer acceptance; field submission and internal QC are not sufficient.

1. Expand **1. Convert accepted production**. Select **Accepted production**, verify the code and accepted quantity, then click **Create billable** (`billing.create_billable`). A missing rate creates a finance-review exception, not a completed billable. Correct the authorized rate source before proceeding.
2. Expand **2. Create customer invoice**. Choose **Customer billable**, enter **Retainage percent**, **Billing period start**, and **Billing period end**, then click **Create customer invoice** (`billing.create_invoice`). This canonical path creates an approved invoice under that permission. Confirm its reference and amount. This does not send it to the customer.
3. Expand **3. Record customer cash received**. Choose **Invoice identifying the paying customer**, enter **Amount received**, **Receipt date**, **Receipt method**, and **Customer bank/payment reference**, then click **Record customer receipt** (`cash_receipt.record`). This establishes receipt only.
4. Expand **4. Confirm customer cash cleared**. Select **Uncleared customer receipt**, verify actual bank clearance, check the confirmation, then click **Confirm cash cleared** (`cash_receipt.record`). Do not use this step for a pending deposit.
5. Expand **5. Apply cleared cash to invoice**. Choose **Invoice receiving cash**, then a **Matching cleared receipt**. Only cleared receipts for that customer are offered. Enter **Amount to apply**, then click **Apply cleared customer cash** (`payment_application.create`). Confirm the invoice balance and receipt remainder. A retry with unchanged fields reuses its request key rather than applying twice.
6. For partner work only, expand **6. Create partner settlement**. Choose **Unsettled partner production**, then click **Create partner settlement** (`partner_settlement.create`). Sync employee production is excluded. A changed acceptance or an already-settled source is rejected.
7. Expand **7. Create partner payable**. Choose **Partner settlement awaiting payable**, then click **Create partner payable** (`contractor_payable.create`). The payable remains separate from payment eligibility.
8. Expand **8. Calculate payment eligibility**. Choose **Partner payable**, then click **Calculate payment eligibility** (`contractor_payable.calculate_eligibility`). Read the resulting eligible amount/status; cleared customer allocations govern the calculation.
9. Open **external payments, retainage and adjustments** to record a genuinely completed external payment or handle a controlled release/review.

The forms retain inputs on failure, show results, and block repeated clicks while saving. **Refresh financial records** reloads choices. After an uncertain result, verify current records before retrying. Customer billing covers Sync and partner production; employee payroll remains the separate F10 workflow. These controls process one selected source per action; the older workbench Create buttons remain distinct operations.

## F03. Prepare a billable candidate

**Entry:** `/billable`; `billable_item.read`. Creation: `billable_item.create`; editing: `billable_item.update`.

1. Open **Billable Workbench**. Select a queue or search/filter for the designated work.
2. Click **Open Detail** on an existing candidate, or **Create Billable Candidate** for a new designated exercise.
3. On create, select **QC Review** and enter the supported billing context: **Billable Quantity**, **Rate Code ID**, **Rate Description**, **Rate Source**, **Rate Confidence**, acceptance/documentation fields and retainage context. Use approved values; an override field is not ordinary data entry.
4. Click **Create Billable Candidate**. Reopen the candidate from the list if navigation returns there.
5. Review readiness, blockers, accepted quantity, rate and net amount in **Billable Detail**.
6. For an authorized correction, click **Edit Billable Item**, change supported fields, then **Save Billable Item**. **Cancel** returns without saving.
7. Click **Recalculate Readiness**, review the dialog, and confirm with its action button.
8. When blockers are resolved, click **Mark Ready For Settlement**, enter **Approval note**, then confirm. This action needs `billable_item.mark_ready`.

**Result:** a billable readiness record. It does not create the settlement or invoice by itself. Do not use this as evidence that the accepted-production API conversion was exercised.

**Branches:** Place Hold → enter Hold reason/note → confirm; Release Hold → Release note → confirm; Dispute → Dispute reason/note → confirm; Resolve Dispute → Resolution note → confirm. Void and Archive each require their own permission, reason and deliberate confirmation. Inspect the refreshed status after the dialog closes.

## F04. Assemble and review a settlement

**Entry:** `/settlements`; `settlement.read`, then action-specific permissions.

1. Click **Create Settlement**. Select **Customer Organization**, **Capacity Provider**, **Project**, and relevant **Work Order ID**. Set **Settlement Type**, period, **Invoice Cycle**, and **Pay Cycle**.
2. Click **Create Settlement**. Open the resulting detail.
3. Click **Add Settlement Item** (`settlement.add_item`). Select **Billable Item**, **Item Type**, quantity, unit rate, contractor rate and retainage from the approved source. Click **Submit**.
4. Review gross billable amount, contractor payable amount, deductions, retainage and margin. Click **Recalculate Readiness**, then **Submit** in the dialog.
5. Click **Submit Review** → **Submit**. The assigned reviewer clicks **Start Review** → **Submit**.
6. The authorized approver clicks **Approve**, enters **Approval Note**, and clicks **Submit**. Use **Reject** with a rejection reason/note when the source fails review.
7. When authorized and valid, click **Mark Invoice Ready** or **Mark Payable Ready**, enter **Ready Note**, and click **Submit**. Each has a separate permission.
8. Reopen detail and confirm state and source links. Readiness does not create downstream records or prove payment.

**Other paths:** Edit Settlement → Save Settlement; Place Hold/Release Hold; Dispute/Resolve Dispute; Void/Archive. On an item row, Void/Archive applies to that item and requires `settlement_item.*`. Supply the displayed reason/note and use **Submit**. Do not turn employee work into partner debt through this older workbench.

## F05. Assemble, review and mark an invoice sent

**Entry:** `/invoices`; `invoice.read`. Create requires `invoice.create`.

1. Click **Create Invoice**. Choose **Customer Organization**, applicable **Settlement** and **Project**; enter **Invoice Date**, **Due Date**, **Payment Terms**, billing period, currency and supported acceptance/package/documentation fields.
2. Click **Create Invoice** and open detail.
3. Click **Add Invoice Item** (`invoice.add_item`). Choose the correct **Settlement Item**; verify quantity, rate, description and any approved adjustment, tax or fee. Click **Submit**.
4. Click **Recalculate Totals** → **Submit**. Confirm amount, balance and source lineage.
5. Click **Submit Review** → **Submit**. An approver uses **Approve**, **Approval Note**, **Submit**, or **Reject** with reason/note.
6. Click **Mark Sent** to open **Invoice packages and customer responses** with this invoice selected. Prepare and download the complete package. After actual external delivery, choose its package revision and record the event time with UTC offset, customer recipient, receipt reference and notes; verify the receipt and submit the delivery event. A note alone cannot mark an invoice sent. No email is sent by these controls.
7. Use **Mark Ready For Cash Application**, enter **Ready Note**, then **Submit** when the workflow allows it.
8. Reopen and verify status, delivery state and balance.

**Recovery and branches:** Edit Invoice → Save Invoice for allowed edits; Dispute/Resolve Dispute with reasons; Void/Archive only on approved training records. Invoice item Void/Archive is separate. Do not mark sent merely to make a test pass.

## F06. Record and apply customer cash

**Entry:** `/cash`; `cash_receipt.read`. Receipt creation uses `cash_receipt.create`; application uses `cash_receipt.apply`.

1. Click **Create Cash Receipt**.
2. Enter **Gross Received Amount**, **Payment Date**, **Customer**, payer, method, **Payment Reference**, **External Transaction ID** where available, **Currency**, **Evidence Reference** and notes. Use the actual receipt evidence.
3. Click **Create Receipt**. Review receipt detail and unapplied amount.
4. Click **Apply To Invoice**. Select the matching customer invoice, application amount/type and supported note/override fields. Confirm the amount does not exceed receipt availability or invoice balance. Click **Submit**.
5. Verify applied/unapplied amounts and the linked invoice balance. Click **Open Payment Applications** from the cash workbench to review applications; open the designated application detail.
6. If an application was wrong, an authorized operator opens **Void Application**, supplies **Void Reason** and note, and clicks **Submit**. Recheck both balances before applying again.

**Other paths:** Edit Receipt → Save Receipt; Archive receipt/application with a reason; Void receipt only when backend constraints permit. Voiding an application and voiding a receipt are different operations.

**Boundary:** this screen records customer money and allocations. It does not collect funds. The accepted-production cash-clearing endpoint is a separate API operation with no button on the accepted-production dashboard at this candidate. Do not equate a receipt's existence with cleared cash or partner eligibility.

## F07. Work a collection case

**Entry:** `/collections`; `collection_case.read`; create/update and each action require their respective permissions.

1. Click **Create Collection Case**, choose **Invoice**, enter notes, and click **Create Collection Case**.
2. Open detail. Review balance, age, risk, next action and existing promise/dispute context.
3. Click **Assign Owner**, choose the owner offered by the form, add **Assignment Note**, and click **Submit**.
4. Click **Add Action**, choose **Action Type**, enter **Action Date**, due/follow-up dates, contact method and note as appropriate, then **Submit**.
5. Use **Add Promise-To-Pay Action** for a customer promise with the supported promise amount/date fields. Record the conversation; a promise does not apply cash.
6. Use **Open Collection Actions**, open the designated action, click **Complete Action**, enter **Outcome**, **Note**, and follow-up date if required, then **Submit**.
7. An authorized operator uses **Close Case**, enters **Close Reason** and note, then **Submit** when resolved.

**Additional documented actions:** Add Dispute Opened/Updated/Resolved, Add Escalation Requested/Approved, and Add Write-Off Review Requested. Each records a collection event; write-off review does not itself write off an invoice. Edit Case → Save Case updates supported context. Cancel Action requires its reason/note. Archive Case or Archive Action preserves its own record context. The queue's **Complete Due Action** shortcut selects the due-action queue; it does not complete an action on its own.

## F08. Prepare contractor payables

**Entry:** `/contractor-payables`; `contractor_payable.read`. These are external partner obligations only.

1. Click **Create Contractor Payable**.
2. Choose **Payable Type**, **Payable Party Type**, **Capacity Provider**, applicable crew/project/settlement, pay-cycle dates, due date and approved compliance/tax context.
3. Click **Create Contractor Payable** and open detail.
4. Click **Add Payable Item** or **Add Item From Settlement Item**. Choose **Settlement Item**, verify quantity, **Contractor Rate**, retainage and description, then **Submit**.
5. Click **Recalculate Totals** → **Submit**. Review net amount, compliance, tax documents, holds and disputes.
6. Click **Submit Review** → **Submit**. Reviewer: **Start Review** → **Submit**. Approver: **Approve**, **Approval Note**, **Submit**, or **Reject** with reason/note.
7. Click **Mark Payment Ready**, enter **Ready Note**, then **Submit** when authorized and eligible. Confirm the resulting state; this is not a completed payment.

**Other paths:** Edit Payable → Save Payable; Place Hold/Release Hold; Dispute/Resolve Dispute; Void/Archive with reasons. Item rows offer Edit, Void and Archive through separate item permissions. A compliance blocker, unpaid customer invoice or unresolved acceptance issue must be corrected at its source.

## F09. Record a completed external partner payment

**Entry:** `/payment-retainage-adjustments`. Internal payment data requires `partner_payment.execute`; recording additionally requires `partner_payment.confirm`. Retainage and adjustment reviewers can enter with their respective `retainage.release` or `financial_adjustment.create` permission and see only their authorized sections. Partner-only payment readers use their scoped partner portal. No extra execution authority is granted to read-only users.

1. Open **Payment, Retainage, Adjustments**. Review **Eligible**, **In Flight**, **Paid**, **Retained** and **Ready To Pay**.
2. Under **Record a completed payment**, choose **Payable**. If none appears, stop and resolve eligibility; do not create fictitious cash.
3. Enter **Amount**, **Completed date**, **Method**, **Bank/payment reference**, and **Receipt or confirmation reference** from the actual completed payment.
4. Check **I verified that this external payment completed.** only after checking proof.
5. Click **Record payment** once. Wait for **Recording…** to finish.
6. Check **Recorded external payments** for the amount, partner/payable, method/reference, proof and recorder. Recheck remaining eligibility and paid totals.
7. If an error occurs, preserve its message and compare history before resubmitting. A timeout may follow a successful server write. Do not refresh and generate another payment attempt without checking the result.

**Result:** a completed external-payment record. No funds are sent. History shows the most recent 100 entries.

### Retainage release

1. Expand **Request retainage release**. Select **Payable with retained funds**, enter **Release amount**, **Release reason**, and **Release evidence reference**, then click **Request retainage release** (`retainage.release`). The result is pending; no payment was made.
2. Review the evidence and expand **Authorize pending retainage release**. Select **Pending retainage release**, check the authorization statement, then click **Authorize retainage release**. The server rechecks the remaining balance and any payable hold/dispute and creates a separate payable.
3. Check **Release history** and the retained balance. Competing releases cannot authorize more than the remaining amount. Original retainage history remains intact.

### Controlled credit/rebill review

1. Expand **Request credit/rebill review** (`financial_adjustment.create`).
2. Select **Billed production with reduced acceptance**. The choice shows the original and corrected quantities; the current customer decision governs the adjustment.
3. Enter **Adjustment reason** and **Customer decision evidence reference**, then click **Request credit/rebill review**.
4. Check **Adjustment review history** for `review required`. This requests finance review and flags linked partner recovery where applicable. It does not issue a credit note, rebill, overwrite the issued invoice, or send money. Final credit/rebill issuance remains a controlled accounting follow-up; this screen does not claim that follow-up is complete.

## F10. Prepare payroll readiness

**Entry:** `/payroll`; `payroll_run.read`; action-specific `payroll_run.*` and `payroll_item.*` permissions.

1. Click **Create Payroll Run**. Enter **Payroll Run Type**, **Payroll Cycle**, **Payroll Period Start**, **Payroll Period End**, **Pay Date**, and relevant project/crew context.
2. Click **Create Payroll Run**, then open detail.
3. Click **Add Payroll Item**. Choose **Worker**, **Source Type**, **Earning Type**, **Worker Classification**, source work order/production record, work date, units and applicable amount/rate fields. For a manual item, record **Manual Reason** and **Evidence Reference**.
4. Click **Submit**, then review worker/item count and gross, reimbursement, deduction, estimated-tax and net totals.
5. Click **Recalculate Totals** → **Submit**. Resolve compliance, tax-document, hold and dispute blockers.
6. Click **Submit Review** → **Submit**; reviewer **Start Review** → **Submit**; approver **Approve** with note → **Submit**.
7. Click **Mark Payroll Ready**, enter **Ready Note**, and **Submit**. Verify readiness.

**Other paths:** Edit Payroll Run → Save Payroll Run; item Edit/Void/Archive; run Reject, Place Hold/Release Hold, Dispute/Resolve Dispute, Void/Archive. The forms request the corresponding reason/note. This workspace prepares records; it does not remit payroll, file tax returns or establish that a payroll provider received a file.

## F11. Track a payment batch without sending money

**Entry:** `/payments`; `payment_batch.read`. Each operation has its matching `payment_batch.*` permission.

1. Click **Create Payment Batch**. Select **Batch Type**, **Payment Method**, currency and supported scheduling context; click **Create Payment Batch**.
2. Open detail. For contractor source, click **Add Contractor Payable Item** and choose **Payment-Ready Contractor Payable**. For payroll source, click **Add Payroll Item** and choose **Payroll-Ready Payroll Run**. Enter the applicable item, payee and amount fields, then **Submit**.
3. Click **Recalculate Totals** → **Submit**. Verify source, currency, amounts and recipient.
4. Click **Submit Review** → **Submit**, **Start Review** → **Submit**, then approver **Approve** with note → **Submit**.
5. Click **Schedule**, enter **Scheduled Payment Date** and **Schedule Note**, then **Submit**. Scheduling does not move funds.
6. If an external/manual handoff actually occurred, click **Submit Execution**, enter **Submit Note** and **External Reference**, then **Submit**. This is a status/reference operation, not an ACH/wire/check/API submission.
7. Only after external completion, use **Mark Executed**, enter **Execution Reference**, **Execution Note** and supported execution date, then **Submit**. Confirm the recorded state and source evidence. For a failed external attempt use **Mark Failed** with **Failure Reason** and **Failure Note**.

**Recovery:** Edit Batch → Save Payment Batch before lifecycle locks; item Open/Edit/Void/Archive; batch Reject, Cancel, Void or Archive with reason. These older batch states do not substitute for F09's accepted-production external-payment ledger. Avoid recording one payment twice across separate workflows.

## F12. Reconcile a bank record manually

**Entry:** `/bank-reconciliation`; bank account/transaction read permissions plus each mutation permission.

1. Click **Create Bank Account**. Enter **Account Name**, **Account Type**, **Currency**, **Status**, institution and masked account/routing references. Click **Create Bank Account**. Do not put credentials or full bank secrets into notes.
2. Return to the workbench and click **Create Manual Bank Transaction**.
3. Choose **Bank Account**. Verify its populated ID, **Direction**, **Amount**, **Currency**, **Transaction Type**, **Transaction Date** and **Description**. Add posted date, references, method and cleared status from the statement.
4. Click **Create Manual Bank Transaction**, then open its detail.
5. Click **Match Payment Batch**, **Match Payment Item**, or **Match Cash Receipt** according to the source. Choose the source record, matched amount and **Match Reason**, then **Submit**. Matching requires `bank_transaction.match`.
6. For allocation context, select **Payment Application Context** and **Create Context Match**; choose the application and submit. This does not alter invoice balances.
7. Open the resulting reconciliation match. Reviewer: **Review** with note → **Submit**. Approver: **Approve** with note → **Submit**, or **Reject** with reason/note → **Submit**.
8. Return to the transaction. Check active matches, approved matched amount, unmatched amount, variance and exception state.

**Exception path:** Open Exception → Exception Reason/Notes → Submit. After investigation, Resolve Exception → Resolution Note → Submit. Ignore Transaction requires an explanation; it does not delete bank truth. Authorized edits use Edit Account/Transaction → Save. Void/Archive a match and Archive Account/Transaction are separate actions with reasons.

**Limits:** manual entry only; bank feeds, statement import and treasury transfers are not connected by this workflow. The audit repaired the tab’s **Open Match Form** shortcut to require `bank_transaction.match` and disable matching on archived/ignored transactions, matching the header controls. See the verification report for runtime results. A hidden or disabled authorized action should be resolved through account/state review, not another user account's session.

## F13. Prepare an accounting export handoff

**Entry:** `/accounting-exports`; `accounting_export_batch.read`; creation and lifecycle use specific batch permissions.

1. Click **Create Accounting Export Batch**.
2. Select **Export Type**, **Target System**, **Export Format**, period, currency and notes. Click **Create Accounting Export Batch**.
3. Open detail and click **Add Export Item**. Choose **Source Object Type** and **Known Source Object**; verify **Source Object ID**. Choose **Export Item Type** and supply account/entity/item/class/location mapping, amounts, currency, transaction date and memo as appropriate.
4. Click **Submit**. Review item mapping and errors. Use the item **Edit** or **Open** → **Edit Item** to correct supported mapping fields, then **Submit**.
5. Click **Recalculate Totals** → **Submit**. Check debit, credit, total, item count and errors against the intended handoff.
6. Click **Submit Review** → **Submit**, **Start Review** → **Submit**, and approver **Approve** with note → **Submit** (or Reject with reason).
7. Click **Generate**, enter **Generate Note**, and **Submit** when allowed. Review status/file-reference metadata. Generation here does not guarantee a downloadable file or call an accounting API.
8. After a real external handoff, click **Mark Submitted**, enter **External Batch Reference** and **Submit Note**, then **Submit**.
9. After external acknowledgement, use **Mark Accepted** with **Acceptance Note**, or **Mark Failed** with **Failure Reason/Failure Note**. Confirm state and references.

**Other paths:** Edit Batch → Save Accounting Export Batch; item Archive; batch Cancel or Archive with reason. Source links open the source record when available. The workflow does not post general-ledger entries, file tax, complete an accounting close or establish a QuickBooks/Sage/NetSuite integration.

## F14. Train on Passport simulation

**Entry:** Finance → **Passport Reconciliation** (`/passport`); `partner_payment.confirm`.

1. Open **Passport reconciliation** and read **Simulation preview · Live connection disabled**.
2. Review **Connection status**: sandbox awaiting approval/setup, automatic recording disabled, never connected, payment sending disabled.
3. Under **Payment review**, select **Show payments**: All examples, Needs review, Recorded in simulation, Pending completion, or Duplicates ignored.
4. Type a partner name or provider reference in **Search examples**. Confirm the displayed example count changes.
5. Click **Review details for [reference]** on a card. Read its reason and finance guidance. Click the same disclosure again to collapse it.
6. For an empty result, click **Clear filters**. Confirm the search clears and the complete example list returns.
7. If the preview fails to load, click **Retry preview** after connectivity is restored.

**Result:** simulated display/filtering only. There is no Connect, Sync Now, Resolve, Match, Record or Send Payment control in this preview. “Recorded in simulation” is an invented example, not a persisted payment. Live exception resolution remains dependent on integration wiring and sandbox certification.

## Supervisor completion record

For each F01–F14 exercise, record actor, actual permissions, tenant, device/browser, starting record/status/amount, clicks attempted, resulting record/status/amount, evidence reference, and outcome: **observed pass**, **blocked**, **not exercised**, or **not available in UI**. Test permission denials with a designated read-only account and repeat the essential field-to-finance handoff for both crew types. Do not mark this chapter “passed” based on source review alone.

## Source trace

- Page and form labels: `apps/web/app/{finance,accepted-production-financials,payment-retainage-adjustments,passport}/page.tsx` and each finance domain's `*-workspace.tsx`.
- UI action visibility: `apps/web/app/access-control.tsx`, `operator-navigation.tsx`, `intelligence/api.ts`.
- Accepted-production path: `apps/api/src/routes/accepted-production-financials.controller.ts` (distinct conversion, cash clearing, allocation, settlement and eligibility endpoints).
- External records/Passport preview: `apps/api/src/routes/payment-retainage-adjustments.controller.ts`.
- Older lifecycle paths: billable, settlement, invoice, cash application, collections, contractor payable, payroll, payment execution, bank reconciliation and accounting export route controllers.
- Business boundary: `docs/product/syncos-operating-model.md`. Current user direction supersedes older manual-only future-payment text: prepare automatic Passport recording, keep connection disabled pending sandbox certification.

## Approved agreements and billing packages — candidate update, September 30

These controls are in the financial-completion candidate. Check the deployed release before following this section on staging. Demo records with missing acceptance or agreement provenance remain preserved and blocked; do not approve invented facts to make them progress.

### Approve the governing commercial terms

1. Sign in with contract review and update authority. Open **Accepted Production Financials**.
2. In **Approved agreement terms**, choose the customer's or partner's **Agreement rate schedule**. If none is listed, link an active rate schedule to its executed contract first.
3. Compare the displayed rates with the signed agreement and approved pricing addendum. Choose **Customer** or **Partner contractor**.
4. Select the actual **Payment clock starts at** event. Choose calendar or business days and enter the day count, retainage, effective work dates and the agreement time zone. For an agreement requiring Net 14 from invoice acceptance, choose **Invoice acceptance** and enter **14**. Do not choose invoice issue as a substitute.
5. Enter a reference to the executed source. Check the verification box only after checking it, then click **Approve agreement revision**.
6. Confirm the revision appears in **Approval history**. Existing invoices retain their original terms. Changed terms require another reviewed revision; approval does not rewrite history. Business-day clauses, unusual exceptions and partial-payment timing arrangements require finance review before use; do not approximate them with a different trigger.

### Create and prepare a customer invoice

1. Complete field evidence, quantity review, customer correction/reinspection and customer acceptance for either workforce type.
2. Open **1. Convert accepted production**, select the accepted production, and submit.
3. Open **2. Create customer invoice**, select the billable, and submit. Prices and retainage come from the approved agreement. Invoice creation does not mean customer invoice acceptance.
4. In **Invoice packages and customer responses**, select the new invoice.
5. Open **Review prime package requirements**. Enter each additional required document on its own line and the prime's requirements source. Verify and approve. Leave the list empty only when the prime requires no additional documents.
6. For each listed requirement, open **Attach reviewed billing document**, choose its type and original PDF, open/read the document yourself, confirm readability, and attach it. The additional PDF limit is 20 MiB per document. Original accepted field evidence is included automatically.
7. Open **Prepare complete invoice package** and click **Prepare package**. Resolve missing evidence, pricing or document errors. Preparation is limited to 100 MiB of original attachments; split larger invoices into accepted-work groups.
8. Download the numbered package revision. It contains a printable invoice, machine-readable manifest, accepted-work references and original evidence/documents. Check any prime-specific cover sheet, certification or required invoice PDF before delivery. Package generation does not send email or prove receipt.

### Record delivery, rejection, resubmission and acceptance

1. Deliver the reviewed package through the prime's approved channel.
2. Open **Record customer delivery**, select the revision actually sent, enter the actual timestamp with time-zone offset, recipient, receipt reference and notes; verify and save.
3. If rejected, open **Record customer rejection** and record the actual response. Preserve the rejected version. Correct the required documents or invoice through the authorized workflow, prepare the current complete package, deliver it, and use **Record resubmission**.
4. When the prime accepts the invoice, open **Record customer invoice acceptance**, select the delivered revision and record the actual acceptance evidence. Internal QC or field-report acceptance is not an invoice receipt.
5. Check **Delivery and acceptance history** and **Payment due**. The due date starts only at the approved trigger. Repeated submission with the same request identity does not create another event.

### Partner payments and historical exceptions

1. Employee work follows customer billing and employee compensation; it must not create partner settlements.
2. For partner work, create the settlement and payable from accepted sources tied to the governing partner agreement and approved partner prices.
3. If the partner's agreement uses invoice issue/delivery/acceptance, record the verified event in **Record a partner invoice payment trigger**. A customer-payment trigger comes from cleared, allocated customer receipts instead.
4. Run **8. Calculate payment eligibility**. Review amounts, holds, source trace and timing before recording any externally completed payment.
5. Keep Priority automation disabled pending sandbox and account/payee certification. Unmatched or conflicting external observations stay in review; they do not create payments.
6. Historical demo transactions without the required lineage remain reference examples. Use the complete field-to-finance path for pilot transactions. Never fabricate customer acceptance or backdate an agreement to release a legacy payable.

## Agreement calendars, precise rates and partial funding

Candidate update: October 1, 2026 UTC. Use only after this candidate is activated in the designated environment.

1. Open **Accepted Production Financials**, then **Approved agreement terms**. Choose the contract-linked schedule and compare every displayed rate with the executed pricing addendum. Rates display four decimal places; monetary totals round to cents after quantity extension.
2. Choose the agreement party and actual payment trigger. Enter the approved number of days and choose **Calendar days** or **Business days (Monday–Friday)**. For business days, enter the applicable holiday dates and **Holiday calendar verified through**. An empty holiday list means no additional holidays; it is not a default national calendar. A due date beyond the verified horizon is blocked.
3. For partner agreements, choose the **Customer funding basis** explicitly. Gross accepted customer amount leaves customer retainage unfunded; customer invoice net of retainage can fund the partner's net payable when that net customer invoice is cleared. Only select the rule supported by the executed agreement. This choice does not release the partner's own retainage.
4. Confirm the effective work dates, time zone, retainage and source reference. Check the verification box only after reviewing the actual executed agreement and pricing. Click **Approve agreement revision** and confirm the saved revision in approval history. Existing invoices and payables keep their approved snapshots.
5. Record actual customer receipts, clearance and invoice allocation. Click **8. Calculate payment eligibility** for the partner payable. In **Partner payment installments**, select that payable and inspect each funded amount and due date. Separate cleared allocations keep separate payment clocks.
6. Recalculate after new receipts, reversals or allocations. The displayed schedule is a dated eligibility snapshot. Paid amounts are applied earliest-due-first for displaying outstanding installments; this is not a bank allocation instruction. Changed source facts hide the outdated installment schedule and block payment advancement. Recalculate eligibility to produce a fresh schedule before payment review. Recording a partial payment advances the payable’s next outstanding due date; fully paid schedules have no outstanding due date.
7. If an older invoice/payable has no approved terms or accepted-work link, stop advancement and refer it for documented reconciliation. Preserve its original amount, dates and evidence. Do not invent acceptance, overwrite pricing or reuse a newer agreement to release it.

The system supports Monday–Friday business days with an explicitly approved holiday list. Other week definitions, special payment cutoffs, bespoke grace periods and nonstandard rate precision require review before approval. Passport automation remains disabled pending sandbox acceptance.

## Saved Passport preparation — connection disabled

1. Open **Finance → Passport Reconciliation**. The simulation uses invented examples; **Saved integration preparation** is separate persistent setup data.
2. An authorized administrator can enter sandbox customer/account reference identifiers and click **Save account references**. Enter identifiers only, never credentials. Saved accounts remain disabled.
3. Under **Approve a transaction mapping**, select the prepared account and partner payable. Enter the verified transaction/payee references, exact two-decimal USD amount and verification evidence. Confirm the verification checkbox, then click **Approve mapping**. The server checks accepted-work lineage and rejects conflicts. Review the saved **Approved transaction mappings**. This saves an immutable mapping; it does not post money or certify a live provider connection.
4. Under **Review exceptions**, inspect the reference and reason, enter **Review findings**, then click **Record review**. This records an audit-backed finding; it does not post or reverse money.
5. **Refresh jobs** shows persistent preparation work. No provider scheduler, verified webhook adapter or automatic financial posting is enabled. Real provider acceptance requires the approved sandbox.

## Retained-fund releases — candidate added October 4, 2026

These steps describe the local candidate. They do not authorize an actual payment or certify an executed agreement.

1. Open **Payment Retainage Adjustments** with release permission. Under **Request retainage release**, select the original payable, enter the retained amount, reason, and closeout evidence reference, then submit.
2. An authorized contract reviewer opens the same page and selects the request under **Approve retained-fund payment terms**. Choose the retained-fund trigger and day calculation from the executed agreement, enter the days and time zone, and cite the clause. For business days, supply the verified holiday calendar and its coverage date. For a trigger other than release approval, enter the completed event time with its UTC offset and evidence reference.
3. Check the verification acknowledgment and select **Approve retained-fund terms**. Approval is recorded separately from authorization. Do not use ordinary invoice terms as a substitute for missing retained-fund terms.
4. A release-authorized user selects the approved request under **Authorize pending retainage release**, acknowledges review, and submits. The server checks remaining retained funds and accepted-work provenance, then creates a separate payable and payment schedule. The original retained amount and history remain visible.
5. After a payment has actually completed outside SyncOS, use **Record a completed payment**, selecting the separate release payable. Enter amount, completed date, method, reference, and proof, then acknowledge verification. This records the payment; it sends no money.
6. Refresh and inspect the recorded payment before attempting another entry. The same submission may be retried after a lost response. Remaining installments must use their own actual payment references. A source hold, changed source, or excess amount blocks advancement and requires review.

Local API checks cover partial and full payment, duplicate retry, source holds, competing release authorizations and overpayment rejection. Physical-device acceptance and deployment of these changes remain outstanding.
