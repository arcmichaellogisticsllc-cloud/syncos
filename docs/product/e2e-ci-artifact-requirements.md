# E2E CI Artifact Requirements

## Purpose

Browser E2E certification must leave enough artifacts to diagnose failures, prove route/workflow coverage, and support release signoff.

## Required Screenshots Per Major Domain

For each major workspace domain, capture:

* list or queue
* create form
* detail header
* scorecard / summary
* primary action modal
* timeline tab
* audit authorized
* boundary placeholder

## Required E2E Screenshots

* `E2E-A-signal-to-opportunity.png`
* `E2E-B-opportunity-to-project.png`
* `E2E-C-project-to-qc.png`
* `E2E-D-qc-to-cash-application.png`
* `E2E-E-settlement-to-payment-execution.png`
* `E2E-F-payroll-to-payment-execution.png`
* `E2E-G-bank-reconciliation.png`
* `E2E-H-accounting-export.png`

## Video Rules

PR runs:

* retain videos on failure only
* keep videos short by splitting tests by workflow group

Nightly certification runs:

* retain full canonical videos

Release certification runs:

* retain full canonical videos and failure videos

Required certification videos:

* `canonical-demo-admin.webm`
* `canonical-demo-finance.webm`
* `canonical-demo-ops.webm`
* `canonical-demo-readonly.webm`

## Trace Rules

If Playwright is selected:

* PR runs: trace on first retry
* normal CI: retain trace on failure
* nightly certification: trace on

Required trace names:

* `trace-growth-to-opportunity.zip`
* `trace-opportunity-to-project.zip`
* `trace-project-to-qc.zip`
* `trace-revenue-cycle.zip`
* `trace-cost-labor-payment.zip`
* `trace-bank-reconciliation.zip`
* `trace-accounting-export.zip`

## Reports

Required reports:

* HTML test report if tool supports it
* JSON/JUnit report for CI annotations
* route matrix result
* modal/action matrix result
* boundary assertion report
* persona permission result
* timeline/audit result
* seed manifest with object IDs for the run

## Artifact Retention

Recommended:

* PR failure artifacts: 7 days
* nightly certification artifacts: 14 days
* release certification artifacts: 30 days
* successful PR screenshots: optional, retain only summary unless product requires proof screenshots

## CI Browser Test Rules

Recommended job order:

1. Checkout repo.
2. Install dependencies.
3. Start Postgres service.
4. Create fresh database.
5. Run `db:verify`.
6. Run `seed:e2e-demo` if implemented.
7. Build API, worker, web.
8. Start API server.
9. Start web server.
10. Wait for health endpoints.
11. Run smoke tests.
12. Run browser E2E tests.
13. Upload screenshots/videos/traces/reports.
14. Drop database.

Recommended future command structure:

```bash
npm ci

DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} npm run db:verify
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} npm run seed:e2e-demo

npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web

DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} \
AUTH_JWT_SECRET=e2e-secret \
PORT=3137 \
npm run start -w @syncos/api

NEXT_PUBLIC_API_BASE_URL=http://localhost:3137 \
PORT=3138 \
npm run start -w @syncos/web

API_BASE_URL=http://localhost:3137 \
WEB_BASE_URL=http://localhost:3138 \
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} \
npm run e2e
```

Exact commands may need adjustment based on actual future start scripts and selected browser tool.

## CI Tiers

### PR Critical Path

* Chromium only
* headless
* critical workflows only
* failure screenshots/videos/traces

### Nightly Certification

* full canonical path
* all required personas
* full boundary assertions
* screenshots/videos/traces
* optional multi-browser once stable

### Release Certification

* full suite required before external integrations

## Artifact Security

* Do not upload secrets or bearer tokens.
* Redact storage state from public artifacts.
* Do not capture full bank account numbers because they should never be entered or stored.
* Do not capture external credentials because integrations are out of scope.

## Open Confirmations

* Should successful PR screenshots be retained or only failure artifacts?
* Should certification videos be retained for 30 days or longer?
* Should traces be mandatory for all nightly tests or only failures after initial stabilization?
