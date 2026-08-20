# SyncOS Admin Operations

## Role Ownership

| Workflow | Owner role | Notes |
| --- | --- | --- |
| Internal user creation | System admin | Assign least privilege role. |
| Partner Inquiry review | Partner operations | Inquiry does not create user or approved partner. |
| Qualification | Partner operations plus operations lead | Verify territory, capability, crew count, availability, equipment. |
| Partner approval | Authorized internal reviewer | Partner cannot approve itself. |
| Foreman invite | Partner Admin or internal operations | Must bind exact worker, crew, and active foreman membership. |
| Access revocation | System admin | Invitation revoke does not revoke already accepted access. Use access lifecycle. |
| Onboarding corrections | Partner operations/compliance | Return or hold canonical checklist sources. |
| Customer QC recording | QC/internal operations | Preserve reported vs accepted lineage. |
| Cash recording | Finance | Keep Customer AR separate from Partner AP. |
| Payment review | Finance | Live automated payment execution disabled for rc1. |
| Failed payment review | Finance | Review P13 attempt and instruction state. |
| Production support | Operations | Triage field/JSA/production issues. |
| Escalation | Release/incident lead | Use runbooks under `docs/runbooks`. |

## Operating Rules

- Do not use demo seed in production.
- Do not grant Partner personas internal command center or competitor intelligence.
- Do not expose Worker PII or payment/bank details outside authorized views.
- Do not use recommendation layers to auto-award, assign, pay, or change lifecycle.
