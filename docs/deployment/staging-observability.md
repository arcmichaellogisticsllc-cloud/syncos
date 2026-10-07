# Staging Observability

Staging should use hosted logs and metrics before controlled pilot.

## Minimum Monitors

- web uptime: `/login`
- API uptime: `/health`
- API startup health: `/health/startup`
- API 5xx rate
- worker process health
- DB connectivity
- Redis connectivity
- email delivery failures
- private storage failures
- scheduler failures

## Logging Rules

Logs may include:

- service name
- timestamp
- `NODE_ENV=staging`
- request/correlation ID
- safe tenant/entity IDs
- error class and safe message

Logs must not include:

- passwords
- JWTs
- invite tokens
- private storage credentials
- database URLs with passwords
- TIN or bank data
- uploaded document bytes

## Alert Rules

Configure alerts for:

- web down
- API down
- worker down
- DB unreachable
- Redis unreachable
- repeated scheduler failure
- email delivery failure spike
- storage failure
- high API 5xx rate

Provider setup is an operator action until a hosted observability account is selected.

## Candidate local monitor

`scripts/staging-health-report.js` checks local API startup, the web sign-in page, all three staging services, free disk space, daily backup freshness, and aggregate failed/overdue notification, prime-delivery and Passport-refresh jobs. The report contains counts and health codes only. It never sends email, executes payments or logs queue payloads.

The supplied `infra/systemd/syncos-staging-monitor.service` and timer run every five minutes and write `/opt/syncos/staging/shared/monitoring/current.json` plus the system journal. Create that report directory before enabling the hardened unit. Missing backups or backups older than 36 hours, disk use of at least 85%, unavailable services and failed/overdue queues produce a nonzero result. These are technical defaults for daily-backup staging; they do not establish approved operational policies.

A successful file-age check does not verify backup contents or offsite recovery. External alert delivery, recipients and acknowledgment are deliberately not represented as configured. Provider/APM latency and 5xx monitoring remain separate from this local probe.

## Hostinger activation account

The running application account is `syncos`; it has no sudo rights. The existing `deploy` account may invoke only `/usr/local/sbin/syncos-staging-deploy`. Install the reviewed `scripts/hostinger-staging-deploy-root.sh` there, root-owned and mode 0755, and `scripts/checkpoint-staging.sh` as `/usr/local/libexec/syncos/checkpoint-staging.sh`, also root-owned and mode 0755. Preserve the previous wrapper for recovery. The wrapper accepts only a full SHA reachable from its explicitly configured branch. It builds as `deploy` and migrates as `syncos`; no package lifecycle runs as root. The generic non-root script is not the Hostinger entry point under this restricted sudo policy.
