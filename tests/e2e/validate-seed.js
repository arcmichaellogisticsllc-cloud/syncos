const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const requiredRecordKeys = [
  "signal",
  "organization",
  "contact",
  "relationshipMap",
  "opportunityCandidate",
  "opportunity",
  "coveragePlan",
  "projectHandoff",
  "project",
  "workOrder",
  "productionRecord",
  "qcReview",
  "billableItem",
  "settlement",
  "invoice",
  "cashReceipt",
  "paymentApplication",
  "collectionCase",
  "collectionAction",
  "contractorPayable",
  "payrollRun",
  "paymentBatch",
  "bankTransaction",
  "reconciliationMatch",
  "accountingExportBatch",
];

// Each entry: [stateKey, table, idField]
const requiredActionStates = [
  ["prodDraft", "production_records", "id"],
  ["prodSubmitted", "production_records", "id"],
  ["prodUnderReview", "production_records", "id"],
  ["prodCorrectionRequested", "production_records", "id"],
  ["prodApprovedNotMarked", "production_records", "id"],
  ["prodVoid", "production_records", "id"],
  ["qcPending", "qc_reviews", "id"],
  ["qcInReview", "qc_reviews", "id"],
  ["qcCorrectionRequested", "qc_reviews", "id"],
  ["qcVoid", "qc_reviews", "id"],
  ["billableDraft", "billable_items", "id"],
  ["billableOnHold", "billable_items", "id"],
  ["billableDisputed", "billable_items", "id"],
  ["billableVoid", "billable_items", "id"],
  ["settlementDraft", "settlements", "id"],
  ["settlementItemDraft", "settlement_items", "id"],
  ["settlementUnderReview", "settlements", "id"],
  ["settlementApproved", "settlements", "id"],
  ["settlementDisputed", "settlements", "id"],
  ["settlementVoid", "settlements", "id"],
  ["invoiceDraft", "invoices", "id"],
  ["invoiceItemDraft", "invoice_items", "id"],
  ["invoiceUnderReview", "invoices", "id"],
  ["invoiceApproved", "invoices", "id"],
  ["invoiceDisputed", "invoices", "id"],
  ["invoiceVoid", "invoices", "id"],
  ["cashReceiptUnapplied", "cash_receipts", "id"],
  ["cashReceiptVoidTarget", "cash_receipts", "id"],
  ["cashReceiptVoid", "cash_receipts", "id"],
  ["paymentApplicationApplied", "payment_applications", "id"],
  ["paymentApplicationVoid", "payment_applications", "id"],
  ["collectionCaseOpen", "collection_cases", "id"],
  ["collectionCaseClosed", "collection_cases", "id"],
  ["collectionActionPlanned", "collection_actions", "id"],
  ["collectionActionCompleted", "collection_actions", "id"],
  ["cpayDraft", "contractor_payables", "id"],
  ["cpayItemDraft", "contractor_payable_items", "id"],
  ["cpayUnderReview", "contractor_payables", "id"],
  ["cpayApproved", "contractor_payables", "id"],
  ["cpayDisputed", "contractor_payables", "id"],
  ["cpayVoid", "contractor_payables", "id"],
  ["payrollDraft", "payroll_runs", "id"],
  ["payrollItemDraft", "payroll_items", "id"],
  ["payrollUnderReview", "payroll_runs", "id"],
  ["payrollApproved", "payroll_runs", "id"],
  ["payrollDisputed", "payroll_runs", "id"],
  ["payrollVoid", "payroll_runs", "id"],
  ["paymentBatchDraft", "payment_batches", "id"],
  ["paymentItemDraft", "payment_items", "id"],
  ["paymentBatchUnderReview", "payment_batches", "id"],
  ["paymentBatchApproved", "payment_batches", "id"],
  ["paymentBatchScheduled", "payment_batches", "id"],
  ["paymentBatchExecutionSubmitted", "payment_batches", "id"],
  ["paymentBatchVoidTarget", "payment_batches", "id"],
  ["paymentBatchVoid", "payment_batches", "id"],
  ["bankAccountArchivable", "bank_accounts", "id"],
  ["bankTxnUnmatchedDebit", "bank_transactions", "id"],
  ["bankTxnUnmatchedCredit", "bank_transactions", "id"],
  ["bankTxnExceptionNone", "bank_transactions", "id"],
  ["bankTxnExceptionOpen", "bank_transactions", "id"],
  ["bankTxnIgnorable", "bank_transactions", "id"],
  ["reconMatchProposed", "reconciliation_matches", "id"],
  ["aexDraft", "accounting_export_batches", "id"],
  ["aexItemDraft", "accounting_export_items", "id"],
  ["aexGenerated", "accounting_export_batches", "id"],
  ["aexUnderReview", "accounting_export_batches", "id"],
  ["aexSubmitted", "accounting_export_batches", "id"],
  ["aexCancelable", "accounting_export_batches", "id"],
  ["aexVoid", "accounting_export_batches", "id"],
];

const requiredPersonas = [
  "system-admin",
  "growth-operator",
  "ops-manager",
  "field-supervisor",
  "qc-reviewer",
  "finance-user",
  "collections-specialist",
  "payables-payroll-admin",
  "accounting-manager",
  "read-only-auditor",
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await assertTenant(client, manifest.tenant.id);
    for (const persona of requiredPersonas) await assertPersona(client, manifest, persona);
    for (const key of requiredRecordKeys) assertRecordManifest(manifest, key);
    assertActionStatesManifest(manifest);
    await assertActionStateRecords(client, manifest);
    await assertNoFullBankAccount(client, manifest.tenant.id);
  } finally {
    await client.end();
  }
  console.log("E2E seed smoke passed");
}

async function assertTenant(client, tenantId) {
  const result = await client.query("SELECT count(*)::int AS count FROM tenants WHERE id = $1 AND slug = 'arc-syncos-demo' AND status = 'active'", [tenantId]);
  if (result.rows[0].count !== 1) throw new Error("ARC SyncOS Demo Tenant missing");
}

async function assertPersona(client, manifest, slug) {
  const persona = manifest.personas[slug];
  if (!persona) throw new Error(`Persona missing from manifest: ${slug}`);
  const result = await client.query(
    `SELECT count(*)::int AS count
     FROM users u
     JOIN tenant_users tu ON tu.user_id = u.id
     WHERE u.id = $1 AND u.email = $2 AND tu.tenant_id = $3 AND u.status = 'active' AND tu.status = 'active'`,
    [persona.userId, persona.email, manifest.tenant.id],
  );
  if (result.rows[0].count !== 1) throw new Error(`Seeded persona missing or inactive: ${slug}`);
}

function assertRecordManifest(manifest, key) {
  const record = manifest.records[key];
  if (!record?.id || !record?.route || !record?.recommendedPersona) throw new Error(`Manifest record incomplete: ${key}`);
}

function assertActionStatesManifest(manifest) {
  if (!manifest.actionStates || typeof manifest.actionStates !== "object") {
    throw new Error("Manifest missing actionStates section");
  }
  for (const [key] of requiredActionStates) {
    if (!manifest.actionStates[key]) throw new Error(`actionStates.${key} missing from manifest`);
  }
}

async function assertActionStateRecords(client, manifest) {
  const as = manifest.actionStates;
  for (const [key, table, idField] of requiredActionStates) {
    const id = as[key];
    if (!id) throw new Error(`actionStates.${key} has no ID`);
    const result = await client.query(
      `SELECT count(*)::int AS count FROM ${table} WHERE ${idField} = $1`,
      [id],
    );
    if (result.rows[0].count !== 1) {
      throw new Error(`Action state record missing: ${key} (${table}.${idField} = ${id})`);
    }
  }
}

async function assertNoFullBankAccount(client, tenantId) {
  const result = await client.query("SELECT masked_account_number, routing_last4 FROM bank_accounts WHERE tenant_id = $1", [tenantId]);
  for (const row of result.rows) {
    if (row.masked_account_number && !String(row.masked_account_number).includes("*")) throw new Error("Bank account seed contains unmasked account number");
    if (row.routing_last4 && String(row.routing_last4).length > 4) throw new Error("Bank account seed contains routing data longer than last4");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
