const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../../..");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await assertTables(client);
    await assertPermissions(client);
  } finally {
    await client.end();
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (!packageJson.scripts["e2e:certification"].includes("tests/e2e/executive-command-throughput.spec.ts")) {
    throw new Error("P16 E2E is not registered in e2e:certification");
  }

  const controller = fs.readFileSync(path.join(root, "apps/api/src/routes/executive-command.controller.ts"), "utf8");
  for (const token of ["executive_command.read", "executive_command.actions_read", "executive_command.snapshot_recalculate", "executive_command.action_acknowledge"]) {
    if (!controller.includes(token)) throw new Error(`P16 controller missing ${token}`);
  }
  if (/UPDATE opportunities SET|INSERT INTO work_orders|INSERT INTO partner_work_order_crew_assignments|INSERT INTO payments|UPDATE organizations SET|UPDATE partner_performance_snapshots SET score/i.test(controller)) {
    throw new Error("P16 controller appears to mutate operational, payment, or lifecycle truth");
  }

  const shared = fs.readFileSync(path.join(root, "packages/shared/src/executive-command.ts"), "utf8");
  for (const token of ["executive_command_v1", "executive_action_priority_v1", "pg_try_advisory_lock", "customer_acceptance_to_cleared_cash_application"]) {
    if (!shared.includes(token)) throw new Error(`P16 shared evaluator missing ${token}`);
  }
  if (/UPDATE opportunities SET|INSERT INTO work_orders|INSERT INTO partner_work_order_crew_assignments|INSERT INTO payments|UPDATE organizations SET|UPDATE contractor_payables SET|UPDATE invoices SET/i.test(shared)) {
    throw new Error("P16 shared evaluator mutates source business truth");
  }

  console.log("sprint16 smoke passed");
}

async function assertTables(client) {
  const expected = ["executive_command_snapshots", "executive_actions", "executive_blocker_snapshots"];
  const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [expected]);
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = expected.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`P16 tables missing: ${missing.join(", ")}`);
}

async function assertPermissions(client) {
  const expected = ["executive_command.read", "executive_command.actions_read", "executive_command.snapshot_recalculate", "executive_command.action_acknowledge"];
  const result = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [expected]);
  const found = new Set(result.rows.map((row) => row.key));
  const missing = expected.filter((key) => !found.has(key));
  if (missing.length) throw new Error(`P16 permissions missing from seed: ${missing.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
