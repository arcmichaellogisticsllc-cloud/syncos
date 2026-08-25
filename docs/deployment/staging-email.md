# Staging Transactional Email

Staging uses the Google Workspace SMTP relay with controlled recipients only.

## Required Configuration

- `EMAIL_PROVIDER=smtp_relay`
- `EMAIL_FROM=Sync Comm Systems <notifications@synccommsystems.com>`
- `EMAIL_REPLY_TO=info@synccommsystems.com`
- `SMTP_HOST=smtp-relay.gmail.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_REQUIRE_TLS=true`
- `SMTP_USERNAME=` blank for Google Workspace IP-authenticated relay
- `SMTP_PASSWORD=` blank for Google Workspace IP-authenticated relay
- `STAGING_EMAIL_RECIPIENT_ALLOWLIST=<comma separated emails or @domains>`
- `APPLICATION_BASE_URL=https://staging-app.synccommsystems.com`

The current Google Workspace relay is authorized by the Hostinger VPS source IP. Do not store a Google username, password, or app password for this relay model.

## Safety Rule

When `NODE_ENV=staging`, invitation delivery fails closed unless the recipient matches `STAGING_EMAIL_RECIPIENT_ALLOWLIST`.

Blocked delivery:

- records `delivery_status=FAILED`
- records `delivery_reference=staging_recipient_blocked`
- returns an operator action explaining the allowlist block
- does not redirect silently
- does not expose invite token as a local/test success

## Verification

1. Create a Partner Admin invitation to an allowed staging recipient.
2. Confirm Google accepts the message through `smtp-relay.gmail.com:587` with STARTTLS.
3. Confirm the invite link points to `https://staging-app.synccommsystems.com/partner/invite/...`.
4. Create an invitation to a non-allowed recipient.
5. Confirm delivery is blocked and visible to the operator.
