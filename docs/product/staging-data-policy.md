# Staging Data Policy

## System Seed Data

System seed data includes roles, permissions, workflow definitions, status catalogs, and other safe baseline records. `db:seed` may be allowed only after confirming it will not create live staging admin credentials from local-development defaults.

## Demo / E2E Data

Demo/E2E data includes test personas, fake organizations, fake transactions, fake invoices, and fake lifecycle records. `seed:e2e-demo` is test-only unless the staging environment is explicitly demo-only.

## UAT Data

UAT data is manually created by operator testers. It should be labeled staging/demo, avoid real PII unless approved, and avoid real bank, payroll, payment, tax, or confidential production financial data.

## Prohibited Data

Do not store these in staging without explicit written approval:

- Real bank credentials.
- Real payroll credentials.
- Real payment processor credentials.
- Real SSNs.
- Real tax forms.
- Real account/routing numbers.
- Real payment card data.
- Real confidential production customer financials.

## Seed Policy

- `db:seed`: allowed for system/catalog bootstrap only after admin credential implications are reviewed.
- `seed:e2e-demo`: test-only and isolated; never target shared staging traffic data unless intentionally demo-only.
- Destructive E2E: never target shared staging DB.

## Reset Policy

Staging data may be reset. Schedule UAT around reset windows and back up before reset when preserving findings or manually created data matters.

## Labeling

All staging data must be treated as staging/test data in UI walkthroughs, docs, issue logs, and demo scripts.
