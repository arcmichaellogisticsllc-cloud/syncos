# Payment Failure Runbook

## Symptoms

- Partner payment attempt failed or returned.
- Payable remains eligible and unpaid.

## Checks

- Payment instruction status.
- Attempt history and idempotency key.
- Payable eligibility and customer cash allocation.
- Confirm live automated payments are disabled for rc1.

## Safe Actions

- Do not resubmit live payment automatically.
- Record review outcome through certified P13 controls.
- Keep Customer AR and Partner AP separate.

## Escalation

Finance lead and release engineer.

## Data Safety

Do not log bank data or provider confidential values.

## Verification

No duplicate payment effect; payable and instruction states reconcile.
