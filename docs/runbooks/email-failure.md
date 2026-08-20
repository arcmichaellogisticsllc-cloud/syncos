# Email Failure Runbook

## Symptoms

- Invitation delivery status is failed.
- Provider reports rejection.
- Partner does not receive invite.

## Checks

- `EMAIL_PROVIDER`, endpoint, sender, reply-to.
- Provider API logs.
- SPF/DKIM/DMARC status.
- Application base URL.

## Safe Actions

- Switch `EMAIL_PROVIDER=disabled` if provider is unsafe.
- Use controlled manual invitation handoff only when approved.
- Resend invitation after provider recovery; old token is superseded.

## Escalation

Partner operations, release engineer, email provider admin.

## Data Safety

Do not expose raw token in logs or support tickets.

## Verification

Synthetic invite is accepted by provider and token remains absent from database/audit.
