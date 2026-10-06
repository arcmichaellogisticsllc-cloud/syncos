# Candidate 109: identity and prime delivery

All three features default disabled. Migrations 107–109 add tables without rewriting existing demo, historical, agreement or payment records. Local regression and an isolated actual-data upgrade have passing evidence. Required provider verification, full historical UI closeout, offsite recovery and exact-candidate deployed acceptance remain open. Do not start an operational pilot.

## SSO

Set `SSO_ENABLED=true` only after selecting and verifying the actual OIDC provider. Configure `SSO_ALLOWED_HOSTS` as an explicit comma-separated list of provider hostnames (including non-default ports). Register the exact `${APPLICATION_BASE_URL}/sso/callback` URL with the provider. Each saved connection references a protected `SSO_CLIENT_SECRET_*` environment entry; never place secret values in repository documents or UI fields.

Supported contract: authorization code flow with S256 PKCE, `openid email` scope, client secret in the token request, signed RS256/ES256 ID token, issuer/audience/nonce/expiry/authorized-party checks. Each provider subject must be explicitly linked to an existing active workspace member. No email-only linking, just-in-time role provisioning, or provider-claim role grants. A connection change increments its version and invalidates older SSO sessions. Link changes increment account auth version. Local sign-out does not implement provider-wide logout; confirm the selected provider's session/logout requirements before activation.

Verify real provider registration, successful login, denial for unlinked identities and wrong workspaces, deprovisioning, credential rotation, local logout/recovery, and any required provider-wide logout before recording integration completion.

## Magic links

`MAGIC_LINK_ENABLED=true` requires the approved email provider and HTTPS `APPLICATION_BASE_URL`. Existing `EMAIL_*`/`SMTP_*` configuration and staging recipient allowlist apply. Tokens expire after 15 minutes, are hashed for lookup, and only an encrypted delivery message is queued. Completion is a deliberate POST from the link page, not a GET that an email scanner can consume. Sessions last one hour and use existing server permissions. Tokens are separate from password-reset tokens and are invalidated by password reset or membership removal.

Verify actual delivery, scanner behavior, link navigation, sender authentication and failure/retry status before activation. Simulated email tests do not establish mailbox delivery.

## Prime package receiver

`PRIME_DELIVERY_ENABLED=true` enables the polling outbox. `PRIME_DELIVERY_ALLOWED_HOSTS` must explicitly approve destination hosts. Each reviewed contract destination references a protected `PRIME_DELIVERY_TOKEN_*` entry. The adapter sends POST `application/zip` with bearer authentication, `Idempotency-Key` equal to the durable job ID and `X-Package-SHA256` identifying original archive bytes. Redirects are rejected.

A successful response must be JSON:

```json
{"receipt_id":"prime-issued-id","status":"delivered","received_at":"2026-10-06T14:00:00Z","package_checksum":"sha256-of-received-archive"}
```

The receiver must honor idempotency and return a real delivery receipt, not merely an asynchronous-queue acknowledgment. A rate-limit response may retry up to five attempts. Timeouts, ambiguous responses, interrupted processing and post-delivery recording conflicts go to review. A crash cannot cause an automatic blind resend. The operator must reconcile the destination outcome with proof. Delivery, rejection, resubmission and customer acceptance remain separate events.

This is a defined generic HTTPS receiver adapter, **not evidence that a prime's actual portal supports it**. Channel-specific email/SFTP/portal adapters require that prime's approved interface and acceptance proof. Preserve manual package download/delivery recording while integration compatibility is unresolved.

## Workspace administration and search

Workspace Access uses existing tenant-level administrative permissions. Changes require a reviewed reason, invalidate prior sessions and create events/audit entries. Administrators cannot change their own access, grant powers beyond their own, or remove the last active administrator. Field and partner role grants remain with workforce onboarding. Global search requires tenant search permission and independently filters each record type by its read permission; organization-only grants cannot search across a tenant. Search has stable pagination and literal search matching.
