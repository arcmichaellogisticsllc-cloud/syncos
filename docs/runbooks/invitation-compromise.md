# Invitation Compromise Runbook

## Symptoms

- Invite token sent to wrong recipient.
- Mailbox compromise suspected.
- Unexpected invitation acceptance.

## Checks

- Invitation status, organization, role, worker/crew binding.
- Audit log for create/resend/revoke/accept.
- Tenant user and role membership.

## Safe Actions

- Revoke active unaccepted invitation.
- If accepted, use access lifecycle to disable tenant user or role.
- Resend only after contact is verified.

## Escalation

Partner operations, system admin, security owner.

## Data Safety

Do not paste raw invite token into tickets or logs.

## Verification

Revoked token is denied; accepted access changes are visible in role records.
