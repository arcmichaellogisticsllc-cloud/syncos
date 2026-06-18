# 009 Projects, Work Orders, Production

## Purpose

Manage awarded work from project setup through work orders and production tracking.

## Tables

- `projects`: awarded or active bodies of work.
- `project_locations`: job sites and operating areas.
- `project_participants`: customers, contractors, providers, and internal teams.
- `work_orders`: executable units of work.
- `work_order_assignments`: assigned crews, workers, equipment, and providers.
- `production_entries`: quantities, units, progress, and field production records.
- `production_adjustments`: corrections and approvals for production entries.

## Key Relationships

- `projects.tenant_id` references `tenants.id`.
- `projects.opportunity_id` references `opportunities.id`.
- `project_locations.project_id` references `projects.id`.
- `work_orders.project_id` references `projects.id`.
- `work_order_assignments.work_order_id` references `work_orders.id`.
- `production_entries.work_order_id` references `work_orders.id`.

## Notes

- Work orders should include schedule, status, scope, unit type, and estimated quantity.
- Production entries should preserve submitter, source, work date, and approval status.
