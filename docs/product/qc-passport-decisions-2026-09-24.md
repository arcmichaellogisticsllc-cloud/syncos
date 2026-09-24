# QC and Passport decisions — September 24, 2026

## User-approved direction

QC Manager findings may trigger a correction request when work fails QC. A request records the finding/reason and preserves separate correction, reinspection, customer acceptance and financial eligibility stages.

External payments are to be recorded automatically using the Priority Passport API. This supersedes manual recording as the intended end state. Interpret this request as importing/verifying payments made externally; it does not authorize initiating transfers. The existing manual proof mechanism remains available until a real integration is configured and verified. Demo data must remain intact.

## Implemented in this candidate

QC Managers with `qc_review.request_correction` may request corrections through the QC-review endpoint. Project and Operations Manager access remains. Required reasons and existing tenant/permission checks remain. The general production correction endpoint's authority is unchanged; this approval concerns QC findings.

## Passport implementation prerequisites and contract

Code inspection found readiness metadata, external payment recording and a local test provider, but no production Passport adapter. Official Treasury documentation describes customer-scoped webhook subscriptions, event subscriptions and BASIC/HMAC authentication configuration:
https://docs.prioritycommerce.com/pce-product-hub/reference/treasury-api-create-webhook

Before connecting an account, establish its exact Passport product/program, sandbox access, authentication contract, event payloads, signature validation and authoritative transaction lookup/status semantics. Do not invent event names or equate a submitted/processing event with a completed payment.

The integration must map provider account and payee references to the correct tenant and payable; verify amount and currency; persist provider provenance and an audit trail; deduplicate webhook deliveries and polling results; handle out-of-order events, returns and reversals; and queue unmatched/ambiguous transactions for review. Use authoritative provider evidence instead of fabricating uploaded proof or a human recorder. Preserve approval and cash eligibility controls; unexpected externally completed payments need reconciliation rather than silent loss or bypass of those controls.

Live automated payment initiation remains disabled. No provider keys, subscriptions, external requests that change account state, shared records or deployments were changed for this decision. Actual API access and sandbox evidence remain prerequisites to claiming automated recording works.

## Verification

API build passed. Five focused regression tests passed: restored QC fields, QC Manager correction request with required reason and no billable/approved quantity, read-only denials, and Operations/Field Supervisor production boundaries. Evidence: `/private/tmp/syncos-qc-policy-tests.log`. These are local synthetic tests; staging was not changed. The earlier 822-test run predates this focused authority change.
