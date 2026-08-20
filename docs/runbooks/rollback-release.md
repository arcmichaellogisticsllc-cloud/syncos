# Rollback Release Runbook

## Symptoms

- Critical deploy regression.
- Security boundary failure.
- Data-integrity risk.

## Checks

- Identify affected service: public site, web, API, worker, DB migration.
- Confirm last known good artifact.
- Confirm whether migrations ran.

## Safe Actions

- Roll back public site/web/API/worker artifacts through platform controls.
- Disable workers if background churn is unsafe.
- Disable public inquiry if intake is affected.
- Keep payment execution disabled.
- Preserve DB/files/logs.

## Escalation

Incident lead, release engineer, database owner.

## Data Safety

Do not promise destructive migration rollback. Prefer forward fix or restore to new environment for validation.

## Verification

Critical smoke paths pass and no new writes are failing.
