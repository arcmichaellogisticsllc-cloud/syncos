const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const { checkMigrationState } = require("@syncos/database");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.STAGING_DB_BACKUP_CONFIRMED !== "true") throw new Error("STAGING_DB_BACKUP_CONFIRMED=true is required before staging migrations");
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (process.env.NODE_ENV !== "staging") throw new Error("NODE_ENV=staging is required for staging migrations");
  if (!/(sslmode=require|ssl=true)/i.test(databaseUrl)) throw new Error("Staging DATABASE_URL must require SSL");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("SELECT 1");
  const before = await client.query("SELECT id FROM schema_migrations ORDER BY id");
  console.log(`staging migration precheck ok; applied=${before.rowCount}`);
  await client.end();

  run("npm", ["run", "db:migrate"]);

  const verifyClient = new Client({ connectionString: databaseUrl });
  await verifyClient.connect();
  const after = await verifyClient.query("SELECT id FROM schema_migrations ORDER BY id");
  await verifyClient.end();
  const applied = after.rows.map((row) => row.id);
  const state = checkMigrationState(applied);
  if (!state.ok) throw new Error(`Staging migration verification failed: ${JSON.stringify(state)}`);
  console.log(`staging migrations applied through ${state.currentCeiling}; applied=${applied.length}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
