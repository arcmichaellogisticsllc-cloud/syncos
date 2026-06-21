# Opportunity Approval Policy

## Growth Principle

Operationally fixable issues must not kill work acquisition. Weak relationship access, missing relationship map, unknown capacity, unknown margin, unclear scope, missing AP contact, missing field validator, missing capacity requirements, and non-hard-stop constraints are warnings that require override reasons and management visibility.

## Hard Stop Principle

Hard blockers are limited to tenant integrity, permissions, lifecycle invalidity, missing core identity fields, legal/compliance/safety hard stops, fraud or falsified evidence, executive hold, and explicit `hard_stop` constraints. Hard blockers cannot be overridden in this sprint.

## Pursuit Approval Tiers

| Tier | Estimated value | Required roles |
| --- | --- | --- |
| `tier_1_under_50k` | `$0-$49,999` | Growth Director, Regional Director, Executive, System Admin |
| `tier_2_50k_to_250k` | `$50,000-$249,999` | Regional Director, Executive, System Admin |
| `tier_3_250k_plus` | `$250,000+` | Executive, System Admin |
| `missing_value` | Missing estimated value | Regional Director, Executive, System Admin plus `missing_value_override_reason` |

System Admin authority is for testing/admin control, not normal business approval.

## Pursuit Approval Rules

`POST /opportunities/:id/pursuit-approve` requires `opportunity.pursuit_approve` and the actor must satisfy the value tier role. If the actor has permission but lacks tier authority, the API returns `403` with the tier, required roles, and actor roles.

Warnings require override reasons:

- relationship warnings require `relationship_access_override_reason`
- capacity warnings require `capacity_override_reason`
- margin warnings require `margin_override_reason`
- constraint warnings require `constraints_override_reason`
- missing estimated value requires `missing_value_override_reason`
- missing pursuit/source readiness uses `pursuit_approval_override_reason`

If warnings exist and required reasons are missing, the API returns `400` with `warnings`, `required_override_fields`, `approval_tier`, and `required_roles`.

## Constraint Behavior

Constraints now support `hard_stop`, `override_allowed`, and `approval_behavior`.

Default behavior:

- `low`: warning
- `medium`: warning
- `high`: override required
- `critical` with `hard_stop = false`: override required
- `critical` with `hard_stop = true`: hard block

Existing constraints are not retroactively hard stops unless `hard_stop` is explicitly true.

## Award Deferral

Award threshold enforcement is deferred to a future Award / Project Handoff sprint. Award acceptance remains on the existing `opportunity.award` route and current backend role checks. Awarded opportunity status creates no projects, work orders, capacity deployments, contracts, settlements, invoices, payments, payroll, or cash records.

## Event And Audit

Approval uses existing `opportunity.pursuit_approved`. No separate override event is created. The event/audit payload includes approval tier, approver roles, warnings, hard blockers, override reasons, estimated value, relationship access score, capacity readiness score, and margin potential score.

## UI Behavior

The Opportunity approval modal shows approval tier, required roles, actor authority state, warnings, blockers, and required override fields. Warnings do not hide the approval action. Hard blockers and insufficient tier authority disable approval.

## Deferred Items

- award approval thresholds
- Executive Emergency Override
- project handoff
- capacity deployment
- proposal generation
- pricing/margin engine
- finance records
- workflow escalation automation
