# SyncOS Release Checklist

## Pre-Deploy

| Gate | Status | Requirement |
| --- | --- | --- |
| DB backup confirmed | PASS WITH LIMITATION | Production operator must confirm PostgreSQL backup and restore test before release. |
| File-store backup confirmed | PASS WITH LIMITATION | Private evidence/export storage must have backup and restore coverage. |
| Env validated | PASS WITH LIMITATION | Required env includes `DATABASE_URL`, `AUTH_JWT_SECRET`, `SYNCOS_API_BASE_URL`, private storage config, and worker scheduler config. |
| Migration plan | PASS | Current P17 state adds no migration; current final migration is `054_executive_command_throughput.sql`. |
| Payment provider mode | PASS WITH LIMITATION | `local_test_provider` is certification-only; live payouts require provider production certification. |
| Worker config | PASS WITH LIMITATION | P6/P14/P15/P16 schedules must be enabled with bounded intervals and advisory-lock support. |
| Storage config | PASS WITH LIMITATION | Private artifact storage must be configured before production. |
| Health check | PASS WITH LIMITATION | API, DB, web, and worker health must be checked immediately after deploy. |
| Secrets validation | PASS WITH LIMITATION | No real secrets belong in the repository; production secret injection must be verified externally. |

## Deploy

1. Confirm no release blockers and no unresolved cross-tenant or cross-Partner leaks.
2. Confirm database backup and private file-store backup.
3. Disable live payment execution unless provider certification is complete.
4. Run migrations through `054_executive_command_throughput.sql`.
5. Deploy API.
6. Deploy worker with P6/P14/P15/P16 scheduled jobs.
7. Deploy web with `SYNCOS_API_BASE_URL`.
8. Confirm no automatic award, assignment, payment, or lifecycle mutation is enabled by recommendation layers.

## Post-Deploy

| Area | Check |
| --- | --- |
| Health | API health, DB connectivity, web route load, worker startup. |
| Login | Internal executive, operations, finance, Partner Admin, Partner Foreman. |
| Partner portal | Company, compliance, workers, crews, agreements, work orders, mobilization. |
| Field map | Authorized map loads; unauthorized map denied. |
| JSA | Foreman can complete JSA; sensitive fields absent. |
| Production | Daily report create/review/submit; offline replay while app is open. |
| Customer QC | Pending, accepted, correction, reinspection lineage. |
| Finance | Accepted production, billable, invoice, cash, settlement, payable; Customer AR / Partner AP separation. |
| Payments | Payment instruction local/test mode disabled for production unless live-certified; no real ACH from release smoke. |
| Command Center | Snapshot, top actions, blockers, drill-through, stale-data indicator. |
| Worker schedules | P6/P14/P15/P16 logs show bounded locked scans. |
| Logs | No Worker PII, bank data, provider confidential values, raw storage paths, or auth tokens. |

## Rollback / Incident

| Action | Guidance |
| --- | --- |
| App rollback | Roll back API/web/worker artifact using deployment platform controls. |
| Migration caution | Do not destructively roll back data-bearing migrations without a database recovery plan. |
| Disable workers | Stop worker processes or disable schedule env to prevent derived refresh churn during incident response. |
| Disable payment execution | Keep payment execution disabled unless provider production certification is complete. |
| Preserve data | Preserve DB, file artifacts, logs, and event history for investigation. |
| Restore strategy reference | Restore from verified PostgreSQL and private file-store backups when data recovery is required. |

## Go-Live Gates

| Gate | Status | Notes |
| --- | --- | --- |
| SECURITY | PASS | P17 security, boundary, persona, and cross-scope validation passed. |
| DATA | PASS WITH LIMITATION | Backup/restore is an operational prerequisite. |
| OPERATIONS | PASS WITH LIMITATION | Certified workflows are ready for limited production with manual operational oversight and production user acceptance. |
| FIELD | PASS WITH LIMITATION | closed-browser cold-start offline app shell is not supported. |
| QC | PASS | P10/P11/P17 QC lineage and export checks passed. |
| FINANCE | PASS WITH LIMITATION | Certified AR/AP, billing, cash, payable, and payment-boundary flows passed; no full GL/accounting package. |
| PAYMENTS | PASS WITH LIMITATION | Live payout provider certification required; `local_test_provider` is test-only. |
| INTELLIGENCE | PASS | P14/P15/P16 recommendation layers passed and do not automatically award, assign, pay, or mutate lifecycle. |
| OBSERVABILITY | PASS WITH LIMITATION | Production log/alerting setup must be confirmed by operator. |
| BACKUP | PASS WITH LIMITATION | DB and file-store backup are required prerequisites. |
| SUPPORT | PASS WITH LIMITATION | Support ownership and incident runbook must be active for broader rollout. |

## Release Modes

- INTERNAL PILOT READY: available after all P17 validation passes and operator prerequisites are accepted.
- LIMITED PRODUCTION READY: available after P17 passes with live payouts disabled or separately certified, backup confirmed, and manual oversight in place.
- FULL PRODUCTION READY: requires live payment provider production certification and production observability/backup signoff.
- NOT READY: applies if any blocker remains.
