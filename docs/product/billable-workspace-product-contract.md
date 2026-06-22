# Billable Workspace Product Contract

This document defines future UI scope only. No Billable UI is included in the backend foundation sprint.

## Purpose

The future Billable Workspace should help billing and operations users review accepted QC work, resolve financial eligibility gaps, and mark items ready for future settlement.

## Routes

Future routes:

- `/billable-items`
- `/billable-items/:id`
- `/billable-items/:id/edit`

## Directory

Directory fields should include:

- status
- readiness score/status/band
- project
- work order
- production record
- QC review
- customer
- provider/crew
- approved quantity
- billable quantity
- held quantity
- unit
- rate source/confidence
- estimated amount
- retainage
- customer/prime acceptance
- billing package status
- documentation status
- warnings
- blockers
- recommended next action

## Detail Sections

Detail should show:

- overview
- QC context
- production context
- work order context
- project context
- quantity
- rate
- retainage
- customer/prime acceptance
- billing package
- holds/disputes
- readiness
- timeline
- audit
- future settlement placeholder
- future invoice/AR/cash placeholder

## Actions

Allowed actions should call backend routes only:

- recalculate readiness
- update rate/package/acceptance fields
- mark ready for settlement
- place hold
- release hold
- dispute
- resolve dispute
- void
- archive

No UI action may create settlement, settlement item, invoice, AR, payment, cash, payroll, or tax records.

## Permissions

UI must use `billable_item.*` permissions and hide or disable unavailable actions. Backend remains authoritative.

