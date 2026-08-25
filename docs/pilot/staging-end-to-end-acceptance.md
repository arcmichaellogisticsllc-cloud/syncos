# Staging End-to-End Acceptance

Run this only against external staging using synthetic data.

## A. Public / Acquisition

1. Open `https://synccommsystems.com`.
2. Use Become a Partner or the controlled staging-equivalent inquiry path.
3. Submit a synthetic Partner inquiry.
4. Verify SyncOS creates an inquiry only, not an invitation or approval.

## B. Sync Admin

1. Sign in at `https://staging-app.synccommsystems.com/login`.
2. Open Partner Network.
3. Assign owner.
4. Record contact/conversation.
5. Qualify the inquiry.
6. Send invitation to an allowlisted staging recipient.

## C. Partner Admin

1. Receive staging invite.
2. Open secure invite link on the staging app domain.
3. Activate account and set password.
4. Login.
5. Complete onboarding/readiness items with synthetic data.

## D. Internal Approval

1. Internal user reviews onboarding.
2. Verify missing items are visible.
3. Approve only when readiness is complete.

## E. Execution

1. Create or verify Project `STAGING-ARL019-DEMO`.
2. Create or verify Work Order `STAGING-WO-001`.
3. Upload synthetic map/print.
4. Prepare design segments.
5. Assign crew/work.
6. Verify mobilization/start authorization.

## F. Foreman / SyncField

1. Foreman logs in and lands at `/syncfield/today`.
2. Select active assignment if multiple.
3. Complete JSA.
4. Open map.
5. Record pole observations.
6. Record input/output ticks.
7. Complete redline span.
8. Record coil/slack.
9. Enter reported production.
10. Test offline queue by disconnecting after app load, recording field work, reconnecting, and confirming single replay.
11. Submit.

## G. Customer QC

1. Internal user reviews completeness.
2. Customer QC accepts, partially accepts, or requests correction.
3. If correction is requested, Foreman resubmits through existing correction flow.

## H. Commercial

1. Configure customer coil policy.
2. Configure Partner coil policy independently.
3. Confirm field coil truth remains separate from commercial treatment.
4. Confirm accepted production remains required for financial effect.

## I. Finance

1. Generate BillableItem from accepted production.
2. Create invoice.
3. Record synthetic cash receipt.
4. Apply cash.
5. Generate Partner settlement.
6. Generate contractor payable.
7. Confirm payment eligibility only.
8. Confirm no live payout execution.

## J. Intelligence

1. Review Partner performance.
2. Review capacity intelligence.
3. Review Command Center actions and blockers.
4. Confirm recommendations do not execute operational changes.
