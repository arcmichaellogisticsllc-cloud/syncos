# Worker Schedules

## Production Model

Run `apps/worker` as a dedicated always-on process. Do not run schedulers inside every web/API replica.

## Jobs

| Job | Env disable flag | Default interval | Min interval | Batch | Lock/idempotency | Failure impact | Alert threshold |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| P6 mobilization expiration scan | `SYNCOS_P6_EXPIRATION_SCAN_DISABLED` | 5 min | 60 sec | 50, max 250 | Shared scanner/advisory lock pattern | Expiration/readiness state stale | 2 consecutive failures |
| P14 partner performance recalc | `SYNCOS_P14_PERFORMANCE_SCAN_DISABLED` | 60 min | 300 sec | 50, max 250 | Snapshot fingerprint/idempotent | Performance/capacity stale | 2 consecutive failures |
| P15 opportunity matching refresh | `SYNCOS_P15_MATCHING_SCAN_DISABLED` | 60 min | 300 sec | 50, max 250 | Matching fingerprint/idempotent | Opportunity coverage stale | 2 consecutive failures |
| P16 command refresh | `SYNCOS_P16_COMMAND_SCAN_DISABLED` | 60 min | 300 sec | 25, max 100 | Snapshot fingerprint/idempotent | Command Center stale | 2 consecutive failures |
| BullMQ health queue | none | on startup | n/a | n/a | Redis-backed queue | Worker health degraded | immediate if Redis unavailable |

## Required Runtime

- `DATABASE_URL`
- `REDIS_URL`
- `AUTH_JWT_SECRET` where shared auth utilities require it
- restricted file storage access if export jobs use files

## Safe Shutdown

The worker listens for `SIGINT` and `SIGTERM`. Platform must send termination signals and allow enough grace period for current scans to end.
