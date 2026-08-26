# Partner Dashboard And Action Center

## Purpose

The Partner Dashboard is the Partner Admin daily operating console for one server-derived Partner organization. It summarizes company readiness, crew readiness, active work, field execution status, Customer QC, corrections, settlements, payments, and Partner-safe performance.

It is not a Sync Admin dashboard and it does not create a second production, settlement, payable, or payment ledger.

## Read Model

Slice B2 makes the Dashboard a bounded server-side read model:

`GET /partner/dashboard`

The endpoint derives the Partner organization from authenticated server truth and requires Partner Admin read authority. A Partner Foreman-only account cannot read the financial Dashboard. The browser does not send an authority-bearing `organization_id`, scope header, or organization selector.

Response contract:

- `organization`
- `freshness`
- `company`
- `crews`
- `todayByCrew`
- `workOrders`
- `production`
- `qcCorrections`
- `actions`
- `financial`
- `performance`
- `panelStatus`
- `warnings`

The read model is evaluated with one server `asOf` / `calculatedAt` value inside a repeatable-read, read-only database transaction. Optional panel queries use safe panel states such as `READY`, `EMPTY`, and `UNAVAILABLE`; unavailable data is not substituted with zero.

Dashboard queries are bounded to current status, today/current Crew rows, active/recent Work Orders, current production and QC lineage, current settlement/payable/payment buckets, and the current Partner performance snapshot. Drill-through pages remain the source for detail history.

## Action Center

Actions are derived server-side from canonical source state on every dashboard read. Slice B does not persist Partner action cards and does not add dismiss or snooze behavior.

Action groups:

- Needs Your Action: Partner Admin-controlled blockers such as onboarding, compliance, missing Worker documentation, Crew setup, Foreman assignment, agreement action, and payment setup attention.
- Crew / Foreman Action: visible to the Partner Admin for oversight, but executed by the assigned Foreman in SyncField, such as missing JSA, unsubmitted production, missing evidence, and Customer correction work.
- Waiting / Informational: Sync review, Customer QC pending, Customer reinspection pending, awaiting Customer funds, and payment processing. These are not shown as Partner failures.

Priority policy:

- Critical: expired/missing compliance blocking active work, failed payment setup, or production-start blockers controlled by the Partner.
- High: Customer correction required, missing JSA on authorized work, unsubmitted production after the canonical workday, missing Foreman for assigned work, or agreement action blocking work.
- Medium: upcoming compliance or credential expiration, incomplete Worker documentation, incomplete Crew setup, or offered Work Order attention.
- Low / Informational: under Sync review, QC pending, Customer reinspection pending, awaiting Customer funds, or payment processing.

Actions are deduplicated by reason and source before the response is returned. Every CTA routes to an existing page such as `/partner/onboarding`, `/partner/compliance`, `/partner/workers`, `/partner/crews`, `/partner/work-orders`, `/partner/production`, `/partner/customer-qc`, `/partner/settlements`, `/partner/payments`, or valid SyncField routes.

## Daily Crew Status

Today by Crew shows Crew name, Foreman, Work Order, JSA status, production status, reported quantities by unit, Customer QC state, correction state, and last server activity.

Partner Admin monitoring remains read-only for field execution. JSA completion, production submission, and correction execution remain SyncField actions for authorized Foremen.

## Quantity Policy

Dashboard quantities are unit-aware. FT, EA, HR, and other units are displayed in separate rows. Reported, Customer accepted, and correction quantities remain separate.

## Financial Metrics

Dashboard financial status preserves these boundaries:

- Accepted Production Awaiting Settlement
- Issued Settlements
- Outstanding Partner Payable
- Eligible for Payment
- Awaiting Customer Funds
- Processing
- Paid This Month

The Dashboard endpoint returns authoritative financial totals. The frontend formats server-returned amounts. It does not calculate settlement line amounts, payable totals, payment eligibility, processing totals, paid totals, or accepted-production-awaiting-settlement from Partner rates, customer accepted quantities, retainage, coil/slack, or rate versions. Customer rates, customer invoice economics, Customer cash details beyond safe eligibility state, Sync margin, Sync spread, other Partner rates, full bank details, and full TIN are not displayed.

Partner coil/slack treatment is Partner-safe only and is returned only from Partner financial source fields. Customer coil treatment and any resulting Sync spread remain internal.

## Freshness And Failures

The dashboard displays the server-returned freshness label and provides manual Refresh. Refresh issues one Dashboard read-model request. Optional panel failures must render panel-level empty/error states where practical and must not block company context, Action Center, or Crew operations. Partner context conflict fails closed through the Slice A conflict UI.

Browser alerts are not valid dashboard error handling. A Partner route must resolve to ready, empty, action-required, locked, stale, error, or context-conflict state.

## Responsive Behavior

Desktop uses a full-width operational workspace with summary metrics, Action Center, Today by Crew, Work Orders, Production/QC, Financial status, and Performance.

Tablet stacks major dashboard columns when needed.

Mobile order is fixed company identity, Needs Your Action, Today by Crew, Work Orders, Production/QC, Settlements/Payments, then Performance. Tables collapse into labeled cards with no horizontal overflow.
