# Disable Payment Execution Runbook

## Symptoms

- Provider issue.
- Payment fraud/safety concern.
- Configuration uncertainty.

## Checks

- `LIVE_AUTOMATED_PARTNER_PAYMENTS`.
- Payment provider credentials.
- Recent payment attempts.

## Safe Actions

- Set `LIVE_AUTOMATED_PARTNER_PAYMENTS=false`.
- Revoke/remove live provider credentials from runtime.
- Continue tracking payables and manual review.

## Escalation

Finance lead, system admin, release engineer.

## Data Safety

Disabling payment execution must not delete payable, settlement, invoice, or cash records.

## Verification

No live provider calls occur; P13 views continue to show state.
