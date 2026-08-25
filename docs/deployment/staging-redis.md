# Staging Redis

Staging Redis is a managed instance used for queue and worker connectivity tests. It must not share production keyspace or credentials.

## Required Configuration

- `REDIS_URL=<provider secret>`
- Prefer `rediss://` with authentication when the provider supports TLS.

## Provisioning Rules

- Create a dedicated staging Redis instance.
- Enable auth/TLS.
- Do not reuse production Redis or production credentials.
- Configure worker and API services with the same staging Redis URL where queue health requires it.

## Worker Connectivity

The worker starts BullMQ on queue `syncos.foundation` and scheduled scans for:

- mobilization expiration
- Partner performance recalculation
- opportunity capacity matching
- executive command refresh

Schedule variables are listed in `.env.staging.example` and documented in `docs/deployment/worker-schedules.md`.

## Verification

- Worker service starts and remains running.
- Worker logs show `SyncOS worker listening on syncos.foundation`.
- API `/health/startup` reports Redis reachable.
- Scheduler logs show successful scans or safe zero-work scans.
