import { Client } from "pg";

export type CountMap = Record<string, number>;

const tableAllowlist = new Set([
  "production_records",
  "qc_reviews",
  "billable_items",
  "settlements",
  "settlement_items",
  "invoices",
  "invoice_items",
  "cash_receipts",
  "payment_applications",
  "collection_cases",
  "collection_actions",
  "contractor_payables",
  "contractor_payable_items",
  "payroll_runs",
  "payroll_items",
  "payment_batches",
  "payment_items",
  "bank_transactions",
  "reconciliation_matches",
  "accounting_export_batches",
  "accounting_export_items",
  "ar_records",
  "payments",
]);

export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for E2E DB assertions");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function countTables(tenantId: string, tables: string[]): Promise<CountMap> {
  return withDb(async (client) => {
    const counts: CountMap = {};
    for (const table of tables) {
      assertAllowedTable(table);
      const exists = await client.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]);
      if (!exists.rows[0]?.table_name) throw new Error(`E2E boundary table is missing: ${table}`);
      const result = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      counts[table] = Number(result.rows[0].count);
    }
    return counts;
  });
}

function assertAllowedTable(table: string) {
  if (!tableAllowlist.has(table)) throw new Error(`Table is not allowed for E2E boundary assertions: ${table}`);
}
