# Production KPI Foundation

Sprint 6 does not write KPI snapshots during QC or billable production actions.

Future KPI runtime work should calculate these metrics from tenant-scoped `production_records` status/history and production events:

- Production Approval Rate: approved production divided by submitted production.
- Correction Rate: correction_required production divided by submitted production.
- QC Score: derived from approval rate, correction rate, and rejection rate.

The KPI runtime, KPI snapshot write cadence, and KPI event/audit policy are deferred until the KPI engine is explicitly approved.
