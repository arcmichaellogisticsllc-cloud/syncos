# Staging Provider Decision Matrix

Purpose: compare staging deployment approaches before any cloud service, database, DNS, or secrets are created. Final provider selection requires Mike approval before provisioning.

## Option A - Managed Split Deployment

Example shape: Web on Vercel or equivalent, API on Render/Railway/Fly.io or equivalent, Worker as a background service, database on managed Postgres.

| Factor | Assessment |
| --- | --- |
| Complexity | Medium. Separate service ownership and environment coordination are required. |
| Operational burden | Low to medium. Hosting providers handle build, deploy, logs, and rollback primitives. |
| Estimated cost category | Low to medium for staging, depending on always-on API/worker and database tier. |
| Scaling path | Strong. Web, API, worker, and database can scale independently. |
| Security implications | Good if provider-managed secrets, least-privilege DB credentials, and disabled dev auth are enforced. |
| Secrets management | Provider-managed secrets per service. No committed env files. |
| Managed backups | Available through managed Postgres provider. Must be enabled and verified. |
| Logs/monitoring | Provider logs per service; may need a later centralized view. |
| Rollback path | Roll back web/API/worker deploys independently; database rollback requires backup restore decision. |
| Staging fit | Strong fit for controlled UAT with realistic service separation. |
| Later production fit | Good fit if operational ownership and monitoring mature. |
| Risks | Cross-provider env drift, split deploy mismatch, worker omission, provider-specific networking surprises. |
| Open questions | Final vendors, staging URL, DB provider, worker process model, backup cadence. |

## Option B - Single VPS / Container Host

Example shape: Web/API/Worker on one VPS or container host, managed Postgres preferred, local Postgres only if cost constraints outweigh operations burden, reverse proxy, SSL, and process manager or Docker Compose.

| Factor | Assessment |
| --- | --- |
| Complexity | Medium to high. More direct server administration is required. |
| Operational burden | High. Patching, SSL, process supervision, logs, rollback, and security hardening need active ownership. |
| Estimated cost category | Low fixed cost, but higher engineering operations cost. |
| Scaling path | Limited initially; service separation and horizontal scale require additional work. |
| Security implications | Higher risk unless server access, firewall, secrets, backups, and patching are disciplined. |
| Secrets management | Host/container secrets. Must avoid shell history and committed files. |
| Backup burden | Managed Postgres reduces DB burden; local Postgres makes backup/restore Mike/team-owned. |
| Monitoring/logging burden | Mostly self-managed unless a provider log service is added. |
| Rollback path | Requires deploy artifact discipline and DB backup restore procedure. |
| Staging fit | Acceptable only if cost/control constraints dominate. |
| Later production fit | Not recommended without stronger ops process. |
| Risks | Server drift, missed patches, weak rollback, manual SSL/logging/backups, single-host blast radius. |
| Open questions | VPS owner, access policy, backup target, process manager, SSL automation, deploy packaging. |

## Option C - Platform Bundle

Example shape: Railway/Fly/Render-style platform with Web service, API service, Worker service, managed Postgres, provider-managed secrets, and provider logs.

| Factor | Assessment |
| --- | --- |
| Complexity | Low to medium. One provider reduces coordination. |
| Operational burden | Low. Service provisioning, secrets, logs, and deploys are consolidated. |
| Estimated cost category | Low to medium for staging; can rise with always-on services and managed database tier. |
| Scaling path | Good for staging and early production if the selected platform supports separate service scale. |
| Security implications | Good if secrets are provider-managed and public/private env separation is enforced. |
| Secrets management | Provider-managed secrets in one platform. |
| Managed backups | Often available for managed Postgres, but retention and restore workflow must be confirmed. |
| Logs/monitoring | Provider logs in one place; advanced alerting may be deferred. |
| Rollback path | Usually straightforward for app services; DB rollback still requires backup planning. |
| Staging fit | Strong fit for first controlled staging because setup is simpler. |
| Later production fit | Good if provider reliability, backup, and observability meet requirements. |
| Risks | Provider lock-in, platform limits, hidden networking/build assumptions, backup feature differences. |
| Open questions | Selected platform, region, database backup plan, worker scheduling, custom domain support. |

## Recommendation

For first controlled staging, prefer either:

- Managed split deployment with managed Postgres, or
- Platform bundle with managed Postgres.

Avoid a single VPS unless cost or control constraints outweigh the extra operations burden.

Final provider selection is not made in this document. Mike must approve the provider, database, domain/subdomain, secrets process, and bootstrap method before provisioning begins.
