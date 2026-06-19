const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../../..");
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";

async function main() {
  const invalid = spawnSync(process.execPath, ["apps/api/scripts/validate-env.js"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "", AUTH_JWT_SECRET: "", NODE_ENV: "production" },
    encoding: "utf8",
  });
  if (invalid.status === 0) throw new Error("environment validation did not fail for invalid production config");

  const valid = spawnSync(process.execPath, ["apps/api/scripts/validate-env.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: process.env.DATABASE_URL,
      AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
      API_BASE_URL: apiBaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    },
    encoding: "utf8",
  });
  if (valid.status !== 0) throw new Error(`environment validation failed for valid production config: ${valid.stderr || valid.stdout}`);

  const startup = await fetchJson("/health/startup");
  if (!startup.ok) throw new Error(`startup validation failed: ${JSON.stringify(startup)}`);
  if (!startup.database?.ok) throw new Error("startup validation did not confirm database connectivity");
  if (!startup.migrations?.ok) throw new Error("startup validation did not confirm migration compatibility");
  if (!startup.requiredTables?.ok) throw new Error("startup validation did not confirm required tables");
  if (!startup.permissionSeed?.ok) throw new Error("startup validation did not confirm permission seed");
  if (!startup.requiredRoles?.ok) throw new Error("startup validation did not confirm required roles");

  const testRun = spawnSync("npm", ["test"], { cwd: root, encoding: "utf8" });
  if (testRun.status !== 0) throw new Error(`regression suite failed: ${testRun.stdout}\n${testRun.stderr}`);

  await verifyFreshDatabase();

  for (const file of [
    ".github/workflows/ci.yml",
    "tenant-safety-hardening.md",
    "RELEASE_READINESS.md",
    "DEPLOYMENT.md",
    "RUNBOOKS.md",
    "docs/architecture/testing.md",
  ]) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`${file} is required`);
  }

  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  for (const command of ["npm ci", "npm run typecheck", "npm run build -w @syncos/api", "npm run build -w @syncos/worker", "npm run build -w @syncos/web", "npm run db:verify", "npm run security:smoke", "npm test"]) {
    if (!ci.includes(command)) throw new Error(`CI configuration missing ${command}`);
  }

  const migrations = fs.readdirSync(path.join(root, "packages/database/migrations")).filter((file) => file.endsWith(".sql"));
  if (migrations.length !== 15) throw new Error("Sprint 14 should not add business migrations");
  for (const forbidden of ["ai_models", "forecasts", "autonomous_recommendations", "payroll_records", "collections_automation"]) {
    if (repositoryContainsCreateTable(forbidden)) throw new Error(`forbidden business artifact introduced: ${forbidden}`);
  }

  console.log("sprint14 smoke passed");
}

async function verifyFreshDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for migration verification");
  const url = new URL(databaseUrl);
  const originalDb = url.pathname.replace(/^\//, "");
  const tempDb = `syncos_sprint14_verify_${Date.now()}`;
  url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${tempDb}`);
  } finally {
    await admin.end();
  }
  const verifyUrl = new URL(databaseUrl);
  verifyUrl.pathname = `/${tempDb}`;
  const dbVerify = spawnSync("npm", ["run", "db:verify"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: verifyUrl.toString() },
    encoding: "utf8",
  });
  const cleanup = new Client({ connectionString: url.toString() });
  await cleanup.connect();
  try {
    await cleanup.query(`DROP DATABASE IF EXISTS ${tempDb}`);
  } finally {
    await cleanup.end();
  }
  if (dbVerify.status !== 0) throw new Error(`db:verify failed in sprint14 smoke for ${tempDb} from ${originalDb}: ${dbVerify.stdout}\n${dbVerify.stderr}`);
}

async function fetchJson(pathname) {
  const response = await fetch(`${apiBaseUrl}${pathname}`);
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function repositoryContainsCreateTable(tableName) {
  const files = listFiles(root).filter((file) => !file.includes("node_modules") && !file.includes(".git"));
  return files.some((file) => fs.readFileSync(file, "utf8").includes(`CREATE TABLE ${tableName}`));
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
