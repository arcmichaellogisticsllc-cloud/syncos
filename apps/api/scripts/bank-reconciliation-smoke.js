const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.AUTH_JWT_SECRET;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!secret) throw new Error("AUTH_JWT_SECRET is required");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const seeded = await client.query(`
      SELECT u.id AS user_id, t.id AS tenant_id, tu.id AS tenant_user_id
      FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id
      JOIN tenants t ON t.id = tu.tenant_id
      WHERE u.email = 'admin@jackson-telcom.local'
        AND t.slug = 'jackson-telcom'
      LIMIT 1
    `);
    if (!seeded.rows[0]) throw new Error("Seeded admin user was not found");
    const { user_id: userId, tenant_id: tenantId, tenant_user_id: tenantUserId } = seeded.rows[0];
    for (const role of ["Billing Manager", "Finance Manager", "Operations Manager"]) await assignRole(client, tenantId, tenantUserId, role);
    const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedToken = createToken({ sub: await createLimitedUser(client, tenantId), tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const marker = `BANKREC${Date.now()}`;
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/bank-accounts", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/bank-accounts", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/bank-accounts/${outside.accountId}/detail`, `Bearer ${token}`, 404);

    await expectStatus("full account number rejected", "POST", "/bank-accounts", `Bearer ${token}`, 400, {
      account_name: `Bad Account ${marker}`,
      account_type: "operating",
      currency: "USD",
      masked_account_number: "123456789012",
    });
    await expectStatus("credentials rejected", "POST", "/bank-accounts", `Bearer ${token}`, 400, {
      account_name: `Credential Account ${marker}`,
      account_type: "operating",
      currency: "USD",
      credential: "blocked",
    });

    const account = await expectStatus("bank account creation works", "POST", "/bank-accounts", `Bearer ${token}`, 201, {
      account_name: `Operating ${marker}`,
      account_type: "operating",
      currency: "USD",
      institution_name: "Smoke Bank",
      masked_account_number: "****1234",
      routing_last4: "2222",
    });
    if (account.status !== "active" || account.account_type !== "operating") throw new Error("Bank account defaults were incorrect");
    const updatedAccount = await expectStatus("bank account update works", "PATCH", `/bank-accounts/${account.id}`, `Bearer ${token}`, 200, { notes: "Smoke updated." });
    if (updatedAccount.notes !== "Smoke updated.") throw new Error("Bank account update failed");

    await expectStatus("invalid direction rejected", "POST", "/bank-transactions", `Bearer ${token}`, 400, transactionPayload(account.id, { direction: "bad" }));
    await expectStatus("invalid transaction type rejected", "POST", "/bank-transactions", `Bearer ${token}`, 400, transactionPayload(account.id, { transaction_type: "bad" }));
    await expectStatus("amount must be positive", "POST", "/bank-transactions", `Bearer ${token}`, 400, transactionPayload(account.id, { amount: 0 }));

    const debit = await expectStatus("manual debit transaction creation works", "POST", "/bank-transactions", `Bearer ${token}`, 201, transactionPayload(account.id, {
      direction: "debit",
      amount: 125,
      description: `Payment debit ${marker}`,
      transaction_type: "payment_out",
      bank_reference: `BANK-DEBIT-${marker}`,
      cleared_status: "posted",
    }));
    if (debit.reconciliation_status !== "unreconciled" || debit.source_type !== "manual") throw new Error("Debit transaction defaults were incorrect");
    const credit = await expectStatus("manual credit transaction creation works", "POST", "/bank-transactions", `Bearer ${token}`, 201, transactionPayload(account.id, {
      direction: "credit",
      amount: 200,
      description: `Deposit credit ${marker}`,
      transaction_type: "deposit_in",
      bank_reference: `BANK-CREDIT-${marker}`,
      cleared_status: "posted",
    }));
    const updatedTransaction = await expectStatus("bank transaction update works", "PATCH", `/bank-transactions/${debit.id}`, `Bearer ${token}`, 200, { notes: "Debit reviewed." });
    if (updatedTransaction.notes !== "Debit reviewed.") throw new Error("Bank transaction update failed");

    const paymentFixture = await createExecutedPayment(client, tenantId, userId, marker, 125);
    const cashFixture = await createCashReceipt(client, tenantId, userId, marker, 200);
    const forbiddenBefore = await forbiddenCounts(client, tenantId);

    await expectStatus("wrong direction requires override", "POST", `/bank-transactions/${credit.id}/matches/payment-batch`, `Bearer ${token}`, 400, {
      payment_batch_id: paymentFixture.batchId,
      matched_amount: 100,
    });
    const batchMatch = await expectStatus("match debit transaction to payment batch works", "POST", `/bank-transactions/${debit.id}/matches/payment-batch`, `Bearer ${token}`, 201, {
      payment_batch_id: paymentFixture.batchId,
      matched_amount: 50,
      match_confidence: "high",
      match_reason: "Batch reference matched.",
    });
    if (batchMatch.match_type !== "payment_batch" || batchMatch.match_status !== "proposed") throw new Error("Payment batch match was incorrect");
    await expectStatus("matched amount cannot exceed remaining unless override", "POST", `/bank-transactions/${debit.id}/matches/payment-item`, `Bearer ${token}`, 400, {
      payment_item_id: paymentFixture.itemId,
      matched_amount: 100,
    });
    const itemMatch = await expectStatus("match debit transaction to payment item works", "POST", `/bank-transactions/${debit.id}/matches/payment-item`, `Bearer ${token}`, 201, {
      payment_item_id: paymentFixture.itemId,
      matched_amount: 75,
      match_confidence: "exact",
    });
    const receiptMatch = await expectStatus("match credit transaction to cash receipt works", "POST", `/bank-transactions/${credit.id}/matches/cash-receipt`, `Bearer ${token}`, 201, {
      cash_receipt_id: cashFixture.receiptId,
      matched_amount: 200,
      match_confidence: "exact",
    });
    if (receiptMatch.match_type !== "cash_receipt") throw new Error("Cash receipt match was incorrect");

    const reviewed = await expectStatus("review match works", "POST", `/reconciliation-matches/${batchMatch.id}/review`, `Bearer ${token}`, 201, { review_note: "Reviewed." });
    if (reviewed.match_status !== "reviewed") throw new Error("Review did not set reviewed");
    const approvedBatchMatch = await expectStatus("approve match works", "POST", `/reconciliation-matches/${batchMatch.id}/approve`, `Bearer ${token}`, 201, { approval_note: "Approved." });
    if (approvedBatchMatch.match_status !== "approved") throw new Error("Approve did not set approved");
    const approvedItemMatch = await expectStatus("approve second match creates full match", "POST", `/reconciliation-matches/${itemMatch.id}/approve`, `Bearer ${token}`, 201, { approval_note: "Approved item." });
    if (approvedItemMatch.match_status !== "approved") throw new Error("Approve item did not set approved");
    const approvedReceiptMatch = await expectStatus("approve receipt match works", "POST", `/reconciliation-matches/${receiptMatch.id}/approve`, `Bearer ${token}`, 201, { approval_note: "Approved receipt." });
    if (approvedReceiptMatch.match_status !== "approved") throw new Error("Approve receipt did not set approved");
    const debitDetail = await expectStatus("full match sets matched", "GET", `/bank-transactions/${debit.id}/detail`, `Bearer ${token}`, 200);
    if (debitDetail.bank_transaction.reconciliation_status !== "matched") throw new Error("Debit was not fully matched");
    const creditDetail = await expectStatus("cash receipt status updates without invoice balance update", "GET", `/bank-transactions/${credit.id}/detail`, `Bearer ${token}`, 200);
    if (creditDetail.bank_transaction.reconciliation_status !== "matched") throw new Error("Credit was not fully matched");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "approved matches");

    const rejectTransaction = await createTransactionViaApi(token, account.id, `Reject ${marker}`, 35);
    const rejectFixture = await createExecutedPayment(client, tenantId, userId, `${marker}REJECT`, 35);
    const rejectMatch = await expectStatus("reject fixture match create", "POST", `/bank-transactions/${rejectTransaction.id}/matches/payment-batch`, `Bearer ${token}`, 201, { payment_batch_id: rejectFixture.batchId, matched_amount: 35 });
    const rejected = await expectStatus("reject match works", "POST", `/reconciliation-matches/${rejectMatch.id}/reject`, `Bearer ${token}`, 201, { rejection_reason: "wrong_reference" });
    if (rejected.match_status !== "rejected") throw new Error("Reject did not set rejected");

    const partialTransaction = await createTransactionViaApi(token, account.id, `Partial ${marker}`, 80);
    const partialFixture = await createExecutedPayment(client, tenantId, userId, `${marker}PART`, 80);
    const partialMatch = await expectStatus("partial match create", "POST", `/bank-transactions/${partialTransaction.id}/matches/payment-batch`, `Bearer ${token}`, 201, { payment_batch_id: partialFixture.batchId, matched_amount: 40 });
    await expectStatus("partial match approve", "POST", `/reconciliation-matches/${partialMatch.id}/approve`, `Bearer ${token}`, 201, { approval_note: "Partial." });
    const partialDetail = await expectStatus("partial match sets partially_matched", "GET", `/bank-transactions/${partialTransaction.id}/detail`, `Bearer ${token}`, 200);
    if (partialDetail.bank_transaction.reconciliation_status !== "partially_matched") throw new Error("Partial match did not set partially_matched");
    await expectStatus("void match recalculates transaction status", "POST", `/reconciliation-matches/${partialMatch.id}/void`, `Bearer ${token}`, 201, { void_reason: "smoke_void" });
    const afterVoid = await expectStatus("void recalculation visible", "GET", `/bank-transactions/${partialTransaction.id}/detail`, `Bearer ${token}`, 200);
    if (afterVoid.bank_transaction.reconciliation_status !== "unreconciled") throw new Error("Void did not recalculate transaction status");

    const archiveMatchTransaction = await createTransactionViaApi(token, account.id, `Archive Match ${marker}`, 45);
    const archiveFixture = await createExecutedPayment(client, tenantId, userId, `${marker}ARCHM`, 45);
    const archiveMatch = await expectStatus("archive fixture match create", "POST", `/bank-transactions/${archiveMatchTransaction.id}/matches/payment-batch`, `Bearer ${token}`, 201, { payment_batch_id: archiveFixture.batchId, matched_amount: 45 });
    await expectStatus("archive match works", "POST", `/reconciliation-matches/${archiveMatch.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });

    const exceptionTransaction = await createTransactionViaApi(token, account.id, `Exception ${marker}`, 55);
    await expectStatus("open exception requires reason", "POST", `/bank-transactions/${exceptionTransaction.id}/open-exception`, `Bearer ${token}`, 400, {});
    const opened = await expectStatus("open exception works", "POST", `/bank-transactions/${exceptionTransaction.id}/open-exception`, `Bearer ${token}`, 201, { exception_reason: "unknown_debit" });
    if (opened.exception_status !== "open") throw new Error("Open exception did not set open");
    const resolved = await expectStatus("resolve exception works", "POST", `/bank-transactions/${exceptionTransaction.id}/resolve-exception`, `Bearer ${token}`, 201, { resolution_note: "Reviewed." });
    if (resolved.exception_status !== "resolved") throw new Error("Resolve exception did not set resolved");

    const ignoredTransaction = await createTransactionViaApi(token, account.id, `Ignore ${marker}`, 25);
    await expectStatus("ignore transaction works", "POST", `/bank-transactions/${ignoredTransaction.id}/ignore`, `Bearer ${token}`, 201, { ignore_reason: "duplicate_bank_feed_line" });
    const archivedTransaction = await createTransactionViaApi(token, account.id, `Archive Tx ${marker}`, 25);
    await expectStatus("archive transaction works", "POST", `/bank-transactions/${archivedTransaction.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });

    const accountList = await expectStatus("list bank accounts returns enriched fields", "GET", `/bank-accounts?q=${encodeURIComponent(marker)}`, `Bearer ${token}`, 200);
    if (!accountList.some((row) => row.id === account.id && row.transaction_count >= 1)) throw new Error("Account list missing enriched account");
    const transactionList = await expectStatus("list transactions returns enriched fields", "GET", `/bank-transactions?q=${encodeURIComponent(marker)}`, `Bearer ${token}`, 200);
    if (!transactionList.some((row) => row.id === debit.id && row.recommended_next_action)) throw new Error("Transaction list missing enriched transaction");
    const matchDetail = await expectStatus("match detail works", "GET", `/reconciliation-matches/${batchMatch.id}/detail`, `Bearer ${token}`, 200);
    if (matchDetail.boundary_summary.moves_money) throw new Error("Match detail boundary summary is incorrect");
    const timeline = await expectStatus("timeline returns transaction/match events", "GET", `/bank-transactions/${debit.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["bank_transaction.created", "reconciliation_match.created", "reconciliation_match.approved"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Bank reconciliation timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/bank-transactions/${debit.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/bank-transactions/${debit.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.action === "bank_transaction.create")) throw new Error("Bank transaction audit missing create action");
    const search = await expectStatus("search includes bank reconciliation", "GET", `/search?q=${encodeURIComponent(`BANK-DEBIT-${marker}`)}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "bank_transaction" && row.id === debit.id)) throw new Error("Search missing bank transaction");

    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "bank reconciliation smoke");
    console.log("bank reconciliation smoke passed");
  } finally {
    await client.end();
  }
}

function transactionPayload(accountId, overrides = {}) {
  return {
    bank_account_id: accountId,
    transaction_date: todayOffset(0),
    direction: "debit",
    amount: 10,
    currency: "USD",
    description: "Smoke transaction",
    transaction_type: "payment_out",
    ...overrides,
  };
}

async function createTransactionViaApi(token, accountId, description, amount) {
  return expectStatus("helper transaction create", "POST", "/bank-transactions", `Bearer ${token}`, 201, transactionPayload(accountId, {
    direction: "debit",
    amount,
    description,
    transaction_type: "payment_out",
  }));
}

async function createExecutedPayment(client, tenantId, userId, marker, amount) {
  const batch = await client.query(
    `INSERT INTO payment_batches (
      tenant_id, payment_batch_number, batch_type, payment_method, status, approval_status,
      execution_status, item_count, total_payment_amount, currency, execution_reference, created_by, updated_by
    )
    VALUES ($1, $2, 'contractor_payable', 'manual', 'executed_later', 'approved',
      'executed_later', 1, $3, 'USD', $4, $5, $5) RETURNING id`,
    [tenantId, `PB-BANK-${marker}-${crypto.randomUUID().slice(0, 6)}`, amount, `EXEC-${marker}`, userId],
  );
  const item = await client.query(
    `INSERT INTO payment_items (
      tenant_id, payment_batch_id, source_type, payee_type, payee_name, payment_method,
      payment_amount, currency, execution_status, execution_reference, status, created_by, updated_by
    )
    VALUES ($1, $2, 'correction', 'internal_self_perform', $3, 'manual',
      $4, 'USD', 'executed_later', $5, 'executed_later', $6, $6) RETURNING id`,
    [tenantId, batch.rows[0].id, `Bank Reconciliation Payee ${marker}`, amount, `EXECITEM-${marker}`, userId],
  );
  return { batchId: batch.rows[0].id, itemId: item.rows[0].id };
}

async function createCashReceipt(client, tenantId, userId, marker, amount) {
  const org = await client.query("INSERT INTO organizations (tenant_id, name, type, status) VALUES ($1, $2, 'customer', 'active') RETURNING id", [tenantId, `Bank Rec Customer ${marker}`]);
  const receipt = await client.query(
    `INSERT INTO cash_receipts (
      tenant_id, receipt_number, customer_organization_id, payer_name, payment_date, payment_method,
      payment_reference, gross_received_amount, unapplied_amount, currency, receipt_status,
      created_by, updated_by
    )
    VALUES ($1, $2, $3, $4, current_date, 'ach',
      $5, $6, $6, 'USD', 'unapplied', $7, $7) RETURNING id`,
    [tenantId, `CR-BANK-${marker}-${crypto.randomUUID().slice(0, 6)}`, org.rows[0].id, `Bank Rec Customer ${marker}`, `CASH-${marker}`, amount, userId],
  );
  return { receiptId: receipt.rows[0].id, organizationId: org.rows[0].id };
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Bank Reconciliation Outside Tenant", `bank-rec-outside-${suffix}`]);
  const account = await client.query("INSERT INTO bank_accounts (tenant_id, account_name, account_type, currency) VALUES ($1, 'Outside Bank Account', 'operating', 'USD') RETURNING id", [tenant.rows[0].id]);
  return { tenantId: tenant.rows[0].id, accountId: account.rows[0].id };
}

async function forbiddenCounts(client, tenantId) {
  const invoiceBalance = await client.query("SELECT COALESCE(sum(balance_amount), 0)::numeric AS total FROM invoices WHERE tenant_id = $1", [tenantId]);
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM payment_applications WHERE tenant_id = $1) AS payment_applications,
      (SELECT count(*)::int FROM payments WHERE tenant_id = $1) AS payments
    `,
    [tenantId],
  );
  return { ...result.rows[0], invoice_balance_total: invoiceBalance.rows[0].total };
}

async function assertForbiddenUnchanged(client, tenantId, before, label) {
  const after = await forbiddenCounts(client, tenantId);
  for (const key of Object.keys(before)) {
    if (Number(after[key]) !== Number(before[key])) throw new Error(`${label} changed forbidden ${key}`);
  }
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'x') RETURNING id", [
    `bank-reconciliation-limited-${suffix}@example.com`,
    "Bank Reconciliation Limited",
  ]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active')", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function assignRole(client, tenantId, tenantUserId, roleName) {
  const role = await client.query("SELECT id FROM roles WHERE tenant_id = $1 AND name = $2", [tenantId, roleName]);
  if (!role.rows[0]) return;
  await client.query(
    "INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id) VALUES ($1, $2, $3, 'tenant', $1) ON CONFLICT DO NOTHING",
    [tenantId, tenantUserId, role.rows[0].id],
  );
}

function createToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function expectStatus(label, method, path, authorization, status, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (response.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${response.status}: ${text}`);
  }
  return data;
}

function todayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
