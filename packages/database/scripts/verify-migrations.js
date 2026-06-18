const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();
  const existingTables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `);
  await client.end();

  if (existingTables.rowCount) {
    throw new Error("Migration verification requires an empty PostgreSQL database");
  }

  run("npm", ["run", "migrate", "-w", "@syncos/database"]);
  run("npm", ["run", "seed", "-w", "@syncos/database"]);

  const verifyClient = new Client({ connectionString });
  await verifyClient.connect();
  const migrationCount = await verifyClient.query("SELECT count(*)::int AS count FROM schema_migrations");
  const tenantCount = await verifyClient.query("SELECT count(*)::int AS count FROM tenants WHERE slug = 'jackson-telcom'");
  const roleCount = await verifyClient.query("SELECT count(*)::int AS count FROM roles");
  const permissionCount = await verifyClient.query("SELECT count(*)::int AS count FROM permissions");
  const eventTable = await verifyClient.query("SELECT to_regclass('public.events') AS name");
  const auditTable = await verifyClient.query("SELECT to_regclass('public.audit_logs') AS name");
  await verifyClient.end();

  assertEqual(migrationCount.rows[0].count, 15, "expected 15 applied migrations");
  assertEqual(tenantCount.rows[0].count, 1, "expected Jackson Telcom tenant");
  if (roleCount.rows[0].count < 19) {
    throw new Error("expected core roles to be seeded");
  }
  if (permissionCount.rows[0].count < 27) {
    throw new Error("expected core permissions to be seeded");
  }
  if (!eventTable.rows[0].name || !auditTable.rows[0].name) {
    throw new Error("events and audit_logs tables are required");
  }

  console.log("migration verification passed");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: got ${actual}, expected ${expected}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
