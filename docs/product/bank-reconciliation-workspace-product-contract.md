# Bank Reconciliation Workspace Product Contract

The Bank Reconciliation Workspace exposes the hardened Bank Reconciliation backend through an operator UI. It verifies bank truth against payment execution and cash receipt records.

Bank Reconciliation answers:

"Did the money actually clear the bank, what bank transaction proves it, and what exceptions require review?"

## Routes

- `/bank-reconciliation`
- `/bank-reconciliation/accounts/new`
- `/bank-reconciliation/accounts/:id`
- `/bank-reconciliation/accounts/:id/edit`
- `/bank-reconciliation/transactions/new`
- `/bank-reconciliation/transactions/:id`
- `/bank-reconciliation/transactions/:id/edit`
- `/reconciliation-matches/:id`

Scoped payment/cash routes are deferred until they can safely reuse the same workspace components.

## Landing Page

The landing page provides:

- summary cards for bank accounts, transactions, reconciliation states, cleared states, exceptions, and match states
- bank account queue
- bank transaction queue
- reconciliation match queue
- quick filters for unreconciled, exceptions, partial matches, debit, credit, cleared, returned, proposed matches, and approved matches
- create bank account action
- create manual bank transaction action
- future placeholders for bank feeds, statement import, processor settlement, accounting export, and treasury

The default operator focus is unreconciled transactions, open exceptions, partial matches, unmatched debits, unmatched credits, and matches needing review.

## Account Queue And Detail

The account queue shows account name, account type, institution, masked account number, currency, status, current balance snapshot, last statement date, last reconciled date, transaction count, unreconciled count, exception count, and updated date.

Account detail shows account metadata, reconciliation summary, recent transactions, exceptions, timeline, audit, and placeholders for future bank feed and statement import workflows.

## Transaction Queue And Detail

The transaction queue shows transaction date, posted date, bank account, direction, amount, currency, description, bank reference, external transaction id, payment method, transaction type, reconciliation status, cleared status, exception status, exception reason, source type, active match count, approved match amount, unmatched amount, recommended next action, and updated date.

Transaction detail shows bank truth, match workflows, matches, exceptions, reconciliation status, timeline, audit, accounting export placeholder, and processor settlement placeholder.

## Match Detail

Match detail shows match type, matched object type, matched object id, bank transaction context, payment context, cash context, invoice context where available, matched amount, match confidence, match status, match reason, variance amount, review/approval summary, boundary summary, and audit.

Operators can review, approve, reject, void, and archive matches when permissions allow.

## Create And Edit Forms

Bank account create/edit supports account name, account type, institution name, masked account number, routing last 4, currency, status where editable, opening balance, current balance snapshot, last statement date, and notes.

Security copy must remain visible:

"Never enter full account numbers, online banking credentials, passwords, or API tokens."

Manual bank transaction create/edit supports bank account, transaction date, posted date, direction, amount, currency, description, bank reference, external transaction id, payment method, transaction type, cleared status, notes, and exception reason where editable.

Manual bank transaction copy must remain visible:

"Manual bank transactions are records for reconciliation. They do not move money, create cash receipts, create payments, or update invoice balances."

## Matching Workflows

Supported match workflows:

- match debit transaction to payment batch through `POST /bank-transactions/:id/matches/payment-batch`
- match debit transaction to payment item through `POST /bank-transactions/:id/matches/payment-item`
- match credit transaction to cash receipt through `POST /bank-transactions/:id/matches/cash-receipt`
- context-only payment application match through `POST /bank-transactions/:id/matches/payment-application`

Payment application matching is context-only and must not update invoice balances.

## Exception Workflows

Operators can:

- open transaction exceptions with required `exception_reason`
- resolve transaction exceptions with required `resolution_note`
- ignore transactions with required `ignore_reason`
- archive transactions with required `archive_reason`

These workflows update reconciliation state only.

## Status Definitions

- Matched means linked to a SyncOS record.
- Cleared means bank-posted or bank-confirmed.
- Reconciled means reviewed and accepted.

The UI must keep these states visually and textually distinct.

## Placeholders

The workspace includes placeholder-only sections for:

- Bank Feed
- Statement Import
- Processor Settlement
- Accounting Export
- Treasury

No placeholder may expose a submit/import/connect/export/action button.

## Permissions

The UI surfaces these permissions:

- `bank_account.read`
- `bank_account.create`
- `bank_account.update`
- `bank_account.archive`
- `bank_account.timeline.read`
- `bank_account.audit.read`
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
- `reconciliation_match.read`
- `reconciliation_match.create`
- `reconciliation_match.review`
- `reconciliation_match.approve`
- `reconciliation_match.reject`
- `reconciliation_match.void`
- `reconciliation_match.archive`
- `reconciliation_match.audit.read`

Actions are hidden or disabled when permissions are missing. The backend remains authoritative.

## Boundaries

The workspace must not:

- connect bank feeds
- import statements
- process ACH, wire, card, check, bank transfer, or payroll provider submissions
- create cash receipts
- create payment applications
- update invoice paid or balance amounts
- create accounting exports
- create GL entries
- create tax filings
- create treasury forecasts
- move money

Required boundary language:

"Bank Reconciliation verifies bank activity. It does not move money, create accounting entries, file taxes, or update invoice balances."
