# API Down Runbook

## Symptoms

- `https://api.synccommsystems.com/health` fails.
- Web proxy requests fail.
- Public inquiry or invite acceptance returns 5xx.

## Checks

- Platform service status.
- API logs for startup config failure.
- Database and Redis connectivity.
- Recent migration/deploy events.

## Safe Actions

- Roll back API artifact if deploy-related.
- Restart API service once.
- Disable public inquiry at edge if errors affect intake.
- Keep worker running only if DB is healthy.

## Escalation

Release engineer, platform operator, database owner.

## Data Safety

Do not run seed/reset commands. Preserve logs and database state.

## Verification

`/health` returns 200 and representative authenticated routes work.
