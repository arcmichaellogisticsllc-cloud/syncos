# SyncOS controlled pilot plan

## Scope and baseline

Use the existing staging demo workspace to prove both Sync employee and Partner crew workflows. Preserve the demo accounts, records, evidence and history. Do not reset, reseed, bulk-delete or create a production tenant as part of this checklist.

Before a run, record the staging URL, deployed commit, workspace/tenant, actor roles, selected record IDs and expected results. Label any new synthetic records PILOT. Keep test passwords, tokens and private file contents out of the evidence log. Rehearse destructive tests in an isolated database.

Select a Sync crew and a Partner crew, with a distinct work order for each execution path. Include Operations, Customer QC and Finance reviewers. Keep `LIVE_AUTOMATED_PARTNER_PAYMENTS=false`.

## Readiness

For Sync employees, verify an active employee account, Sync crew membership, assigned foreman, explicit work assignment and management clearance with evidence and expiry. Check that a hold or expired clearance blocks new production. Employee work must not require a Partner agreement or generate Partner settlement debt.

For Partner crews, verify company approval, worker credentials, crew readiness, agreement/work-order execution, mobilization and production-start authorization as separate gates. Partner Admin access alone must not grant foreman execution authority.

For both crews, verify the assigned map revision, roster and work area. When the foreman has multiple work assignments, require an explicit selection. Complete the daily JSA before recording production.

## Field acceptance checklist

- Sign in as each role and check the server-selected workspace.
- Use a phone-sized screen to select an assignment, review the map and complete JSA.
- Record quantities, units, asset/span identifiers and evidence; submit the report.
- Confirm the foreman cannot view customer rates, Sync margins or payment controls.
- Retry a submission after a lost response and confirm there is one persisted result.
- Test loss/reconnect after loading SyncField. Record cold-start offline behavior separately; existing replay coverage does not certify it.
- Record Customer QC requiring a correction. Resubmit the permitted fields and verify the original revision remains unchanged.
- Retry the correction with the same request identifier: expect the same result and no duplicate revision or inspection cycle.
- Record customer reinspection and final acceptance, including partial acceptance and zero accepted quantity.
- Export the report and compare reported, accepted and pending quantities with the source records.

## Financial acceptance

Trace customer-accepted quantities through billable items and invoices. Internal QC or a field submission alone must not establish customer acceptance. Check duplicate conversion attempts and quantity/unit reconciliation.

Existing demo finance records remain available for review. Older examples without a recorded customer decision cannot advance through the tightened billing gates until their prerequisites are satisfied. Use the accepted-production workflow for a complete financial rehearsal; do not bypass those gates to make an older example advance.

For Partner work, verify settlement and payable eligibility before recording a simulated external payment with sample proof in staging. Confirm a retry cannot duplicate the recorded payment and an overpayment fails. Verify Partner views omit customer economics and private internal proof details.

For employee work, verify customer billing while keeping payroll separate from Partner settlements. Do not send money or contact customers during the staging rehearsal.

## Permissions and operational checks

Verify cross-tenant, cross-Partner and unassigned-work requests fail. Review Command Center recommendations and confirm that reviewers still control awards, assignments and approvals.

Record release checks, service health and backup/restore evidence separately from user acceptance. Passing automated tests does not establish real-device acceptance by a crew member.

## Evidence and exit criteria

For each scenario record workforce type, role, record IDs, expected result, actual result, evidence reference, severity and retest result. Classify untested paths as untested.

Close confirmed pilot blockers, rerun their regression scenarios and reconcile the complete workflow for both crews. A Sync foreman and Partner foreman must then complete a supervised walkthrough on their actual devices before broader field rollout. Preserve the demo workspace for repeatable proof and training.
