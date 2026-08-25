# Staging Provider Requirements

This plan is provider neutral. Do not purchase or deploy from this document alone.

## Required Capabilities

| Component | Required Capability |
|---|---|
| Web | Node/Next.js hosting, HTTPS custom domain, secret manager, build and start commands |
| API | Long-running Node/NestJS service, HTTPS custom domain, secret manager, health checks |
| Worker | Always-on background process, restart policy, secret manager, logs |
| Postgres | Managed PostgreSQL 15+, SSL, backups, restricted credentials |
| Redis | Managed Redis with auth/TLS where supported |
| Storage | Private bucket/container, server-side credentials, checksums, no public listing |
| Email | Transactional HTTP API, domain authentication, delivery status |
| Monitoring | Uptime, logs, metrics, alerts |

## Service Commands

- API build: `npm run build -w @syncos/api`
- API start: `npm run start -w @syncos/api`
- Web build: `npm run build -w @syncos/web`
- Web start: `npm run start -w @syncos/web`
- Worker build: `npm run build -w @syncos/worker`
- Worker start: `npm run start -w @syncos/worker`
- Migration: `npm run release:staging:migrate`
- Synthetic seed: `npm run seed:staging`

## Source

Deploy from `release/syncos-v0.9.0-rc1` at the approved staging-prep commit. Do not deploy from a dirty worktree.
