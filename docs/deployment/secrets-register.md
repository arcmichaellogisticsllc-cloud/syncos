# SyncOS Secrets Register

Do not commit real values. Store secrets in the deployment provider secret manager.

| Name | Classification | Used by | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | SECRET | API, worker, migrations | Production URL must require SSL. |
| `AUTH_JWT_SECRET` | SECRET | API | Minimum 16 chars; rotate with session impact plan. |
| `REDIS_URL` | SECRET | Worker | Required by current worker health queue. |
| `EMAIL_API_KEY` | SECRET | API | Required for `EMAIL_PROVIDER=generic_http`. |
| `EMAIL_HTTP_ENDPOINT` | NON-SECRET CONFIG | API | Provider endpoint, HTTPS only. |
| `EMAIL_FROM` | NON-SECRET CONFIG | API | Verified sender domain required. |
| `EMAIL_REPLY_TO` | NON-SECRET CONFIG | API | Support mailbox. |
| `APPLICATION_BASE_URL` | NON-SECRET CONFIG | API | `https://app.synccommsystems.com`. |
| `API_BASE_URL` | NON-SECRET CONFIG | API | `https://api.synccommsystems.com`. |
| `WEB_BASE_URL` | NON-SECRET CONFIG | API/docs | `https://app.synccommsystems.com`. |
| `SYNCOS_API_BASE_URL` | NON-SECRET CONFIG | Web | Server-side API proxy target. |
| `SYNCOS_ALLOWED_ORIGINS` | NON-SECRET CONFIG | API | No wildcards in production. |
| `PUBLIC_PARTNER_INQUIRY_TENANT_ID` | NON-SECRET CONFIG | API | Server-side tenant binding for public inquiry. |
| `SYNCOS_RESTRICTED_FILE_STORAGE_DIR` | SECRET/CONFIG | API | Treat as sensitive operational path. |
| Storage provider credentials | SECRET | API/worker | Required if object storage is added. |
| Payment provider credentials | SECRET | API | Not configured for live payouts in rc1. |
| `LIVE_AUTOMATED_PARTNER_PAYMENTS` | NON-SECRET CONFIG | API | Must be `false` until provider certification. |

Tracked env files such as `.env.production`, `.env.staging`, and `.env.local` are forbidden.
