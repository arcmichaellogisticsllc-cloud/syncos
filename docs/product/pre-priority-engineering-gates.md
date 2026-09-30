# Engineering gates before Priority automation

User-confirmed order, 2026-09-29. These requirements supplement the operating model and supersede any interpretation that the September 29 acceptance checks established full field readiness. Preserve existing application scope, both workforce types, and demo data. Priority automation remains disabled.

## 1. Safety and authorization

Required: version safety records when location or conditions change; record each worker's own acknowledgment with identity, time and revision; require applicable pre-bore approval; apply stops to affected crews and work locations, including queued offline requests; require applicable approval before restart.

Current local candidate: individual authenticated JSA acknowledgments, pre-bore approval/revocation, conservative crew/work-order shutdown enforcement and ordered utility/Safety/Operations restart approvals are implemented. See `docs/acceptance/safety-authorization-20260929.md`. Physical-phone acceptance and older administrative correction pathways remain open; this candidate is not yet deployed.

Acceptance: an old acknowledgment cannot satisfy a new revision; a foreman cannot acknowledge for another person; absent/unauthorized pre-bore approval blocks affected work; offline replay rechecks current stops and approval scope; releasing one stop does not remove another applicable hold. Test both workforce types and physical devices.

## 2. Complete field evidence

Required: required formats and practical sizes, retained original bytes, capture details, duplicate-safe retries, and distinct missing/readable/submitted/accepted evidence states.

Current local candidate: approved and pinned requirement revisions, explicit readability review, capture details, original preservation and selected customer-accepted evidence are implemented. Supported formats include JPEG/PNG/HEIC/HEIF/PDF/MP4/MOV up to 20 MiB. See `docs/acceptance/field-evidence-20260929.md`. Larger resumable uploads, actual-phone suspension and historical financial-source advancement remain open.

Acceptance: missing or unreadable mandatory evidence blocks the relevant handoff; late evidence attaches to the correct work/revision without rewriting the original; interrupted upload and resend preserve one original file and an accurate status.

## 3. Production quantity integrity

Required: immutable correction history and one authoritative installed quantity per work item. Date conflicts, overlapping summaries and quantity subsets require explicit reconciliation.

Acceptance: 886 installed feet including 180 rock feet remains 886 installed feet. Rock is a classified subset, not another 180 installed feet. Any premium is a separately approved commercial item linked to the same underlying work. Replaying or importing an overlapping summary cannot increase installed quantity. Historical records remain unchanged when corrections supersede them.

Current local candidate: immutable quantity reviews, stable work-item identity, included-subset and summary relationships, correction-aware source fingerprints and finance/acceptance gates are implemented. The combined 29-check workflow run passed. See `docs/acceptance/production-quantity-20260929.md`. The September 30 candidate also preserves administrative corrections, uses current reviewed quantities in work-order/partner summaries, and verifies export staleness from its original query and source fingerprint. Geometric overlap still requires source review.

## 4. QC through customer acceptance

Required: versioned prime-specific deadline policy and clear ownership through finding, correction, evidence, review and customer acceptance. Internal QC does not authorize billing.

Current local candidate: migration 076 and the customer-QC UI support approved prime-policy revisions, original event timing, time zones, explicit holiday calendars and responsible foreman identity. Failed findings remain recorded when deadline prerequisites are missing. Existing scheduled deadlines do not change with later policies. See `docs/acceptance/correction-deadlines-20260930.md`; actual policy coverage, legacy parity, reassignment and escalation remain unverified.

Acceptance: deadlines retain the policy/version, triggering event, timezone/calendar and responsible owner. Escalations do not silently close findings. Corrected evidence must be reviewed; only the applicable customer decision authorizes accepted quantities for finance. Do not invent a prime deadline when its policy is unavailable.

## 5. Contract-driven financial calculations

Required: approved relationship-specific rates, effective periods, payment triggers, retainage and authorized exceptions. PKS Net 14 begins with invoice acceptance, not invoice creation.

September 30 financial-completion candidate: approved immutable rate/term revisions replace the Net 30 default. Invoice acceptance starts pending, and an acceptance-triggered due date stays empty until a verified customer invoice event. The legacy invoice path also has no invented default date. Existing invoices remain intact and require accepted-work/approved-pricing provenance before advancement. Calendar-day terms are supported; business-day clauses and nonstandard exceptions still require a specified implementation and acceptance test before use. See `docs/acceptance/financial-completion-20260930.md`.

Acceptance: an unaccepted PKS invoice has no fabricated acceptance date; recording actual invoice acceptance calculates its contractual due date. Rejection/resubmission follows the approved policy without silently resetting or inventing terms. Preserve historical invoices; use explicit reviewed correction rather than bulk rewriting due dates.

## 6. Billing packets and delivery receipts

Required: prime-specific package templates and completeness checks; separate generation, delivery, rejection, resubmission and acceptance records. A field report, export or generated invoice alone is not proof of package delivery or acceptance.

Acceptance: immutable packet versions reference the accepted work, rates, required evidence and invoice. Delivery records identify destination, time and receipt/proof. Rejected packets retain their history; resubmission creates a traceable version. Actual acceptance is an explicit authorized event, available as a contractual due-date trigger.

## 7. Reconciliation and payment controls

Required: trace accepted work to customer invoices and separately to partner earnings; handle duplicate/partial payments, holds, adjustments and unmatched events. Sync employee production must not generate partner settlements.

Current evidence: partner lineage/amount guards, serialized external payment recording, durable observation review, duplicate protection and recovery replay tests exist. They do not certify live Passport authentication, account/payee mapping, provider status semantics or production automation.

Acceptance: each payment allocation has an eligible source and cannot exceed its remaining amount. Conflicts/returns and unmatched observations stay reviewable. No money moves from an observation. Customer receipts and partner payments remain separate. Known legacy demo payables remain preserved and blocked where lineage is missing; provider automation must exclude demo records.

## Evidence and signoff

For each gate record the governing requirement/policy, actor, prerequisites, stored facts, UI behavior, successful workflow, prohibited action, adverse/retry case and actual test result. Mark implemented, verified, partial and untested separately. See `docs/acceptance/pre-payment-20260929.md` for the scoped checks already performed. Those results remain valid for their stated scenarios, but none waives the requirements above.

Complete in this order. Do not enable Priority automation until the required gates and supported-device acceptance are signed off with evidence.
