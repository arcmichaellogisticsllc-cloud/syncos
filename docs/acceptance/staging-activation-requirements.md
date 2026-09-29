# Pre-payment candidate activation requirements

This candidate is not a live-payment activation. Keep `LIVE_AUTOMATED_PARTNER_PAYMENTS=false`; no provider polling, webhook or transfer worker is enabled.

Existing staging (checked 2026-09-29): ea41c37, 69 migrations, active API/web/worker, daily database/private-file jobs successful. The candidate adds migrations 070–072. Preserve both existing tenants and all demo/pilot data; do not run seed scripts on staging.

Before switching releases, take a fresh coordinated database/private-file backup and retain the old release. The 2026-09-29 recovery rehearsal already restored 179 tables and identical private files into a separate database; the same application role successfully upgraded that copy to 72 migrations. All original business-table counts were unchanged. That rehearsal proves local VPS recovery, not offsite disaster recovery.

Upload ingress must be adjusted with the candidate: both `staging-app.synccommsystems.com` and `staging-api.synccommsystems.com` currently use `client_max_body_size 25m`. A 20 MiB file becomes approximately 26.7 MiB in base64 before JSON overhead. Back up `/etc/nginx/sites-available/syncos-synccomm-staging`, set both relevant limits to `30m`, validate `nginx -t`, then reload nginx. Do not change the public marketing site or legacy staging host. The API's evidence route remains capped at 28 MiB JSON and 20 MiB decoded content. Test a 20 MiB upload through HTTPS and a rejected larger file after activation.

Verify the exact candidate SHA, all manifest migrations, API/web/worker health, login/role boundaries and private-file downloads after the cutover. Nodemailer is updated from 9.1 to 10.0.12 to address GHSA-6vj9-mwq6-2f5v; Node 20+ is required. SMTP tests must remain offline/mocked during acceptance.

Rollback requires a matching code/database/private-file set. Do not point the old release at the upgraded schema: the new JSA revision semantics permit multiple historical revisions per crew/date, and the old code does not understand the current-revision flag. On a failed activation, keep services stopped until a coherent restore is confirmed.

Actual-phone acceptance remains separate and unsigned. The loaded application supports queued production and persisted evidence retries; an entirely cold offline start is not certified. Browser tests and healthy services do not substitute for the physical-phone worksheet.
