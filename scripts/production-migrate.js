const childProcess = require("node:child_process");
const { Client } = require("pg");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (process.env.NODE_ENV !== "production") throw new Error("NODE_ENV=production is required for production migration gate");
  if (process.env.PRODUCTION_DB_BACKUP_CONFIRMED !== "true") throw new Error("PRODUCTION_DB_BACKUP_CONFIRMED=true is required before migrations");
  if (!/(sslmode=require|ssl=true)/i.test(databaseUrl)) throw new Error("Production DATABASE_URL must require SSL");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const health = await client.query("SELECT current_database() AS database, current_user AS role, now() AS checked_at");
    console.log(JSON.stringify({ migration_gate: "connected", ...health.rows[0] }));
    const migrations = await client.query("SELECT id, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 5").catch(() => ({ rows: [] }));
    console.log(JSON.stringify({ migration_gate: "current_state", recent_migrations: migrations.rows }));
  } finally {
    await client.end();
  }

  childProcess.execFileSync("npm", ["run", "db:migrate"], { stdio: "inherit" });

  const postMigrationClient = new Client({ connectionString: databaseUrl });
  await postMigrationClient.connect();
  try {
    const latest = await postMigrationClient.query("SELECT id, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 1");
    console.log(JSON.stringify({ migration_gate: "applied", latest_migration: latest.rows[0] ?? null }));
  } finally {
    await postMigrationClient.end();
  }
  console.log("production migration gate completed");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
