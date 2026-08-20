# Database Unavailable Runbook

## Symptoms

- API health degraded.
- Migrations fail to connect.
- Worker scheduler failures across all jobs.

## Checks

- Managed DB status.
- Connection limit and locks.
- Credentials/SSL.
- Storage capacity.

## Safe Actions

- Stop deploy.
- Pause worker if retries add load.
- Contact DB provider.
- Restore only to a new database unless incident lead approves production restore.

## Escalation

Database owner, release engineer, provider support.

## Data Safety

Do not reset, reseed, or destructive-rollback production.

## Verification

Health query succeeds and `npm run db:verify` passes against target.
