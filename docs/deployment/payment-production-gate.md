# Payment Production Gate

## Current Certified State

- Financial logic is certified through P13-P17.
- Local/test payment submission is certified.
- Live automated payout provider is not certified.

## Required Production Mode

Set:

```bash
LIVE_AUTOMATED_PARTNER_PAYMENTS=false
```

Production startup validation requires this value until a live payout provider is certified.

## Allowed in Initial Production

- Track settlement.
- Track contractor payable.
- Track eligibility.
- Track payment due and status.
- Record completed external payments through `/payment-retainage-adjustments`, with the actual date, method, payment reference, proof reference and explicit confirmation. Amounts are limited to the eligible unpaid balance after pending instructions. Retries are idempotent.
- Review the most recent 100 recorded payments and their proof references; Partners see their own payment references and updated balances without internal proof references.
- Manually review failed/returned payment states.

## Not Allowed in Initial Production

- Automatic ACH submission.
- Live payment rail calls.
- Silent provider fallback from test to production.
- Treating submission as paid without confirmation.

## Live Payment Certification Prerequisite

Before enabling live payouts, certify provider credentials, sandbox/live separation, idempotency keys, webhook signatures, failure/return handling, audit redaction, and rollback/disable procedures.
