# Staging Environment Variable Final Map

No real values belong in this document or in committed env files.

| Variable | Service | Required? | Secret? | Example placeholder | Provider secret name | Local rule | Staging rule | Production rule | Validation check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | API, Worker, DB scripts | Yes | Yes | `<staging-postgres-url>` | `DATABASE_URL` | Local Postgres only. | Provider secret manager only; never committed. | Production secret manager only; never shared with staging. | App starts, migrations run, no committed value. |
| `AUTH_JWT_SECRET` | API, E2E helpers | Yes | Yes | `<strong-staging-secret>` | `AUTH_JWT_SECRET` | Local dev placeholder allowed only locally. | Strong unique staging value; never committed. | Strong unique production value; rotated by policy. | Auth works; checker rejects obvious committed staging secret. |
| `API_BASE_URL` | Tests, service checks | Yes for E2E/smoke | No if URL only | `<staging-api-url>` | `API_BASE_URL` | Local API URL. | Staging API URL. | Production API URL. | Smoke tests target expected API. |
| `WEB_BASE_URL` | Tests, smoke | Yes for E2E/smoke | No | `<staging-web-url>` | `WEB_BASE_URL` | Local web URL. | Staging web URL. | Production web URL. | Smoke tests target expected web. |
| `SYNCOS_API_BASE_URL` | Web/server-side API proxy | Yes | No | `<staging-api-url>` | `SYNCOS_API_BASE_URL` | Local API URL. | Staging API URL. | Production API URL. | Web server routes reach API. |
| `NEXT_PUBLIC_API_BASE_URL` | Web/browser | Yes | No | `<staging-api-url>` | `NEXT_PUBLIC_API_BASE_URL` | Local API URL. | Staging API URL; public value only. | Production API URL; public value only. | Browser calls expected API. |
| `NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL` | Web/browser | No | No | `false` | `NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL` | May be true only for local debugging. | Must be false or missing. | Must be false or missing. | No developer token panel visible. |
| `ALLOW_DEV_HEADER_AUTH` | API | No | No | `false` | `ALLOW_DEV_HEADER_AUTH` | May be true only for local debugging. | Must be false or missing. | Must be false or missing. | Dev header auth denied. |
| `NODE_ENV` | Web, API, Worker | Yes | No | `production` | `NODE_ENV` | `development` or test as needed. | Many providers should use `production` build/runtime mode even for staging. | `production`. | Build/runtime mode documented per provider. |
| `PORT` | Web, API, Worker | Provider-dependent | No | `<provider-assigned>` | `PORT` | Local explicit port. | Provider-assigned or configured per service. | Provider-assigned or configured per service. | Service listens on provider port. |
| `CI` | CI/test only | Contextual | No | `true` | `CI` | Empty unless running CI-like validation. | True only in CI/test contexts. | True only in CI contexts. | Playwright/build behavior matches context. |
| `REDIS_URL` | API/Worker if queue/cache requires it | Conditional | Yes if managed credential | `<staging-redis-url-if-used>` | `REDIS_URL` | Local Redis if used. | Configure only if worker/API require it. | Production secret manager if used. | Worker/API boot without queue errors. |
| `E2E_DATABASE_URL` | Local/CI E2E | No for staging app | Yes if credentialed | `<isolated-e2e-db-url>` | `E2E_DATABASE_URL` | Optional isolated local DB. | Use only for isolated staging certification, not shared staging traffic DB. | Do not point at production. | E2E never mutates shared staging. |

## Rules

- `DATABASE_URL` and `AUTH_JWT_SECRET` are secrets and must live in provider secret managers.
- `NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL` is public but must be false or missing in staging.
- `ALLOW_DEV_HEADER_AUTH` must be false or missing in staging.
- `NODE_ENV=production` is acceptable for staging providers when that is how the app builds and runs production-mode bundles.
- `CI=true` is for CI/test contexts only.
