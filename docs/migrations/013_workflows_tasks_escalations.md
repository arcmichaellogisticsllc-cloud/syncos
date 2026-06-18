# 013 Workflows, Tasks, Escalations

## Purpose

Support configurable workflows, human tasks, automations, and escalation paths.

## Tables

- `workflow_definitions`: versioned workflow templates.
- `workflow_steps`: ordered step definitions.
- `workflow_runs`: executing workflow instances.
- `workflow_run_steps`: step instance state.
- `tasks`: human or system tasks.
- `task_assignments`: assigned users, roles, or teams.
- `escalation_policies`: escalation rules and timing.
- `escalation_events`: actual escalation events.

## Key Relationships

- `workflow_definitions.tenant_id` references `tenants.id`.
- `workflow_steps.workflow_definition_id` references `workflow_definitions.id`.
- `workflow_runs.workflow_definition_id` references `workflow_definitions.id`.
- `workflow_run_steps.workflow_run_id` references `workflow_runs.id`.
- `tasks.workflow_run_id` references `workflow_runs.id`.
- `task_assignments.task_id` references `tasks.id`.
- `escalation_events.task_id` references `tasks.id`.

## Notes

- Workflows should support versioning so running instances remain stable.
- Tasks should track due date, priority, status, assignee, and source entity.
