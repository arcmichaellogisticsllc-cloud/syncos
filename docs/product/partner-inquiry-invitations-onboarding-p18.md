# SyncOS P18 - Partner Inquiry, Invitations & Onboarding

## Baseline

- Branch: `feat/partner-inquiry-onboarding-p18`
- Baseline commit: `20a5b3101cb28868da1c6418ea2add2110a2c6f0`
- Recovery: uncommitted invitation/onboarding work was preserved and continued on the correct P18 branch.

## Public Partner Inquiry

P18 adds `POST /partner-invitations/public-inquiries` for the public Sync Comm Systems website integration. The endpoint creates a `partner_inquiries` row only.

Required request body:

```json
{
  "company_name": "Example Aerial LLC",
  "contact_name": "Jane Example",
  "email": "jane@example.com",
  "phone": "555-0101",
  "territory": "Ohio",
  "capability": "Aerial Fiber",
  "crew_count": 3,
  "availability": "7 days",
  "equipment": "bucket trucks",
  "experience_notes": "OSP aerial experience",
  "source": "synccommsystems.com"
}
```

Response: `202 Accepted`, generic safe acknowledgement, inquiry id, and status.

Security:

- no public `tenant_id`, `organization_id`, `role_key`, `user_id`, or `storage_key` accepted
- no user created
- no role created
- no Partner Organization approval
- no Agreement, Work Order, mobilization, or invitation created
- same email/IP hash limited to a small hourly intake threshold
- public tenant is configured by `PUBLIC_PARTNER_INQUIRY_TENANT_ID`; non-production can fall back to the first configured tenant for local testing

The public website remains untouched in P18.

## Qualification Gate

Internal Sync users can read inquiries, assign an owner, record contact, and qualify the inquiry. Supported statuses:

`NEW`, `REVIEWING`, `CONTACT_REQUIRED`, `CONTACTED`, `QUALIFIED`, `FUTURE_CAPACITY`, `NOT_A_FIT`, `INVITED`, `CONVERTED`, `CLOSED`.

Inquiry-driven invitations require a human-qualified inquiry. The website cannot automatically invite or onboard a Partner.

Qualification stores conversation/review history in `partner_inquiry_qualification_events`.

## Manual Invite

Internal users can invite a Partner Admin directly with source tracking:

`MANUAL_INTERNAL`, `REFERRAL`, `EXISTING_RELATIONSHIP`, `OPPORTUNITY_CAPACITY_GAP`, `PRIME_CUSTOMER_INTRODUCTION`, `PARTNER_NETWORK_RECRUITING`, `OTHER`.

Manual invite bypasses the public inquiry only. It does not bypass onboarding, compliance, workforce setup, agreement, internal review, approval, or mobilization.

## Organization Dedupe

P18 reuses canonical `organizations` and `capacity_providers`. It does not fuzzy-merge companies. Ambiguous organization conversion requires an explicit internal `organization_id`.

## Partner Admin Invitation

The existing Partner Admin invite flow is preserved and expanded:

- one-time token generated only at delivery time
- SHA-256 token hash stored
- raw token never stored
- public preview/accept use POST body token
- tenant and Partner Organization binding are server-side
- intended role is server-side and fixed to `partner_admin`
- acceptance creates or attaches a SyncOS user
- tenant membership becomes active
- Partner Admin role is scoped to the exact Organization
- checklist opens at `/partner/onboarding`

## Foreman Invitation

P18 adds `POST /partner-invitations/foreman` for Partner Admin or authorized internal users.

Acceptance revalidates:

- Worker belongs to the Partner Organization
- Worker is active and approved
- Crew belongs to the Partner Organization
- Crew is active
- Worker has current active Crew membership
- membership role is `foreman` or `alternate_foreman`

The invitation binds tenant, Organization, Worker, Crew, membership, email, and role `partner_foreman`. It does not create ordinary Worker accounts and does not infer Worker identity from email/name.

## Invite Lifecycle

Statuses:

`SENT`, `ACCEPTED`, `EXPIRED`, `REVOKED`, `SUPERSEDED`.

Resend creates a new token and new invitation row, superseding the old invitation immediately. Revoke invalidates only a pending sent invitation. Revoking an already accepted invitation is intentionally separate from access lifecycle revocation.

Concurrent acceptance uses row locking and status transition from `SENT` to `ACCEPTED`, yielding one role attachment.

## Email Architecture

P18 uses a provider-neutral local/test adapter. It prepares:

- `Sync Comm Systems Partner Onboarding Invitation`
- `Sync Comm Systems Field Access Invitation`

No real production email is sent in certification. Production email delivery remains a deployment configuration task.

## Onboarding Checklist

Partner Admin checklist derives from canonical P3-P6 objects:

- Company Profile
- W-9
- Payment Setup
- Insurance
- Workers
- Headshots
- Credentials
- Crew
- Foreman
- Agreement
- Internal Review
- Mobilization

Checklist is navigation/status only and cannot set readiness. Mobilization remains a separate certified domain.

Status meanings:

- `ACCOUNT_ACTIVATED`
- `ONBOARDING_INCOMPLETE`
- `READY_FOR_REVIEW`
- `COMPANY_APPROVED`
- `PROJECT_NOT_ASSIGNED`
- `MOBILIZATION_NOT_READY`

## Internal Workspace

`GET /partner-invitations/onboarding-workspace` returns safe internal onboarding rows:

- Company
- Source
- Invite status
- Last invite
- Account status
- Checklist status
- Safe blockers
- Reviewer placeholder

No sensitive PII appears in the list.

## Approval

`POST /partner-invitations/organizations/:organizationId/approve` reuses canonical Partner Organization/capacity-provider lifecycle state. Partner users cannot approve themselves.

Approval does not create Work Orders, rates, mobilization decisions, Notices to Proceed, or production authorization.

## Capacity Signal

Public inquiry capacity is stored only as `LOW` confidence, unverified `potential_capacity_signal`. P14/P15/P16 may treat it only as potential relevance. It does not become deployable capacity and cannot auto-qualify, auto-invite, or auto-assign.

## Analytics

`GET /partner-invitations/analytics` returns safe funnel counts and median durations:

- inquiry count
- contact count
- qualification count
- invitation count
- invite acceptance count
- source segmentation
- inquiry to contact
- contact to qualification
- invite to acceptance

It does not rank internal employees.

## Permissions

Internal:

- `partner_inquiry.read`
- `partner_inquiry.manage`
- `partner_inquiry.qualify`
- `partner_invitation.create`
- `partner_invitation.read`
- `partner_invitation.resend`
- `partner_invitation.revoke`
- `partner_onboarding.review`
- `partner_onboarding.approve`

Partner Admin own Organization:

- `partner_foreman_invitation.create`
- `partner_foreman_invitation.read`
- `partner_foreman_invitation.resend`
- `partner_foreman_invitation.revoke`

Partner Foreman:

- no invitation management

## Migration

Migration added/expanded:

- `055_partner_onboarding_invitations.sql`

New tables:

- `partner_inquiries`
- `partner_inquiry_qualification_events`
- `partner_onboarding_invitations`

## Validation Results

Passed:

- `npm test`: 68/68
- `npm run typecheck`: passed
- `npm run typecheck -w @syncos/api`: passed
- `npm run build -w @syncos/api`: passed
- `npm run build -w @syncos/web`: passed
- fresh migration through 055: passed
- seed: passed
- seed rerun: passed
- `db:verify` on empty disposable DB: passed
- P18 targeted E2E: 4/4 passed
- P1-P17 global regression via full certification: 673/673 passed
- `git diff --check`: passed

Global certification:

- attempted with API only: failed in existing action-state UI route tests because browser UI runtime was not fully available
- attempted with API + web: P18 targeted and early regression tests passed, then failed in existing QC/Billable/Settlement/Invoice detail routes returning Next 500s
- P18B differential rerun used fresh P18 and clean P17 baseline worktrees, fresh builds, fresh API/web runtimes, and disposable DBs
- clean P18 candidate affected-route subset: 20/20 passed
- clean P17 baseline affected-route subset: 20/20 passed
- final clean global certification: 673/673 passed, exit code 0
- classification: prior QC/Billable/Settlement/Invoice 500s were stale runtime / contaminated DB certification artifacts, not a P18 regression

## Defects Found / Corrected

Corrected:

- analytics duration query initially referenced invitation table fields for inquiry contact/qualification timing; fixed to use `partner_inquiries`
- E2E fixture initially assumed public endpoint tenant matched synthetic internal tenant; corrected to test public intake independently from tenant-scoped qualification
- resend transaction ordering fixed so the old `SENT` invite is superseded before inserting the replacement `SENT` invite

## Remaining Limitations

- Production email delivery is not live-certified; P18 uses local/test email preparation.
- Public inquiry anti-abuse is a small built-in hourly limiter, not a full edge/WAF program.
- Public tenant selection requires deployment configuration.

## Boundaries

Confirmed:

- inquiry does not auto-onboard
- manual invite bypasses inquiry but not onboarding controls
- no auto Partner approval
- no Work Order creation
- no mobilization creation
- no role spoof
- no Organization spoof
- no token leak to audit/API payloads beyond delivery URL at generation time

## P18 Certification

CERTIFIED

P18 targeted certification is green and final clean global certification passed 673/673. The earlier QC/Billable/Settlement/Invoice detail-route 500s did not reproduce on clean P18 or clean P17 baseline runtimes.

## Product Release Recommendation

LIMITED PRODUCTION READY remains unchanged from P17/P18 boundaries only if invitation email remains local/test or production email is configured and certified before live use.

## GO / NO-GO

- GO for committing P18 after final review.
- GO for returning to deployment planning with production email and public-edge anti-abuse prerequisites tracked.
