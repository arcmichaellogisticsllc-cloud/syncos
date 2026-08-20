# Observability

## Minimum Monitoring

| Signal | Source | Required alert |
| --- | --- | --- |
| Web uptime | platform HTTP check | web unavailable |
| API uptime | `/health` | API unavailable |
| API latency/5xx | platform logs/APM | high 5xx or latency spike |
| DB health | managed PostgreSQL metrics | DB unavailable, high connections, failed backup |
| Worker health | process heartbeat/logs | worker not running |
| Scheduler failures | worker logs | repeated P6/P14/P15/P16 failures |
| Redis health | managed Redis metrics | Redis unavailable |
| Storage errors | API logs | restricted file read/write failure |
| Email delivery | provider logs/API result | delivery failure spike |
| Payment errors | P13 payment attempts/actions | failed/returned payment requiring review |
| Public inquiry errors | API route metrics | high 4xx/5xx or rate-limit spike |

## Logging

Logs must be searchable and include:

- timestamp;
- service;
- environment;
- request/correlation ID where available;
- safe tenant/entity IDs;
- error classification.

Never log passwords, session secrets, raw invite tokens, TIN, bank data, private keys, provider credentials, full credential documents, or raw restricted storage content.

## Configured vs Operator Required

Repository-side safe logging and health endpoints exist. Provider dashboards, alert contacts, notification channels, and log retention are OPERATOR ACTION REQUIRED.
