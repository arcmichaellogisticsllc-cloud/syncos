# Staging Readiness Plan

## Baseline

- Current baseline commit: `ba85b7d04f2545c9ae7096312293948e05b8581b`
- Current maturity: local release E2E is green, operator UI phases 1B-10 are complete, UAT docs exist, and staging has not been deployed.
- GitHub Actions cloud status must be verified separately before it is used as staging evidence, especially if account, billing, runner, or repository settings are blocked.

## Objective

Create a controlled environment for Mike, the team, and internal operators to test SyncOS with tenant-specific users and controlled staging/demo data.

## What Staging Is For

- Operator UAT.
- Role and permission validation.
- Workflow comprehension.
- Tenant isolation smoke testing.
- Smoke testing and demo rehearsal.
- Data model feedback before production readiness planning.

## What Staging Is Not For

- Production customers.
- Real money movement, real payroll, bank connectivity, payment processing, QuickBooks, ERP, GL posting, tax filing, or accounting close.
- Live customer communications.
- Uncontrolled public access.

## Audit Findings

- Existing operations docs cover deployment, release, rollback, and production readiness, but there was no dedicated staging readiness package.
- Existing scripts are `scripts/check-e2e-certification.js` and `scripts/release-validation.sh`.
- Database scripts are `migrate.js`, `seed.js`, `seed-e2e-demo.js`, and `verify-migrations.js`.
- `.env.example` existed but needed staging-safe placeholders and explicit disabled dev-session defaults.
- `db:seed` currently creates Jackson Telcom baseline tenant, roles, permissions, and `admin@jackson-telcom.local` using a local development password hash. This is not a final real staging admin bootstrap.
- `seed:e2e-demo` is deterministic certification/demo data and must not be run against shared staging unless the environment is explicitly demo-only.
- Header auth is controlled by `ALLOW_DEV_HEADER_AUTH`; developer session UI is controlled by `NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL`.
- Staging implementation planning now has a provider decision matrix, ADR, deployment checklist, final env map, tenant/admin execution plan, UAT execution packet, approval gate, dry-run plan, and static implementation-plan checker.

## Readiness Checklist

| Area | Status | Notes |
| --- | --- | --- |
| Repo baseline confirmed | PASS | Baseline commit listed above. |
| Local release gate | PASS | Phase 10 reported 576/576. |
| Environment variables defined | PARTIAL | Placeholders documented; provider secrets not configured. |
| Staging database selected | NOT STARTED | Provider decision required. |
| Migration path defined | PASS | Use `npm run db:migrate` after backup/snapshot. |
| Base/system seed policy | PARTIAL | `db:seed` is safe for local baseline but staging bootstrap must avoid default local admin password. |
| E2E/demo seed policy | PASS | Test-only unless staging is explicitly demo-only. |
| Tenant bootstrap | PARTIAL | Schema known; mechanism still needs approval. |
| Admin bootstrap | PARTIAL | Must not use committed default password. |
| Roles/personas defined | PASS | UAT personas are documented. |
| Backup/restore | PARTIAL | Runbook created; provider drill pending. |
| Smoke tests | PARTIAL | Plan and static checker exist; live staging smoke waits for deployment. |
| UAT scripts | PASS | Operator UAT and demo scripts exist. |
| Rollback/reset path | PARTIAL | Runbook guidance exists; provider commands pending. |
| Known blockers | PASS | Tracked in staging readiness gap backlog. |
| Implementation planning package | PASS | Planning package is provider-ready and approval-ready; deployment remains pending. |

## GO / NO-GO Summary

Staging readiness is **PARTIAL**. Local certification and planning are strong, and the implementation planning package is ready for Mike approval. Actual staging deployment, secrets, database provider, tenant/admin bootstrap execution, backup drill, and cloud validation remain open. Production readiness is **NO-GO** until staging deployment and UAT complete.
