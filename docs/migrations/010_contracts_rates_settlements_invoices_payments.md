# 010 Contracts, Rates, Settlements, Invoices, Payments

## Purpose

Represent commercial terms and the financial lifecycle from rates through payment.

## Tables

- `contracts`: agreements with customers, providers, or partners.
- `contract_parties`: organizations and roles on a contract.
- `rate_schedules`: named collections of rates.
- `rates`: unit prices, minimums, modifiers, and effective dates.
- `settlements`: provider payment calculations.
- `settlement_lines`: settlement detail lines.
- `invoices`: customer invoices.
- `invoice_lines`: invoice detail lines.
- `payments`: payment receipts and disbursements.
- `payment_applications`: allocation of payments to invoices or settlements.

## Key Relationships

- `contracts.tenant_id` references `tenants.id`.
- `contract_parties.contract_id` references `contracts.id`.
- `rate_schedules.contract_id` references `contracts.id`.
- `rates.rate_schedule_id` references `rate_schedules.id`.
- `settlements.contract_id` references `contracts.id`.
- `invoices.contract_id` references `contracts.id`.
- `payment_applications.payment_id` references `payments.id`.

## Notes

- Include currency, effective date windows, tax handling, and status fields.
- Keep immutable posted financial records separate from editable drafts.
