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
