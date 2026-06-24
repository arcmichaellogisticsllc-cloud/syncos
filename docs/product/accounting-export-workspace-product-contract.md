# Accounting Export Workspace Product Contract

Accounting Export Workspace exposes the hardened Accounting Export backend as an operator control surface for export preparation only.

## Routes

- `/accounting-exports`
- `/accounting-exports/new`
- `/accounting-exports/:id`
- `/accounting-exports/:id/edit`
- `/accounting-export-items/:id`

No QuickBooks, Sage, NetSuite, ERP, GL, tax, accounting close, payment, bank transaction, or external accounting provider routes are added.

## Queue

The queue shows export batch number, export type, target system, export format, status, approval status, export status, period, item count, debit/credit/total amounts, currency, generated file reference, external batch reference, submitted/accepted/rejected dates, error count, retry count, recommended next action, and updated date.

Filters include export type, target system, export format, status, approval status, export status, period range, submitted/accepted date range, error flags, archive state, text search, and sort controls.

## Forms

Create requires export type, target system, and export format. Period, currency, notes, and override reasons are optional.

Edit allows backend-supported preparation fields only: period, target system, export format, currency, notes, and override reasons.

## Item Management

Operators can add supported source objects as export items, edit mapping fields, open item detail, and archive export items. Item actions call only Accounting Export backend routes.

## Source Context

Source context is displayed through safe summaries, IDs, and links where existing routes are available. Source records are not mutated by Accounting Export.

## Mapping

The workspace surfaces unmapped, mapped, mapping warning, mapping error, and override mapped states. Mapping edits prepare export data only and do not create external accounting records.

## Target / Format

Target system and export format are status labels. QuickBooks, Sage, NetSuite, ERP APIs, API payload generation, IIF generation, and file downloads remain future scope unless a later backend contract exposes safe metadata-only behavior.

## Lifecycle

Generate is status-only. Submit review, start review, approve, reject, mark submitted, mark accepted, mark failed, cancel, and archive use hardened backend routes. Mark submitted and accepted are manual/status-only references.

## Placeholders

The workspace includes placeholders for future QuickBooks, ERP, GL, Tax, Accounting Close, and File Download workflows.

## Permissions

UI actions are hidden or disabled using `accounting_export_batch.*` and `accounting_export_item.*` permissions. Backend permissions remain authoritative.

## Boundaries

The workspace does not call QuickBooks, Sage, NetSuite, or ERP APIs; does not post GL entries; does not create journals, tax filings, W2s, 1099s, payments, bank transactions, accounting-close records, external records, file downloads, or source mutations.
