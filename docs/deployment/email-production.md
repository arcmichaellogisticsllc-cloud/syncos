# Production Email

## Current Implementation

P18 invitations use a provider-neutral delivery boundary:

- `EMAIL_PROVIDER=local_test` for development and certification.
- `EMAIL_PROVIDER=generic_http` for production transactional provider API integration.
- `EMAIL_PROVIDER=smtp_relay` for a standard SMTP relay with required TLS.
- `EMAIL_PROVIDER=disabled` to fail closed when production credentials are not ready.

Production startup rejects `local_test` and requires `generic_http`, `smtp_relay`, or `disabled`.

## Required Use Cases

- Partner Admin onboarding invitation.
- Partner Foreman field access invitation.
- Future password/account verification if external auth requires email.

## Environment

- `EMAIL_PROVIDER`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `EMAIL_HTTP_ENDPOINT`
- `EMAIL_API_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, and `SMTP_REQUIRE_TLS=true` when `EMAIL_PROVIDER=smtp_relay`
- `APPLICATION_BASE_URL`

Secret values must be stored in the provider secret manager, not Git.

For Google Workspace SMTP relay configured by trusted source IP, leave `SMTP_USERNAME` and `SMTP_PASSWORD` unset. SyncOS only sends SMTP AUTH credentials when both values are present.

## DNS Authentication

Operator must provision provider-issued DNS records:

| Record | Status | Notes |
| --- | --- | --- |
| SPF | OPERATOR ACTION REQUIRED | Add provider include/mechanism after provider selection. |
| DKIM | OPERATOR ACTION REQUIRED | Add provider-issued selector records. |
| DMARC | OPERATOR ACTION REQUIRED | Start with monitoring policy, then tighten after delivery is stable. |

Do not invent DKIM/SPF values before the email provider issues them.

## Safety

- Raw invitation token exists only in the outbound invite URL at generation/delivery time.
- Raw token is not stored in the database.
- Production provider responses do not echo the raw invite URL in API responses.
- If `EMAIL_PROVIDER=disabled`, invitation records may be created but delivery status is failed and operators must use a controlled manual process.

## Verification

1. Set production-like email env in staging.
2. Create Partner Admin and Foreman invitations with synthetic addresses.
3. Confirm provider accepted the send request.
4. Confirm invite links resolve to `https://app.synccommsystems.com/partner/invite/<token>`.
5. Confirm no token appears in audit logs.
