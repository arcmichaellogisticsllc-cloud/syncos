# Staging Transactional Email

Staging uses the real transactional email adapter with controlled recipients only.

## Required Configuration

- `EMAIL_PROVIDER=generic_http`
- `EMAIL_HTTP_ENDPOINT=<provider secret>`
- `EMAIL_API_KEY=<provider secret>`
- `EMAIL_FROM=notifications@synccommsystems.com`
- `EMAIL_REPLY_TO=info@synccommsystems.com`
- `STAGING_EMAIL_RECIPIENT_ALLOWLIST=<comma separated emails or @domains>`
- `APPLICATION_BASE_URL=https://staging-app.synccommsystems.com`

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
2. Confirm provider accepts the message.
3. Confirm the invite link points to `https://staging-app.synccommsystems.com/partner/invite/...`.
4. Create an invitation to a non-allowed recipient.
5. Confirm delivery is blocked and visible to the operator.
