# Migration Failure Runbook

## Symptoms

- `npm run release:production:migrate` exits nonzero.
- `schema_migrations` does not include expected migration.

## Checks

- Confirm backup exists.
- Read migration error.
- Check lock waits and permissions.
- Verify current migration state.

## Safe Actions

- Stop deploy.
- Keep old API/web/worker running if compatible.
- Do not rerun manually edited SQL.
- Prepare forward fix after diagnosis.

## Escalation

Release engineer and database owner.

## Data Safety

Do not delete rows from `schema_migrations` without explicit database recovery plan.

## Verification

Pending migration applies once and `db:verify` passes.
