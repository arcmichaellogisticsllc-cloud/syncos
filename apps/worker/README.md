# Worker Foundation

Sprint 0.5 provides a minimal BullMQ foundation only.

## Queue

- Queue name: `syncos.foundation`
- Redis URL: `REDIS_URL`, defaulting to `redis://localhost:6379`

## Retry Strategy

- Attempts: 3
- Backoff: exponential, starting at 1000ms
- Completed jobs retained: latest 100
- Failed jobs retained for inspection, providing the initial dead-letter placeholder

## Demo Job

- Job name: `demo.health`
- Purpose: prove queue connectivity and worker execution

No business workflow, recommendation, signal, organization, contact, capacity, payroll, payment, or AI jobs are implemented in Sprint 0.5.
