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
