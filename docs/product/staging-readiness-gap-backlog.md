# Staging Readiness Gap Backlog

| ID | Category | Description | Risk | Owner | Blocks staging | Blocks UAT | Blocks production | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STG-001 | Hosting | Hosting provider decision is not made. | No deploy target. | TBD | Yes | Yes | Yes | Select provider for API/web/worker. |
| STG-002 | Database | Staging database provider decision is not made. | No persistent staging data. | TBD | Yes | Yes | Yes | Select managed Postgres provider. |
| STG-003 | Secrets | Staging secrets setup is pending. | Secrets may be misconfigured or leaked. | TBD | Yes | Yes | Yes | Configure provider secret manager. |
| STG-004 | Tenant | Tenant bootstrap mechanism requires verification. | Wrong tenant or unsafe defaults. | TBD | Yes | Yes | Yes | Approve CLI, SQL, or admin UI method. |
| STG-005 | Admin | Admin bootstrap mechanism requires verification. | Default/insecure admin access. | TBD | Yes | Yes | Yes | Define secure first-admin process. |
| STG-006 | Roles | Role/persona users are not set up. | UAT cannot validate permissions. | TBD | No | Yes | Yes | Create named users per persona. |
| STG-007 | Tenant isolation | Tenant isolation smoke is not run in staging. | Cross-tenant exposure risk. | TBD | Yes | Yes | Yes | Run two-tenant read/mutation denial smoke. |
| STG-008 | Smoke tests | Staging smoke automation is not implemented against live staging. | Regressions missed. | TBD | No | Yes | Yes | Convert smoke plan into provider-safe execution. |
| STG-009 | CI | GitHub Actions cloud validation status needs verification. | Local-only evidence. | TBD | No | No | Yes | Confirm CI/nightly/release workflows pass. |
| STG-010 | Branch protection | Branch protection is not confirmed. | Unreviewed main changes. | TBD | No | No | Yes | Enable required checks on main. |
| STG-011 | Backup/restore | Backup/restore drill is not run. | Recovery unknown. | TBD | No | Yes | Yes | Run restore drill after provider selection. |
| STG-012 | Mobile/tablet | Physical mobile/tablet review is pending. | Operator usability gaps. | TBD | No | Yes | Yes | Run checklist on real devices. |
| STG-013 | Accessibility | Full contrast/accessibility audit is pending. | Accessibility defects. | TBD | No | Partial | Yes | Run audit and prioritize blockers. |
| STG-014 | UAT tracking | UAT issue tracking process is not selected. | Feedback lost. | TBD | No | Yes | Yes | Pick issue tracker and triage cadence. |
| STG-015 | Production | Production deployment remains NO-GO. | Premature launch. | TBD | No | No | Yes | Complete staging/UAT first. |
| STG-016 | Integrations | External integrations remain NO-GO. | Unsafe financial assumptions. | TBD | No | No | Yes | Keep integration work out of staging UAT. |
