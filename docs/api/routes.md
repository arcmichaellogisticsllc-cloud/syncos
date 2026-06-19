# API Route Groups

Sprint 0 implements the health and protected write route pattern. Domain routes are reserved in the API structure for the modules that follow.

## Implemented In Sprint 0

- `GET /health`
- `GET /health/db`
- `POST /test-objects`
- `POST /security-test/missing-permission`

## Implemented In Sprint 1

- `GET /territories`
- `GET /territories/:id`
- `POST /territories`
- `PATCH /territories/:id`
- `POST /territories/:id/archive`
- `GET /organizations`
- `GET /organizations/:id`
- `POST /organizations`
- `PATCH /organizations/:id`
- `POST /organizations/:id/qualify`
- `POST /organizations/:id/archive`
- `GET /contacts`
- `GET /contacts/:id`
- `POST /contacts`
- `PATCH /contacts/:id`
- `POST /contacts/:id/verify`
- `POST /contacts/:id/archive`
- `GET /signals`
- `GET /signals/:id`
- `POST /signals`
- `PATCH /signals/:id`
- `POST /signals/:id/categorize`
- `POST /signals/:id/score`
- `POST /signals/:id/verify`
- `POST /signals/:id/archive`
- `GET /signals/:id/evidence`
- `POST /signals/:id/evidence`
- `PATCH /signal-evidence/:id`
- `POST /signal-evidence/:id/archive`
- `GET /search?q=`

## Planned Groups

- `/auth`
- `/users`
- `/roles`
- `/permissions`
- `/organizations`
- `/contacts`
- `/relationship-maps`
- `/signals`
- `/opportunity-candidates`
- `/opportunities`
- `/capacity`
- `/projects`
- `/work-orders`
- `/production`
- `/contracts`
- `/rate-schedules`
- `/settlements`
- `/invoices`
- `/payments`
- `/constraints`
- `/recommendations`
- `/workflows`
- `/events`
- `/kpis`
- `/learning`
- `/files`
