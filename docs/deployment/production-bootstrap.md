# Production Bootstrap

## Purpose

Create only the configuration needed for the first SyncOS production tenant. Do not load demo customers, partners, work orders, production records, invoices, or payments.

## Required Operator Inputs

- tenant legal/display name;
- first internal admin email;
- territories;
- capabilities;
- production codes;
- rate code catalog;
- policy versions;
- scheduler intervals;
- public inquiry tenant ID;
- email sender;
- payment mode.

## Sequence

1. Run migrations through `059_syncfield_coil_commercial_policy.sql`.
2. Create Sync tenant.
3. Create internal admin user and role memberships.
4. Seed only canonical role/permission/catalog data required by the app.
5. Add production territories and capabilities.
6. Add production codes and rate code catalog.
7. Set policy versions for P14/P15/P16 decision support.
8. Configure `PUBLIC_PARTNER_INQUIRY_TENANT_ID` to the production tenant.
9. Configure email sender and verified domain.
10. Set `LIVE_AUTOMATED_PARTNER_PAYMENTS=false`.

## Safety

Do not run `seed:e2e-demo` against production. Demo/test data belongs only in disposable validation or staging environments.
