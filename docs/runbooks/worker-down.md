# Worker Down Runbook

## Symptoms

- Scheduled P6/P14/P15/P16 refreshes stale.
- Worker process not running or Redis connection failed.

## Checks

- Worker process status.
- `DATABASE_URL` and `REDIS_URL`.
- Recent scheduler failure logs.
- DB advisory lock contention.

## Safe Actions

- Restart one worker instance.
- Ensure only one scheduler-owning worker is active for pilot.
- Temporarily disable failing schedule flag if a job is repeatedly failing.

## Escalation

Release engineer and operations lead.

## Data Safety

Worker jobs must not mutate operational truth beyond their certified derived scope.

## Verification

Worker starts, health queue processes, and scheduled logs show bounded scans.
