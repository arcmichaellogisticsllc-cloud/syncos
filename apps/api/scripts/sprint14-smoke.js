const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
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

  const token = await seededAdminToken();
  await expectStatus("unauthorized compliance report blocked", "GET", "/reports/compliance", undefined, 401);
  const complianceReport = await expectStatus("compliance report loads", "GET", "/reports/compliance", `Bearer ${token}`, 200);
  if (!Array.isArray(complianceReport.expiredDocuments) || !Array.isArray(complianceReport.expiringDocuments) || !Array.isArray(complianceReport.missingDocuments)) {
    throw new Error("compliance report shape is invalid");
  }
  const billingReport = await expectStatus("billing completeness report loads", "GET", "/reports/billing-completeness", `Bearer ${token}`, 200);
  if (!Array.isArray(billingReport.billableProduction) || !Array.isArray(billingReport.missingRateCodes) || !Array.isArray(billingReport.missingSettlementLinks) || !Array.isArray(billingReport.missingInvoiceLinks)) {
    throw new Error("billing completeness report shape is invalid");
  }
  const constraintReport = await expectStatus("constraint report loads", "GET", "/reports/constraints", `Bearer ${token}`, 200);
  if (!Array.isArray(constraintReport.openConstraints) || !Array.isArray(constraintReport.byType) || !Array.isArray(constraintReport.bySeverity) || !Array.isArray(constraintReport.byOwner)) {
    throw new Error("constraint report shape is invalid");
  }
  const executiveDashboard = await expectStatus("executive dashboard trend loads", "GET", "/dashboard/executive", `Bearer ${token}`, 200);
  if (executiveDashboard.telecomWorkThroughput?.trend === "not_calculated") {
    throw new Error("dashboard trend placeholder was not removed");
  }

  const testRun = spawnSync("npm", ["test"], { cwd: root, encoding: "utf8" });
  if (testRun.status !== 0) throw new Error(`regression suite failed: ${testRun.stdout}\n${testRun.stderr}`);

  await verifyFreshDatabase();

  for (const file of [
    ".github/workflows/ci.yml",
    "tenant-safety-hardening.md",
    "RELEASE_READINESS.md",
    "DEPLOYMENT.md",
    "RUNBOOKS.md",
    "PRODUCTION_READINESS.md",
    "tenant-safety-hardening-report.md",
    "scripts/release-validation.sh",
    "docs/architecture/testing.md",
  ]) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`${file} is required`);
  }

  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  for (const command of ["npm ci", "npm run typecheck", "npm run build -w @syncos/api", "npm run build -w @syncos/worker", "npm run build -w @syncos/web", "npm run db:verify", "npm run security:smoke", "npm test"]) {
    if (!ci.includes(command)) throw new Error(`CI configuration missing ${command}`);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (!packageJson.scripts["release:validate"]) throw new Error("release validation command is required");

  const migrations = fs.readdirSync(path.join(root, "packages/database/migrations")).filter((file) => file.endsWith(".sql"));
  const approvedPostRc1Migrations = new Set([
    "016_tenant_fk_hardening.sql",
    "017_intelligence_signal_contract_hardening.sql",
    "018_organization_contract_hardening.sql",
    "019_contact_contract_hardening.sql",
    "020_relationship_contract_hardening.sql",
    "021_opportunity_candidate_contract_hardening.sql",
    "022_opportunity_pipeline_contract_hardening.sql",
    "023_opportunity_approval_policy_hardening.sql",
    "024_coverage_planning_contract_foundation.sql",
    "025_coverage_planning_backend_hardening.sql",
    "026_project_handoff_contract_foundation.sql",
    "027_project_backend_contract_hardening.sql",
    "028_work_order_contract_hardening.sql",
    "029_production_contract_hardening.sql",
    "030_qc_review_contract_foundation.sql",
    "031_billable_contract_foundation.sql",
    "032_settlement_contract_foundation.sql",
    "033_invoice_contract_foundation.sql",
    "034_cash_application_contract_foundation.sql",
  ]);
  const postRc1Migrations = migrations.filter((file) => file.localeCompare("016_tenant_fk_hardening.sql") >= 0);
  const unexpectedPostRc1Migrations = postRc1Migrations.filter((file) => !approvedPostRc1Migrations.has(file));
  if (unexpectedPostRc1Migrations.length > 0) {
    throw new Error(`unexpected post-RC1 hardening migrations: ${unexpectedPostRc1Migrations.join(", ")}`);
  }
  for (const migration of approvedPostRc1Migrations) {
    if (!migrations.includes(migration)) throw new Error(`${migration} is required`);
  }
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

async function seededAdminToken() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.AUTH_JWT_SECRET;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!secret) throw new Error("AUTH_JWT_SECRET is required");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT u.id AS user_id, t.id AS tenant_id
      FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id
      JOIN tenants t ON t.id = tu.tenant_id
      WHERE u.email = 'admin@jackson-telcom.local'
        AND t.slug = 'jackson-telcom'
      LIMIT 1
    `);
    if (!result.rows[0]) throw new Error("seeded admin user not found");
    return createToken({ sub: result.rows[0].user_id, tenant_id: result.rows[0].tenant_id, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  } finally {
    await client.end();
  }
}

async function expectStatus(name, method, pathname, authorization, expected, body) {
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${response.status}: ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function createToken(claims, secret) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ ...claims, iat: Math.floor(Date.now() / 1000) });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
