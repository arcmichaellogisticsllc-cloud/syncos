# Passport automatic external-payment recording

## Current state

Prepared on top of local candidate `25fe488`. This is an offline preparation package, not a connected integration. No application migration, deployment, secret, demo record, payment or webhook subscription is changed. Live reconciliation and polling fail closed; the separate read-only sandbox helper defaults off. Payment sending is not exposed.

The user approved automatic recording of payments made externally, while waiting for sandbox approval. Manual recording remains the operational mechanism until activation is separately verified. Both employee and partner workflows remain in scope; employee work must not create partner debt.

## Prepared and runnable

- `packages/passport`: internal normalized payment contract and exact whole-cent arithmetic; trusted tenant/account binding; explicit transaction/payable/payee mapping; eligibility/acceptance/cash checks; idempotent concurrent replay; exceptions for mismatches, duplicates already entered manually, failures, returns and reversals; immutable simulated recording provenance.
- Webhook intake interface: requires an injected successful verifier before decoding, bounds body size, validates customer scope, queues a refresh hint only. Never trusts callback amounts/status to record payment. No public route is registered until the provider authentication contract is verified.
- Polling interface: consumes bounded pages, saves a cursor only after processing the entire page, survives replay after partial failure, detects repeated cursors, leaves failed pages retryable. `listPage` is an interface, not an invented Treasury listing endpoint.
- Sandbox read helper: fixed sandbox Treasury transaction-detail URL, GET only, ten-second timeout, redirects rejected, sanitized errors, retryability indication. No transfer/create/update/delete/subscription methods.
- Simulation repository: serialized transactions with rollback and tenant/permission-filtered exceptions. In-memory test storage only; not durable production persistence.
- Eight-scenario offline report provides a finance exception-review preview with explicit synthetic labels. It is not a new authenticated application screen.
- Storage design draft kept outside the live migration manifest. It has not been applied or certified as a production migration.

Run from the repository:

```sh
npm run passport:test
npm run passport:simulate
```

The simulation uses only invented fixtures and writes its report under `test-results/passport-simulation`. It does not need provider credentials, a database or a network. Its internal status names and version number are test contracts, not undocumented assertions about Passport response JSON.

## Verified provider documentation

The page previously opened in the browser is the checkout **Accept Payments** endpoint (`/v1/checkout/v3/payment`). It must not be used as evidence of completed Treasury partner payouts:
https://docs.prioritycommerce.com/pce-product-hub/reference/get-all-payments

Treasury transaction detail is customer-scoped and lives under `/v1/passport/v1/customer/id/{customerId}/transaction/id/{id}`:
https://docs.prioritycommerce.com/pce-product-hub/reference/treasury-api-get-transaction

Treasury onboarding identifies the sandbox host, API key and customer identifier prerequisites:
https://docs.prioritycommerce.com/pce-product-hub/docs/treasury-getting-started

Webhook subscription setup is documented separately:
https://docs.prioritycommerce.com/pce-product-hub/reference/treasury-api-create-webhook

These sources identify the product boundary and endpoint, but do not prove our account's entitlements, payload mapping, signature algorithm, ordering, or payment finality. Never substitute Priority Software ERP documentation for Priority Commerce Passport.

## Integration contract to verify in sandbox

| Internal field | Required proof before mapping real data |
| --- | --- |
| customer/account/payee references | Stable account-scoped identifiers, linked explicitly to one SyncOS tenant and partner |
| transaction reference | Stable provider identity across webhook and polling; overlap with manually recorded references reviewed |
| amount/currency | Exact monetary representation, fees vs principal, foreign exchange and partial payments |
| direction | Outgoing partner payment; exclude inbound collections and own-account transfers |
| completed date/status | Authoritative completed meaning for each rail; submitted/processing never means paid |
| version | Verified monotonic revision or another ordering strategy backed by authoritative retrieval; no local receipt-time guesses |
| returns/reversals | Reliable linkage to original payment and audited adjustment policy |
| webhook authenticity | Exact raw-body signature headers, algorithm, timestamp/replay window, key rotation and delivery retries |
| listing/cursor | Treasury listing API, ordering, pagination, incremental lookback and late-event recovery |

## Production wiring still required

This package intentionally cannot update real financial rows. Before activation:

1. Implement the verified Treasury wire adapter and authenticated webhook route. Invalid/unknown data must fail closed or enter a review queue, not become completed money.
2. Finalize and test durable PostgreSQL inbox, observations, mapping, exception, cursor and recording migrations. Enforce composite tenant keys and a unique external transaction claim. Persist safe metadata only; reference secrets through existing secure configuration.
3. Wire the existing external-payment recording transaction with provider provenance, a service identity and permission checks. Lock payable and transaction references together. Deduplicate manual and automatic entries in the same transaction. Do not impersonate a human or fabricate receipt evidence.
4. Add the durable queue/worker schedule, bounded retry/backoff, leases, heartbeat/lag and dead-letter monitoring. An outage must retain evidence and stop cursor advancement; repeated notifications must not generate duplicate records.
5. Add authenticated finance exception/mapping screens using the tested tenant boundaries. Foremen and partners must not see internal reconciliation controls. Explicit approval is required for remapping and resolving financial conflicts.
6. Keep returns/reversals as visible exceptions until the compensating financial adjustment is verified. Never silently erase the original payment or credit a balance based only on an unverified webhook.

## Sandbox acceptance and rollout

- Capture redacted examples for pending, completed, failed, returned, reversed and partially completed payments on the enabled rails.
- Test duplicate delivery, same-ID conflicting data, out-of-order notifications, retry after crash, account/tenant spoofing, unmatched payees, manual overlap, multiple payments exhausting one balance and concurrent workers.
- Confirm employee work does not create partner payables. Confirm raw bank details and secrets never appear in logs/reports.
- Reconcile a known sandbox control set in read-only/dry-run mode and compare totals with Passport. Confirm no writes to production hosts are possible in sandbox mode.
- Back up and rehearse recovery of payment metadata, audit and existing records. Test restart/rollback without duplicate financial rows.
- Enable only a reviewed sandbox connection first. Production requires separate verified configuration and activation; payment initiation remains disabled.

The existing manual payment flow, demo data and tested business requirements are preserved. This preparation does not claim real-device pilot signoff or live Passport acceptance.

## Preparation verification

- 35 dedicated tests passed, zero failed/skipped: `npm run passport:test`.
- Both JavaScript entry points passed syntax validation.
- Offline simulation generated eight scenarios successfully, without credentials, network or database access.
- New workspace metadata and scripts are registered; no third-party dependency added.
- Existing application code and migration manifest are unchanged in this preparation commit. The prior 822-browser-test result is historical; it is not claimed as a new full application run.

## UI follow-up

An authenticated, simulation-only `/passport` workspace and permission-protected preview endpoint are now implemented. See `passport-ui.md` for behavior, test evidence and the remaining live-integration boundary. This supersedes the earlier statement that no application screen exists; durable live finance operations remain pending.
