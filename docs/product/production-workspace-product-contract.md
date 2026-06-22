# Production Workspace Product Contract

Production Workspace is future scope. This document records the product boundary created by the backend foundation.

Production Workspace should expose field-truth production records after backend hardening is validated.

Future routes may include:

- `/production`
- `/production/new`
- `/production/:id`
- `/production/:id/edit`

The workspace must show:

- Production record directory
- Production detail
- Work Order context
- Project context
- Performer context
- Evidence metadata
- Quantity summary
- QC summary
- Billable summary
- Timeline
- Audit

Production Workspace must not create settlements, invoices, payments, payroll, AR, or cash records.

Foreman mobile experience, QC Workspace, file upload, and billing UI remain deferred.

## Backend Endpoints

The future UI should consume:

- `GET /production-records`
- `GET /production-records/:id/detail`
- `POST /production-records`
- `PATCH /production-records/:id`
- Production lifecycle action routes
- Evidence metadata routes
- Timeline and audit routes

The backend remains the source of truth for permissions, tenant isolation, validation, events, audit, and system actions.
