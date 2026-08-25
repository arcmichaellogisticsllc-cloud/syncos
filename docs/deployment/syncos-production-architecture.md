# SyncOS v0.9.0-rc1 Production Architecture

## Baseline

- Application baseline: `7d81be5cd9f4e5be76ebcf34353814c1a95a08d6`
- Release branch: `release/syncos-v0.9.0-rc1`
- Public site baseline: `f2bf5c977cd83464a60cbf5552179bb1cc9ed438`
- Public site branch: `feat/syncos-app-integration-rc1`
- Certified migrations: `001` through `059_syncfield_coil_commercial_policy.sql`

## Runtime Inventory

| Component | Runtime | External dependencies | Classification |
| --- | --- | --- | --- |
| Public website | Static HTML/CSS/JS plus PHP form handler for legacy forms | HTTPS host, optional MySQL/PHP mail for non-partner forms | REQUIRED |
| `apps/web` | Next.js 14 | `SYNCOS_API_BASE_URL`, HTTPS domain, secure env | REQUIRED |
| `apps/api` | NestJS | PostgreSQL, JWT secret, CORS origins, public inquiry tenant, email provider | REQUIRED |
| `apps/worker` | Node long-running process | PostgreSQL, Redis URL for BullMQ health queue, scheduler env | REQUIRED |
| `packages/database` | Node migration/seed/verify scripts | PostgreSQL | REQUIRED |
| Redis | BullMQ health queue connection in worker | Managed Redis with auth/TLS | REQUIRED |
| Private file storage | Restricted local-file adapter in API routes | Durable private volume or object-store replacement before scale-out | REQUIRED |
| Email | P18 invitation delivery | `local_test` for dev/test; `generic_http` or `disabled` in production | REQUIRED |
| Payment provider | P13 local test provider only | Live payout provider not certified | TEST ONLY for live payment execution |
| Queues beyond worker health | No durable domain queue dependency found | None | NOT USED |

## Minimum v0.9.0-rc1 Topology

```text
synccommsystems.com
  public website host
  |-- Become a Partner -> POST https://api.synccommsystems.com/partner-invitations/public-inquiries
  `-- Login to SyncOS -> https://app.synccommsystems.com/login

app.synccommsystems.com
  Next.js web runtime
  `-- server-side proxy via SYNCOS_API_BASE_URL

api.synccommsystems.com
  NestJS API runtime
  |-- PostgreSQL private network
  |-- Redis private network
  |-- private restricted file storage
  `-- transactional email provider

worker
  Node worker runtime on private network
  |-- PostgreSQL
  `-- Redis
```

## Hosting Recommendation

Use a split architecture:

| Surface | Recommendation | Reason |
| --- | --- | --- |
| Public website | Existing website host if it supports HTTPS, PHP for legacy forms, and static asset caching | The website is separate and lightweight. |
| Web/API/Worker | Production app platform with separate services for Next.js, NestJS API, and always-on worker | SyncOS needs long-running API and worker processes, environment secrets, restart policy, logs, and private networking. |
| PostgreSQL | Managed PostgreSQL 15+ or 16 with SSL, backups, monitoring, and point-in-time recovery if available | The app is database-centered and requires reliable migrations/backups. |
| Redis | Managed Redis only for the worker queue/health dependency | Required by current worker startup. |
| Files | Private durable storage volume for single-region pilot; object storage adapter is recommended before multi-instance scale-out | Current implementation uses restricted file paths with authorization at API read time. |

Do not force API/worker onto a basic shared hosting plan. The authenticated app requires an always-on Node runtime, worker process, env secrets, logs, TLS, and managed database connectivity.

## Component Detail

| Component | Purpose | Network exposure | Persistence | Credentials | Backup | Monitoring | Failure impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Public site | Marketing, service requests, partner interest | Public HTTPS | Source repo plus optional PHP/MySQL submissions | Host deploy token, optional DB/mail creds | Website source and form submissions | Uptime, 4xx/5xx | Inquiry and marketing entry degraded |
| Web app | Authenticated UI | Public HTTPS | None | `SYNCOS_API_BASE_URL` | Artifact rollback | Uptime, page 5xx | Users cannot access UI |
| API | System of record access | Public HTTPS, restricted CORS | PostgreSQL and files | DB, JWT, email, storage | DB/files | Health, 5xx, latency | Core workflow outage |
| Worker | Scheduled derived refreshes | Private only | PostgreSQL derived snapshots | DB, Redis, storage if needed | DB/files | Worker heartbeat, scheduler failures | Expiration, intelligence, command snapshots stale |
| PostgreSQL | Canonical database | Private network only | Durable database | app and migration roles | Automated backup plus restore test | CPU, storage, locks, connections | Platform unavailable/data risk |
| Redis | Worker queue/health | Private network only | Provider-managed | Redis auth/TLS | Provider policy | connections, errors | Worker health queue degraded |
| Private files | Evidence/artifacts | API only | Durable restricted files | storage credentials | file backup | storage errors | evidence/export access degraded |
| Email | Invitations | Provider API only | Provider logs | email API key | template/config source | delivery failures | invites cannot be delivered |

## Public/Internal Boundaries

- Public website may submit only Partner Inquiry JSON to P18. It cannot choose tenant, organization, role, user, or storage identifiers.
- Partner inquiry creates only `partner_inquiries` with low-confidence unverified capacity signal.
- Login and invitation acceptance remain in SyncOS, not the public website runtime.
- Recommendation layers P14/P15/P16 do not award, assign, pay, or change lifecycle.

## Release Status

Repository-side architecture, production guardrails, CI updates, and documentation are complete for staging preparation. External provider provisioning, DNS, backup restore tests, email provider credentials, and monitoring accounts remain operator actions before a controlled pilot.
