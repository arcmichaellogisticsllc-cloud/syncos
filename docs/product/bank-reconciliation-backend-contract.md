# Bank Reconciliation Backend Contract

Current foundation: manual, tenant-scoped bank reconciliation contract only.

Bank Reconciliation verifies bank truth. It links actual bank activity to SyncOS payment execution and cash receipt records. It does not create payment execution, cash receipts, payment applications, invoice balance updates, accounting exports, GL entries, tax filings, treasury forecasts, bank feeds, statement imports, ACH, wire, card payout, check, payroll provider submission, or any money movement workflow.

## Object Model

Use Hybrid Option D:

- `bank_accounts` store masked bank account context.
- `bank_transactions` store actual bank activity entered manually in this foundation sprint.
- `reconciliation_matches` connect bank transactions to payment batches, payment items, cash receipts, and context-only payment applications.

## Bank Accounts

`bank_accounts` includes account name, account type, institution name, masked account number, routing last4, currency, status, balance context, statement/reconciliation dates, notes, archive fields, and audit fields.

Allowed account types: `operating`, `payroll`, `tax`, `savings`, `escrow`, `credit_card`, `other`.

Security rules:

- Do not store full bank account numbers.
- Do not store bank credentials.
- Do not store bank login information.
- Do not store API tokens.

## Bank Transactions

`bank_transactions` includes bank account, transaction/posted dates, debit/credit direction, amount, currency, description, bank reference, external transaction id, payment method, transaction type, reconciliation status, cleared status, exception status, ignore fields, source type, notes, archive fields, and audit fields.

Allowed directions: `debit`, `credit`.

Allowed transaction types: `payment_out`, `deposit_in`, `fee`, `transfer`, `reversal`, `chargeback`, `adjustment`, `interest`, `unknown`.

Manual creation requires `source_type = manual`. Statement import, bank feed, and processor import remain future scope.

## Reconciliation Matches

`reconciliation_matches` includes bank transaction, match target fields, explicit payment/cash references, matched amount, confidence, status, variance, review/approval/rejection fields, overrides, notes, void/archive fields, and audit fields.

Allowed match types: `payment_batch`, `payment_item`, `cash_receipt`, `payment_application_context`, `manual_adjustment`, `unknown`.

Allowed statuses: `proposed`, `reviewed`, `approved`, `rejected`, `voided`, `archived`.

Approved matches recalculate bank transaction reconciliation status. Cash receipt matches may update cash receipt deposit/reconciliation status. Payment application matches are context-only and must not update invoices.

## Routes

Bank accounts:

- `GET /bank-accounts`
- `GET /bank-accounts/:id`
- `GET /bank-accounts/:id/detail`
- `POST /bank-accounts`
- `PATCH /bank-accounts/:id`
- `POST /bank-accounts/:id/archive`
- `GET /bank-accounts/:id/timeline`
- `GET /bank-accounts/:id/audit-summary`

Bank transactions:

- `GET /bank-transactions`
- `GET /bank-transactions/:id`
- `GET /bank-transactions/:id/detail`
- `POST /bank-transactions`
- `PATCH /bank-transactions/:id`
- `POST /bank-transactions/:id/ignore`
- `POST /bank-transactions/:id/archive`
- `POST /bank-transactions/:id/open-exception`
- `POST /bank-transactions/:id/resolve-exception`
- `GET /bank-transactions/:id/timeline`
- `GET /bank-transactions/:id/audit-summary`

Matching:

- `POST /bank-transactions/:id/matches/payment-batch`
- `POST /bank-transactions/:id/matches/payment-item`
- `POST /bank-transactions/:id/matches/cash-receipt`
- `POST /bank-transactions/:id/matches/payment-application`
- `GET /reconciliation-matches`
- `GET /reconciliation-matches/:id`
- `GET /reconciliation-matches/:id/detail`
- `POST /reconciliation-matches/:id/review`
- `POST /reconciliation-matches/:id/approve`
- `POST /reconciliation-matches/:id/reject`
- `POST /reconciliation-matches/:id/void`
- `POST /reconciliation-matches/:id/archive`
- `GET /reconciliation-matches/:id/audit-summary`

## Status Calculation

For a bank transaction:

- `archived` if archived.
- `ignored` if ignored.
- `unreconciled` if no active approved matches.
- `partially_matched` if approved matches total less than bank transaction amount.
- `matched` if approved matches equal bank transaction amount.
- `exception` if approved matches exceed bank transaction amount.

Cleared status is bank/manual context and is not automatically changed by matching.

## Permissions

Bank account:

- `bank_account.read`
- `bank_account.create`
- `bank_account.update`
- `bank_account.archive`
- `bank_account.timeline.read`
- `bank_account.audit.read`

Bank transaction:

- `bank_transaction.read`
- `bank_transaction.create`
- `bank_transaction.update`
- `bank_transaction.archive`
- `bank_transaction.match`
- `bank_transaction.ignore`
- `bank_transaction.open_exception`
- `bank_transaction.resolve_exception`
- `bank_transaction.timeline.read`
- `bank_transaction.audit.read`

Reconciliation match:

- `reconciliation_match.read`
- `reconciliation_match.create`
- `reconciliation_match.review`
- `reconciliation_match.approve`
- `reconciliation_match.reject`
- `reconciliation_match.void`
- `reconciliation_match.archive`
- `reconciliation_match.audit.read`

## Events

Bank account events:

- `bank_account.created`
- `bank_account.updated`
- `bank_account.archived`

Bank transaction events:

- `bank_transaction.created`
- `bank_transaction.updated`
- `bank_transaction.matched`
- `bank_transaction.exception_opened`
- `bank_transaction.exception_resolved`
- `bank_transaction.ignored`
- `bank_transaction.archived`

Reconciliation match events:

- `reconciliation_match.created`
- `reconciliation_match.reviewed`
- `reconciliation_match.approved`
- `reconciliation_match.rejected`
- `reconciliation_match.voided`
- `reconciliation_match.archived`

Contextual events:

- `payment_item.bank_match_approved`
- `cash_receipt.bank_match_approved`

Every write uses the write-action helper and must create event, event payload, audit log, and system action.

## Search

Global search includes bank accounts, bank transactions, and reconciliation matches. Archived records are excluded unless `archived=true`.

## Deferred Scope

Deferred: Bank Reconciliation UI, bank feeds, statement imports, processor settlement import, accounting export, GL entries, treasury forecasting, tax filing, automatic matching AI, cash receipt creation from bank activity, payment execution creation from bank activity, and invoice balance updates from reconciliation.
