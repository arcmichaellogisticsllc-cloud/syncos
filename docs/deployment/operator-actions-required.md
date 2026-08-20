# Operator Actions Required

1. Provision production app hosting for Next.js web, NestJS API, and dedicated worker.
   - Required provider/account: selected app platform.
   - Destination: production project/service settings.
   - Verification: web `/login`, API `/health`, worker logs.
   - Expected result: all services healthy over HTTPS.

2. Provision managed PostgreSQL 15+ or 16 with SSL and backups.
   - Required provider/account: managed database provider.
   - Destination: `DATABASE_URL` in secret manager.
   - Verification: `npm run release:production:migrate` after backup confirmation.
   - Expected result: migrations current through `056_syncfield_field_traceability.sql`; no seed/reset is run.

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
