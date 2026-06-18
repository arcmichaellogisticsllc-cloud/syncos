# Write Endpoint Contract

Every write endpoint must execute the same ordered contract. This applies to create, update, delete, state transition, import, approval, assignment, and generated-action endpoints.

## Required Sequence

1. Check permission.
2. Validate lifecycle rule.
3. Write object change.
4. Create event.
5. Create audit log.
6. Trigger system actions.

## Step Details

### 1. Check Permission

Verify the caller can perform the requested action for the tenant, object type, object scope, and target lifecycle transition.

Permission checks must happen before validation that could reveal protected object details.

### 2. Validate Lifecycle Rule

Confirm the requested change is valid for the object's current state.

Lifecycle validation includes status transitions, required fields, ownership rules, compliance gates, approval requirements, capacity constraints, and immutable record rules.

### 3. Write Object Change

Persist the requested domain change inside a transaction.

The write must be idempotent where clients may safely retry requests. Posted financial records, audit records, and event records must not be silently rewritten.

### 4. Create Event

Create a domain event that describes the committed change.

Events must include tenant, aggregate type, aggregate ID, event type, actor, occurred timestamp, idempotency key when available, and enough payload for downstream consumers to react without reinterpreting the original request.

### 5. Create Audit Log

Append an audit record for the action.

Audit records must include tenant, actor, action, target entity, before and after references or summaries, request metadata, and timestamp. Audit records are append-only.

### 6. Trigger System Actions

Dispatch follow-up work after the object change, event, and audit record exist.

System actions include workflow starts, task creation, notifications, recommendation refreshes, KPI recalculation, event delivery, compliance checks, and escalation processing.

## Transaction Boundary

The object change, domain event, and audit log should be committed atomically. System actions should be triggered after commit through an outbox, queue, or workflow dispatcher so external failures do not roll back the committed business change.

## Failure Rules

- Permission failure returns forbidden without writing lifecycle, event, or audit records except security telemetry where configured.
- Lifecycle failure returns a validation conflict and does not write the object change.
- Object write failure does not create event, audit, or system actions.
- Event or audit creation failure rolls back the object change.
- System action failure is retried asynchronously and recorded as a delivery or workflow failure.
