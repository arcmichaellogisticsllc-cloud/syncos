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
  if (!packageJson.scripts["e2e:certification"].includes("tests/e2e/opportunity-capacity-matching.spec.ts")) {
    throw new Error("P15 E2E is not registered in e2e:certification");
  }
  const controller = fs.readFileSync(path.join(root, "apps/api/src/routes/opportunity-capacity-matching.controller.ts"), "utf8");
  for (const token of ["opportunity_capacity_match.read", "opportunity_capacity_match.recalculate", "opportunity_partner_shortlist.manage", "opportunity_match_decision.record"]) {
    if (!controller.includes(token)) throw new Error(`P15 controller missing ${token}`);
  }
  if (/UPDATE opportunities SET|INSERT INTO work_orders|INSERT INTO partner_work_order_crew_assignments|INSERT INTO payments|UPDATE partner_performance_snapshots SET score/i.test(controller)) {
    throw new Error("P15 controller appears to mutate assignment, payment, or P14 score truth");
  }
  const shared = fs.readFileSync(path.join(root, "packages/shared/src/opportunity-capacity-matching.ts"), "utf8");
  if (!shared.includes("opportunity_capacity_match_v1")) throw new Error("P15 matching policy version is missing");
  if (!shared.includes("pg_try_advisory_lock")) throw new Error("P15 scheduled scan must use advisory locking");
  console.log("sprint15 smoke passed");
}

async function assertTables(client) {
  const expected = [
    "opportunity_requirement_profiles",
    "opportunity_partner_match_snapshots",
    "opportunity_crew_match_snapshots",
    "opportunity_coverage_options",
    "opportunity_partner_shortlists",
    "opportunity_match_decisions",
  ];
  const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [expected]);
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = expected.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`P15 tables missing: ${missing.join(", ")}`);
}

async function assertPermissions(client) {
  const expected = [
    "opportunity_capacity_match.read",
    "opportunity_capacity_match.recalculate",
    "opportunity_capacity_match.requirements_manage",
    "opportunity_partner_shortlist.manage",
    "opportunity_coverage.read",
    "opportunity_match_decision.record",
  ];
  const result = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [expected]);
  const found = new Set(result.rows.map((row) => row.key));
  const missing = expected.filter((key) => !found.has(key));
  if (missing.length) throw new Error(`P15 permissions missing from seed: ${missing.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
