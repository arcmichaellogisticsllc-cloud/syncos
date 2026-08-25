# Staging Secrets Checklist

Never commit populated staging secrets.

## Web

| Variable | Required | Secret | Notes |
|---|---:|---:|---|
| `NODE_ENV=staging` | yes | no | service environment |
| `WEB_BASE_URL` | yes | no | `https://staging-app.synccommsystems.com` |
| `APPLICATION_BASE_URL` | yes | no | invite link base |
| `SYNCOS_API_BASE_URL` | yes | no | server-side web proxy target |
| `NEXT_PUBLIC_API_BASE_URL` | optional | no | only if needed by browser code |
| `NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL=false` | yes | no | must stay disabled |

## API

| Variable | Required | Secret | Notes |
|---|---:|---:|---|
| `DATABASE_URL` | yes | yes | staging DB only, SSL |
| `DB_POOL_MAX` | yes | no | default 20 |
| `AUTH_JWT_SECRET` | yes | yes | at least 32 chars |
| `API_BASE_URL` | yes | no | `https://staging-api.synccommsystems.com` |
| `SYNCOS_ALLOWED_ORIGINS` | yes | no | staging app and public website |
| `REDIS_URL` | yes | yes | staging Redis only |
| `PUBLIC_PARTNER_INQUIRY_TENANT_ID` | yes | no | synthetic tenant |
| `EMAIL_HTTP_ENDPOINT` | yes if email enabled | yes | provider endpoint if sensitive |
| `EMAIL_API_KEY` | yes if email enabled | yes | provider key |
| `STAGING_EMAIL_RECIPIENT_ALLOWLIST` | yes | yes | controlled recipients |
| `LIVE_AUTOMATED_PARTNER_PAYMENTS=false` | yes | no | payment safety |

## Worker

| Variable | Required | Secret | Notes |
|---|---:|---:|---|
| `DATABASE_URL` | yes | yes | staging DB only |
| `WORKER_DB_POOL_MAX` | yes | no | default 5 |
| `REDIS_URL` | yes | yes | staging Redis only |
| scheduler interval variables | optional | no | use defaults unless needed |

## Storage

| Variable | Required | Secret | Notes |
|---|---:|---:|---|
| `PRIVATE_STORAGE_PROVIDER` | yes | no | selected provider |
| `PRIVATE_STORAGE_BUCKET` | yes | no | staging bucket |
| `PRIVATE_STORAGE_ACCESS_KEY_ID` | provider dependent | yes | server-side only |
| `PRIVATE_STORAGE_SECRET_ACCESS_KEY` | provider dependent | yes | server-side only |
| `SYNCOS_RESTRICTED_FILE_STORAGE_DIR` | adapter dependent | no | mounted private storage fallback |
