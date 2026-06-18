# 012 Events, Actions, Approvals, Audit

## Purpose

Create the event, action, approval, and audit backbone for system traceability.

## Tables

- `events`: normalized domain events.
- `event_subscriptions`: delivery targets for event consumers.
- `event_deliveries`: delivery attempts and outcomes.
- `actions`: user or system actions requested or executed.
- `approval_policies`: approval rules by entity, amount, role, or workflow.
- `approval_requests`: approval instances.
- `approval_decisions`: approve, reject, delegate, or comment decisions.
- `audit_log`: immutable audit trail.

## Key Relationships

- `events.tenant_id` references `tenants.id`.
- `event_deliveries.event_id` references `events.id`.
- `actions.tenant_id` references `tenants.id`.
- `approval_requests.policy_id` references `approval_policies.id`.
- `approval_decisions.approval_request_id` references `approval_requests.id`.
- `audit_log.tenant_id` references `tenants.id`.

## Notes

- Audit records should be append-only.
- Events should carry type, aggregate, payload, idempotency key, and occurred timestamp.
