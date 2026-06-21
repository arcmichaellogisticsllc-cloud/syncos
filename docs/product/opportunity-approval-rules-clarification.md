# Opportunity Approval Rules Clarification

Current validated commit: `a11156976524bd75c33b01258829c61898541d18`

This document clarified approval policy before Capacity Workspace, Project Handoff, Pursuit Management, or deeper execution workflows. The open decisions in this document were approved for the Opportunity Approval Policy Hardening sprint and implemented in `docs/product/opportunity-approval-policy.md`.

Approved decisions:

- pursuit value thresholds are approved
- Growth Director may approve pursuit under `$50k`
- Growth Director may not approve `$50k+` pursuit
- award thresholds are deferred
- weak/no relationship access is warning + override, never an automatic hard block
- capacity unknown and margin unknown are pursuit warnings requiring override
- critical constraints hard-block only when `hard_stop = true`
- override data uses the existing `opportunity.pursuit_approved` event payload
- Executive Emergency Override remains out of scope

## 1. Current Backend Inventory

Files inspected:

- `apps/api/src/routes/opportunities.controller.ts`
- `apps/api/src/routes/constraints.controller.ts`
- `packages/database/migrations/006_opportunity_candidates_opportunities.sql`
- `packages/database/migrations/011_constraints_recommendations.sql`
- `packages/database/migrations/022_opportunity_pipeline_contract_hardening.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `docs/product/opportunity-pipeline-backend-contract.md`
- `docs/product/opportunity-pipeline-product-contract.md`

Current behavior classification:

| Area | Status | Current behavior |
| --- | --- | --- |
| `opportunity.pursuit_approve` | Supported, partial policy | Requires permission, allowed status, core fields, non-archived opportunity, warning override reasons, and persists pursuit approval override fields. No value-tier role thresholds yet. |
| `opportunity.award` | Supported, partial policy | Requires `opportunity.award`, negotiation status, award evidence, customer confirmation, and current authority role check for Executive or Growth Director. Creates no downstream project/work/finance records. |
| `opportunity.defer` | Supported | Requires approved deferred reason and persists deferred metadata. |
| `opportunity.lost` | Supported | Requires approved lost reason and persists lost metadata. |
| `opportunity.archive` | Supported | Requires approved archive reason and persists archive metadata. |
| Readiness/checklist | Supported, partial policy | Backend returns readiness checks, score, band, warnings, blockers, and recommended next action. It does not yet include approval tier or threshold authority. |
| Warnings/blockers | Supported, partial policy | Core blockers are missing organization, territory, owner, invalid status, archived opportunity. Warnings include relationship, capacity, margin, pursuit score, and critical constraints. |
| Constraints model | Partially supported | Constraints support type, affected object, owner, due date, status, and severity. No explicit `hard_stop` or `override_allowed` fields exist today. |
| Recommendations model | Supported for surfacing | Recommendations can be related to opportunities but are not approval rules. |
| Role/permission model | Supported, partial policy | Opportunity permissions are seeded. Role membership exists. Value-tier role authority is not implemented. |
| Current opportunity permissions | Supported | Includes read/create/update/pursuit_approve/pursue/proposal/negotiation/award/lost/defer/archive/score/assign_owner/link_relationship_map/submit_review/timeline/audit. |
| Current opportunity events | Supported | Write routes use the write-action helper. Opportunity created, converted, owner/link/status/lifecycle/lost/deferred/archived/scored/capacity events are available. |
| Audit behavior | Supported | Writes create audit records through existing write-action helper. Audit summary endpoint requires `opportunity.audit.read`. |
| Override reason fields | Supported, partial policy | Pursuit approval stores relationship, capacity, margin, constraints, and general pursuit override fields. Missing value override field is not present. |
| Capacity requirement behavior | Supported, planning-only | Requirements can be viewed/created/updated/archived. They do not deploy crews, assign workers/equipment, create projects, or create work orders. |
| Relationship access behavior | Supported | Weak/missing relationship access is warning/override behavior, not an acquisition hard block. |

Unsafe to infer:

- Whether current critical constraints represent true hard stops.
- Whether value thresholds should apply to pursuit approval immediately.
- Whether award approval should use the same authority model as pursuit approval.
- Whether Executive Emergency Override should ever exist.

## 2. Approval Decision Types

Pursuit Approval means Jackson approves active pursuit effort: outreach, relationship building, scope investigation, pricing preparation, capacity planning, and proposal preparation. It does not mean work is won.

Award Acceptance Approval means Jackson accepts awarded work or prepares a downstream project handoff. Product Sprint 6 records `awarded` status only and must not create project records.

These are separate decisions and should not silently share all rules.

## 3. Proposed Approval Policy

Opportunity approval should balance growth and control:

- Operationally fixable issues should become warnings, constraints, assigned actions, escalation paths, and override records.
- Legal, safety, compliance, data-integrity, and tenant-boundary failures may be hard stops.
- Hard stops must be explicit and observable.
- Missing relationship access must not stop work acquisition by itself.

## 4. Value-Based Threshold Model

Proposed pursuit approval thresholds:

| Estimated value | Allowed pursuit approvers |
| --- | --- |
| `$0-$49,999` | Growth Director, Regional Director, Executive, System Admin |
| `$50,000-$249,999` | Regional Director, Executive, System Admin |
| `$250,000+` | Executive, System Admin |
| Missing value | Regional Director, Executive, System Admin with `missing_value_override_reason` |

System Admin is included for system testing and emergency administrative control, not normal business approval.

Recommended first implementation:

- Enforce thresholds for pursuit approval.
- Persist approval tier and approver authority in event/audit payload.
- Add `missing_value_override_reason` if missing value approval is allowed.

Clarification needed: whether these thresholds are approved for immediate enforcement.

## 5. Constraint Severity Model

Proposed severity behavior:

| Severity | Approval behavior |
| --- | --- |
| `low` | Visibility only. Does not block approval. |
| `medium` | Meaningful warning. Does not block approval. |
| `high` | Requires override reason and sufficient authority. |
| `critical` | Potential hard stop. Blocks approval unless explicitly `override_allowed = true` and actor has critical override authority. |

Future constraint fields needed:

- `override_allowed`
- `hard_stop`
- `approval_stage_scope` or equivalent stage policy if pursuit and award behavior differs

Current schema has severity but not explicit hard-stop semantics, so critical constraints are not safe to treat as permanent non-overridable hard stops without product confirmation.

## 6. Override Authority Model

Proposed override authority:

| Warning class | Allowed override roles |
| --- | --- |
| Low/medium warnings | Growth Director, Regional Director, Executive, System Admin |
| High warnings | Regional Director, Executive, System Admin |
| Critical and `override_allowed = true` | Executive, System Admin |
| Critical and `hard_stop = true` | No override unless future Executive Emergency Override is explicitly approved |

Override record requirements:

- `override_reason`
- optional `override_note`
- `override_actor`
- `override_at`
- warning types overridden
- approval type
- estimated value tier, when applicable

## 7. Pursuit Approval Rules

Pursuit approval should be growth-forward.

Warnings requiring override reason:

- weak relationship access
- missing relationship map
- relationship access score below threshold
- capacity not fully confirmed
- capacity readiness unknown
- margin potential unknown
- incomplete pricing
- missing AP contact
- missing field validator
- unclear scope
- missing capacity requirements
- open non-critical constraints
- missing pursuit score

Pursuit hard blockers:

- actor lacks permission
- wrong tenant or cross-tenant relationship
- archived opportunity
- missing organization
- missing territory
- missing owner
- invalid estimated value
- invalid status transition
- explicit legal/compliance/safety hard-stop constraint
- executive hold
- fraud or falsified evidence, if modeled

Default rule: pursuit approval is allowed when identity, tenant, permission, and lifecycle checks pass, as long as override reasons are captured for warnings.

## 8. Award Approval Rules

Award approval should be stricter than pursuit approval because it may create operational commitment in future handoff workflows.

Award warnings:

- weak relationship
- missing AP contact
- incomplete billing contact
- capacity not fully deployed
- missing project handoff details
- medium margin confidence
- open non-critical constraints

Award hard blockers:

- actor lacks award permission
- wrong tenant
- archived opportunity
- missing organization
- missing territory
- missing owner
- illegal/prohibited work
- explicit safety/compliance hard stop
- expired mandatory insurance/compliance requirement if required for the work/customer
- capacity impossible and no Executive override is allowed
- known contract/payment prohibition
- executive hold
- required customer/prime agreement absent when acceptance would create legal commitment

Proposed award thresholds:

| Award value | Allowed award approvers |
| --- | --- |
| `$0-$49,999` | Regional Director, Executive, System Admin |
| `$50,000-$249,999` | Regional Director, Executive, System Admin |
| `$250,000+` | Executive, System Admin |

Recommendation: document award thresholds now and defer enforcement until awarded-to-project handoff unless product approves immediate award hardening.

## 9. Hard-Stop Rules

Hard stops must be explicit and should be limited to:

- tenant boundary mismatch
- invalid tenant ownership
- archived opportunity
- lack of actor permission
- missing core identity fields
- invalid lifecycle transition
- illegal or prohibited work
- explicit compliance hard stop
- explicit safety hard stop
- fraud or falsified evidence
- executive hold
- sanctioned/disallowed customer/vendor if later modeled
- duplicate active opportunity where no override policy exists

Do not create silent hard stops from operationally fixable issues.

## 10. Warning / Override Rules

The following should not automatically kill opportunity creation or pursuit approval:

- no relationship yet
- no relationship map yet
- weak relationship access
- no direct decision-maker yet
- no AP contact yet
- capacity unknown
- pricing incomplete
- margin unknown
- missing capacity requirement
- unclear scope
- non-critical constraints

These become warnings, constraints, action paths, future assigned tasks, and override records.

Recommended pursuit approval payload:

- `approval_note`
- `relationship_access_override_reason`
- `capacity_override_reason`
- `margin_override_reason`
- `constraints_override_reason`
- `missing_value_override_reason`
- `executive_override_reason` if applicable

If warnings exist and override reasons are missing, backend should return `400` with:

- `warnings`
- `required_override_fields`
- plain-language message

## 11. Approval Events And Audit

Existing pursuit event: `opportunity.pursuit_approved`.

Recommendation: use `opportunity.pursuit_approved` with override details in payload for now. Do not add `opportunity.pursuit_approval_overridden` unless product wants separate override reporting.

Existing award event: `opportunity.awarded`.

Future award override event should remain deferred unless award approval hardening requires separate reporting.

Every approval audit record should make clear:

- who approved
- what they approved
- status before and after
- estimated value
- approval tier
- warnings present
- warnings overridden
- override reasons
- authority role
- event correlation id

## 12. UI Behavior Rules

Opportunity UI should display:

- approval readiness
- approval tier
- required approver role
- warnings
- hard blockers
- override fields
- relationship access weakness
- capacity readiness weakness
- margin risk
- open constraints

Warnings should not hide the approval button from authorized users. Hard blockers should disable approval. If the user lacks threshold authority, the UI should show the required approver role and disable approval. Do not auto-escalate unless workflow support exists.

## 13. Required Future Implementation Scope

Recommended next coding sprint: Opportunity Approval Policy Hardening.

Scope:

- Add value-tier approval logic.
- Add approval tier/readiness output.
- Add threshold role checks.
- Add required override reason behavior for missing value.
- Add explicit constraint approval policy fields or a safe equivalent.
- Return `required_override_fields` with warnings.
- Persist approval tier and overridden warning types in event/audit payload.
- Update opportunity list/detail read models.
- Update pursuit approval modal.
- Update opportunity smoke coverage.
- Update docs.

Out of scope:

- project handoff
- awarded-to-project conversion
- capacity deployment
- proposal document generation
- pricing/estimating engine
- finance records
- new workflow categories

## 14. Open Questions / Confirmations Needed

1. Are the pursuit value thresholds approved?
2. Should Growth Director approve pursuit under `$50k`?
3. Should Growth Director be excluded from award acceptance?
4. Should weak/no relationship access always be warning + override and never a hard block?
5. Should capacity unknown be warning + override at pursuit stage?
6. Should margin unknown be warning + override at pursuit stage?
7. Should critical constraints hard-block only when `hard_stop = true`?
8. Should pursuit approval override use the existing `opportunity.pursuit_approved` event payload or a separate `opportunity.pursuit_approval_overridden` event?
9. Should award approval thresholds be implemented now or deferred to project handoff?
10. Should Executive Emergency Override exist, or remain out of scope?
11. Should missing estimated value be allowed for pursuit approval with `missing_value_override_reason`, or should estimated value become a hard blocker?
12. Should `System Admin` approval authority be restricted to non-production/testing contexts later?

## 15. GO / NO-GO Recommendation

Recommendation: **GO for a narrow Opportunity Approval Policy Hardening sprint only after product confirms the threshold and constraint semantics above.**

Recommendation: **NO-GO for Capacity Workspace, Project Handoff, Pursuit Management, awarded-to-project conversion, or deeper execution workflows until approval thresholds, constraint hard-stop semantics, and award authority are confirmed.**
