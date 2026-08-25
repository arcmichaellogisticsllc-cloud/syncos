# Operator Actions Required

## Staging

1. Create hosted project/workspace.
   - Where: selected provider.
   - Value needed: project name `syncos-staging`.
   - Verify: provider project exists.
   - Expected result: web/API/worker services can be created.

2. Create managed Postgres.
   - Where: managed database provider.
   - Value needed: `DATABASE_URL` with SSL for staging.
   - Verify: `NODE_ENV=staging DATABASE_URL=<url> npm run release:staging:migrate`.
   - Expected result: migrations reach `059_syncfield_coil_commercial_policy.sql`.

3. Create managed Redis.
   - Where: Redis provider.
   - Value needed: `REDIS_URL`.
   - Verify: worker starts and API `/health/startup` reports Redis OK.
   - Expected result: queue/scheduler connectivity is healthy.

4. Create private storage.
   - Where: object storage or private mounted storage provider.
   - Value needed: staging bucket/container and server-side credentials.
   - Verify: synthetic upload/read/deny/checksum smoke.
   - Expected result: private file workflow works without public URLs.

5. Create email provider credentials.
   - Where: transactional email provider.
   - Value needed: `EMAIL_HTTP_ENDPOINT`, `EMAIL_API_KEY`, sender, reply-to.
   - Verify: invitation to allowlisted staging recipient.
   - Expected result: staging invite delivered, blocked recipients fail closed.

6. Configure DNS.
   - Where: DNS zone for `synccommsystems.com`.
   - Value needed: provider targets for `staging-app` and `staging-api`.
   - Verify: `dig` and HTTPS curl.
   - Expected result: both staging domains resolve.

7. Configure TLS.
   - Where: hosting provider or certificate provider.
   - Value needed: managed certificates for both staging domains.
   - Verify: browser and `curl -I`.
   - Expected result: HTTPS only, no mixed content.

8. Configure WAF/rate limits.
   - Where: CDN/WAF/provider edge.
   - Value needed: limits for login, public inquiry, and invite endpoints.
   - Verify: allowed requests pass and abusive repeated requests are blocked.
   - Expected result: broad staging exposure is controlled.

9. Configure monitoring and alerts.
   - Where: provider observability or external tool.
   - Value needed: uptime, 5xx, DB, Redis, worker, email, storage alerts.
   - Verify: test alert.
   - Expected result: operator receives staging alerts.

10. Configure secrets.
    - Where: provider secret manager.
    - Value needed: all variables in `docs/deployment/staging-secrets-checklist.md`.
    - Verify: `/health/startup` and service startup logs.
    - Expected result: no secrets in Git or logs.

11. Connect Git repository.
    - Where: provider deployment settings.
    - Value needed: branch `release/syncos-v0.9.0-rc1` and approved commit SHA.
    - Verify: build identity or deployment metadata.
    - Expected result: staging runs the intended release candidate.

12. Deploy services.
    - Where: provider service dashboard.
    - Value needed: API, web, and always-on worker commands.
    - Verify: `/login`, `/health`, worker logs.
    - Expected result: all services healthy.

13. Run migration.
    - Where: one-off job or release command.
    - Value needed: `npm run release:staging:migrate`.
    - Verify: schema ceiling `059`.
    - Expected result: current schema without reset.

14. Run synthetic seed.
    - Where: one-off job.
    - Value needed: `NODE_ENV=staging STAGING_SYNTHETIC_SEED_CONFIRM=true npm run seed:staging`.
    - Verify: synthetic tenant/customer/Partner/work records visible.
    - Expected result: staging demo data only.

15. Run acceptance.
    - Where: staging browser/API.
    - Value needed: `docs/pilot/staging-end-to-end-acceptance.md`.
    - Verify: all workflow sections pass.
    - Expected result: controlled staging signoff.

## Production

1. Provision production app hosting for Next.js web, NestJS API, and dedicated worker.
   - Required provider/account: selected app platform.
   - Destination: production project/service settings.
   - Verification: web `/login`, API `/health`, worker logs.
   - Expected result: all services healthy over HTTPS.

2. Provision managed PostgreSQL 15+ or 16 with SSL and backups.
   - Required provider/account: managed database provider.
   - Destination: `DATABASE_URL` in secret manager.
   - Verification: `npm run release:production:migrate` after backup confirmation.
   - Expected result: migrations current through `059_syncfield_coil_commercial_policy.sql`; no seed/reset is run.

3. Provision managed Redis with auth/TLS.
   - Required provider/account: managed Redis provider.
   - Destination: `REDIS_URL` in worker/API secret manager where needed.
   - Verification: worker startup logs.
   - Expected result: BullMQ health job processes.

4. Provision private durable file storage or production volume.
   - Required provider/account: app platform storage or object storage provider.
   - Destination: `SYNCOS_RESTRICTED_FILE_STORAGE_DIR` or future storage credentials.
   - Verification: synthetic restricted upload/download through API.
   - Expected result: file checksum matches and unauthorized access denied.

5. Configure transactional email provider.
   - Required provider/account: selected email provider.
   - Destination: `EMAIL_PROVIDER=generic_http`, `EMAIL_HTTP_ENDPOINT`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.
   - Verification: synthetic Partner Admin and Foreman invite.
   - Expected result: provider accepts send and token is not logged or echoed by production API response.

6. Add email DNS records.
   - Required provider/account: DNS and email provider.
   - Destination: DNS zone for `synccommsystems.com`.
   - Verification: provider domain authentication check.
   - Expected result: SPF, DKIM, and DMARC accepted.

7. Configure DNS and TLS.
   - Required provider/account: DNS/app platform.
   - Destination: `synccommsystems.com`, `www.synccommsystems.com`, `app.synccommsystems.com`, `api.synccommsystems.com`.
   - Verification: HTTPS curl and browser checks.
   - Expected result: valid TLS and no mixed content.

8. Configure public inquiry edge protection.
   - Required provider/account: CDN/WAF/bot protection provider.
   - Destination: `POST /partner-invitations/public-inquiries`.
   - Verification: allowed browser POST works, abusive repeated POSTs blocked.
   - Expected result: real inquiries accepted, abuse rate limited.

9. Configure monitoring and alert channels.
   - Required provider/account: app platform or observability provider.
   - Destination: web/API/worker/DB/storage/email alerts.
   - Verification: test alert route or manual simulated failure.
   - Expected result: on-call channel receives alert.

10. Perform DB and file restore drills.
    - Required provider/account: DB/storage provider.
    - Destination: staging restore target.
    - Verification: restored DB migration-status query, representative record checks, and file checksum comparison.
    - Expected result: restored data/files usable without touching production.
