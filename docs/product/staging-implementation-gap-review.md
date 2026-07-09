# Staging Implementation Gap Review

## Audit Findings

- Existing readiness docs are present under `docs/product/staging-*` and `docs/product/tenant-admin-bootstrap-runbook.md`.
- Existing static staging checker is `scripts/check-staging-readiness.js`.
- Existing release validation tooling includes `scripts/check-e2e-certification.js`, `scripts/release-validation.sh`, `npm run release:validate`, and `npm run e2e:ci:release`.
- Existing database scripts include migrate, seed, E2E demo seed, and migration verification.
- Existing operations docs discuss deployment, release, rollback, and production readiness.
- Missing before this planning sprint: provider decision matrix, ADR, final env map, deployment checklist, tenant/admin execution plan, UAT execution packet, approval gate, deployment dry-run plan, and implementation-plan checker.
- Staging DB selection, provider secrets, tenant/admin execution mechanism, persona users, tenant isolation smoke, live staging smoke automation, cloud CI validation, branch protection, and backup/restore drill remain open.
- `seed:e2e-demo` is referenced in E2E and operations docs; it must remain test-only or isolated/demo-only and must not be confused with real shared staging data.

## Gap Review

| ID | Category | Description | Current status | Blocks planning? | Blocks deployment? | Blocks UAT? | Blocks production? | Decision needed | Owner placeholder | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STG-001 | Hosting | Hosting provider decision. | Provider matrix added; approval pending. | No | Yes | Yes | Yes | Mike selects provider. | TBD | Approve managed split or platform bundle. |
| STG-002 | Database | Staging DB provider decision. | Managed Postgres recommended; provider pending. | No | Yes | Yes | Yes | Mike selects DB provider/tier. | TBD | Select managed Postgres with backups. |
| STG-003 | Secrets | Staging secrets setup. | Env map added; provider setup pending. | No | Yes | Yes | Yes | Secrets process approval. | TBD | Configure provider secrets outside repo later. |
| STG-004 | Tenant | Tenant bootstrap mechanism verification. | Execution plan added; mechanism pending. | No | Yes | Yes | Yes | Bootstrap method. | TBD | Prefer secure reset/one-time bootstrap; avoid defaults. |
| STG-005 | Admin | Admin bootstrap mechanism verification. | Execution plan added; mechanism pending. | No | Yes | Yes | Yes | Admin creation method. | TBD | Verify safe method before deployment. |
| STG-006 | Roles | Role/persona user setup. | Persona list added; accounts not created. | No | No | Yes | Yes | UAT user list approval. | TBD | Create after staging admin works. |
| STG-007 | Tenant isolation | Tenant isolation smoke. | Planned only. | No | Yes | Yes | Yes | Smoke procedure and data. | TBD | Run two-tenant smoke after bootstrap. |
| STG-008 | Smoke tests | Staging smoke automation. | Smoke plan exists; live automation pending. | No | No | Yes | Yes | Manual vs automated staging smoke. | TBD | Start manual smoke, automate later. |
| STG-009 | CI | GitHub Actions cloud validation. | Workflows exist; status unverified. | No | No | No | Yes | CI/account availability. | TBD | Verify CI, billing, runners, branch checks. |
| STG-010 | Branch protection | Branch protection. | Not confirmed. | No | No | No | Yes | Required checks policy. | TBD | Configure after CI is reliable. |
| STG-011 | Backup/restore | Backup/restore drill. | Runbook exists; drill pending. | No | No | Yes | Yes | Provider backup approach. | TBD | Run drill after DB provider selection. |
| STG-012 | Mobile/tablet | Physical device review. | Phase 10 smoke passed; physical review pending. | No | No | Yes | Yes | Device coverage. | TBD | Run checklist during UAT. |
| STG-013 | Accessibility | Full contrast/accessibility audit. | Smoke passed; full audit pending. | No | No | Partial | Yes | Audit depth. | TBD | Schedule audit after staging deploy. |
| STG-014 | UAT tracking | Issue tracking process. | UAT packet added; tracker pending. | No | No | Yes | Yes | Tracker/tool owner. | TBD | Select tracker before first UAT. |
| STG-015 | Production | Production deployment remains NO-GO. | NO-GO. | No | No | No | Yes | Future production readiness decision. | TBD | Complete staging and UAT first. |
| STG-016 | Integrations | External integrations remain NO-GO. | NO-GO. | No | No | No | Yes | None for staging. | TBD | Keep integrations disabled. |
| STG-017 | Logs/monitoring | Provider logs/monitoring decision. | Added as planning gap. | No | Yes | Partial | Yes | Provider log/alert approach. | TBD | Confirm provider logs before UAT. |
| STG-018 | Worker | Worker deployment decision. | Added as planning gap. | No | Yes | Partial | Yes | Deploy idle worker or defer. | TBD | Verify worker runtime need before deployment. |

Planning docs are PASS after this sprint. Deployment remains BLOCKED until provider approval. Production remains NO-GO until staging deployment and UAT complete.
