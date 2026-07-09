# Staging Architecture Decision Record

## Status

Proposed - pending Mike approval.

## Context

SyncOS has passed local release validation and operator UI/UAT readiness work. Staging is not deployed. The next step is an approved architecture for a controlled staging environment that supports tenant-specific users, smoke testing, and UAT without creating production commitments or external integrations.

## Decision Needed

Select the architecture for the first controlled staging environment.

## Options Considered

- Managed split deployment.
- Single VPS/container host.
- Platform bundle.

## Recommended Architecture

Recommended:

- Web service.
- API service.
- Worker/background service.
- Managed Postgres.
- Provider-managed secrets.
- Provider-managed logs.
- Provider-managed backups where available.
- No external integrations.
- No production data.
- Staging-only tenant and users.

## Service Model

### Web

Serves the Next/Web app. Uses `NEXT_PUBLIC_API_BASE_URL` for browser API calls and `SYNCOS_API_BASE_URL` where server-side web routes need the API base URL.

### API

Runs the Node API service, connects to staging Postgres through `DATABASE_URL`, uses a strong unique `AUTH_JWT_SECRET`, and keeps `ALLOW_DEV_HEADER_AUTH=false`.

### Worker

Runs the background worker service if required by the current app. It should use the same staging database and relevant queue/runtime environment. If no staging jobs are active yet, record the worker as deployed idle or explicitly deferred with Mike approval.

### Database

Use managed Postgres with backups enabled. Do not copy production data without explicit written approval. Do not run `seed:e2e-demo` against shared staging unless the environment is deliberately demo-only.

## Rejected / Deferred

- Production deployment.
- External integrations.
- Real bank, payment, payroll, accounting, tax, QuickBooks, ERP, GL, or payment processor connections.
- VPS-first architecture unless Mike approves the added operations burden.

## Consequences

- Faster staging setup and lower operations burden.
- Provider dependency for logs, secrets, deploys, and backups.
- Separate secrets per service must be coordinated carefully.
- Web, API, worker, and database versions must be tracked together.
- Database rollback remains a separate backup/restore decision.

## Open Questions

- Provider selection.
- Staging URL/subdomain.
- Staging DB provider.
- Tenant/admin bootstrap mechanism.
- UAT user creation method.
- GitHub Actions cloud status.
- Backup/restore drill timing.

## Approval Gate

No deployment may begin until Mike approves:

- Provider.
- Database.
- Domain/subdomain.
- Secrets process.
- Bootstrap method.
- UAT user plan.
