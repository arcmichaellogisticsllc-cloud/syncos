# Hostinger VPS Architecture

## Responsibility Boundary

| Platform | Responsibility |
|---|---|
| Squarespace | Domain registration, authoritative DNS for `synccommsystems.com`, renewal, WHOIS/privacy, mail DNS records |
| Hostinger website hosting | Public marketing website for `synccommsystems.com` and `www.synccommsystems.com` |
| GitHub | SyncOS source, website source, release branch, deployment source, CI evidence |
| Hostinger VPS | SyncOS web, API, worker, reverse proxy, TLS, optional local Postgres, optional local Redis, private file storage, logs, backups |

The root website remains on Hostinger website hosting. Do not point `synccommsystems.com` or `www.synccommsystems.com` at the SyncOS VPS.

## Target Staging Topology

```text
synccommsystems.com
  Squarespace DNS
  -> Hostinger public website hosting

staging-app.synccommsystems.com
  Squarespace DNS
  -> Hostinger VPS public IP
  -> Nginx/Caddy
  -> 127.0.0.1:3138 syncos-web

staging-api.synccommsystems.com
  Squarespace DNS
  -> Hostinger VPS public IP
  -> Nginx/Caddy
  -> 127.0.0.1:3137 syncos-api

syncos-worker
  Hostinger VPS private process only

Postgres
  Hostinger VPS localhost/private only for staging, or managed Postgres if selected later

Redis
  Hostinger VPS localhost/private only for staging, or managed Redis if selected later

Private files
  Hostinger VPS private filesystem for staging, backed up off-server
```

## Observed VPS

- Hostname: `srv1818105`
- Public IPv4: `2.25.82.68`
- OS: Ubuntu 24.04.4 LTS
- Kernel: Linux 6.8.0-134-generic
- CPU: 2 vCPU
- RAM: 7.8 GiB
- Swap: none
- Disk: 96 GiB ext4 root, 3% used during audit
- Runtime: Node 20.20.2, npm 10.8.2, Git 2.43.0
- Reverse proxy: Nginx 1.24.0
- Database: PostgreSQL 16.15, bound to localhost/IPv6 loopback
- Redis: 7.0.15, bound to loopback
- Current app services: `syncos-api`, `syncos-web`, `syncos-worker`

## Current VPS Caveats

- Deployed SyncOS commit is `1e0694b472268190084d125262e81555ad61ce1d`, not the local release candidate.
- Current Nginx TLS certificate is for `staging.jacksontelcom.com`, not `staging-app.synccommsystems.com` or `staging-api.synccommsystems.com`.
- Current API runs with `NODE_ENV=production` based on `/health/startup`.
- Current startup health fails because required permission and role seed rows are missing.
- SSH currently allows root login and password authentication.
- No swap is configured.
- Redis AOF persistence is off.
- No SyncOS-specific DB/file off-server backup job was found.

## Process Model

Use systemd-managed Node services for the current Hostinger VPS. The server already uses this model cleanly:

- `syncos-web`
- `syncos-api`
- `syncos-worker`
- `postgresql@16-main`
- `redis-server`
- `nginx`

Do not introduce Docker Compose on the same host unless intentionally replacing the systemd model. Mixing Docker and native services would make ports, logs, backups, and rollback harder to reason about.

## Isolation Rules

- Web, API, and Worker remain separate processes.
- Worker has no public route.
- Postgres and Redis must remain private/localhost only.
- Only SSH, HTTP, and HTTPS should be publicly exposed.
- Staging and production must use separate env files, databases, Redis namespaces or instances, file roots, logs, services, and domains.
- Suggested roots:
  - `/opt/syncos/staging`
  - `/opt/syncos/production`
  - `/etc/syncos/staging`
  - `/etc/syncos/production`

## Capacity Classification

The observed VPS is sufficient for controlled staging.

It is likely sufficient for an initial controlled production pilot only if:

- staging and production are isolated;
- DB and files are backed up off-server;
- logs and releases are rotated;
- swap is added;
- SSH is hardened;
- monitoring and alerting are active;
- public traffic remains limited.

For durable production, a second VPS or managed Postgres/object storage should be preferred. A single VPS is a single point of failure for app, API, worker, DB, Redis, files, and logs.
