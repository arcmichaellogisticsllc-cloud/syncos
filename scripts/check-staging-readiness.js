const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fail = [];
const warn = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function tracked(relativePath) {
  const gitIndex = path.join(root, ".git", "index");
  if (!fs.existsSync(gitIndex)) return false;
  try {
    require("node:child_process").execFileSync("git", ["ls-files", "--error-unmatch", relativePath], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const requiredDocs = [
  "docs/product/staging-readiness-plan.md",
  "docs/product/staging-environment-runbook.md",
  "docs/product/tenant-admin-bootstrap-runbook.md",
  "docs/product/staging-data-policy.md",
  "docs/product/staging-security-checklist.md",
  "docs/product/staging-smoke-test-plan.md",
  "docs/product/staging-uat-plan.md",
  "docs/product/staging-backup-restore-runbook.md",
  "docs/product/staging-go-no-go-scorecard.md",
  "docs/product/staging-readiness-gap-backlog.md",
  "docs/product/operator-uat-plan.md",
  "docs/product/operator-demo-scripts.md",
];

for (const doc of requiredDocs) {
  if (!exists(doc)) fail.push(`Missing required document: ${doc}`);
}

for (const file of [
  "scripts/check-e2e-certification.js",
  "scripts/release-validation.sh",
  "package.json",
  ".env.example",
]) {
  if (!exists(file)) fail.push(`Missing required release/readiness file: ${file}`);
}

const pkg = JSON.parse(read("package.json"));
if (!pkg.scripts?.["e2e:ci:release"]) fail.push("package.json is missing e2e:ci:release");
if (!pkg.scripts?.["release:validate"]) warn.push("package.json is missing release:validate");

const envExample = read(".env.example");
const suspiciousEnvPatterns = [
  /STAGING_AUTH_JWT_SECRET=(?!<set-in-provider-secret-manager>)/,
  /STAGING_DATABASE_URL=(?!<set-in-provider-secret-manager>)/,
  /password\s*=\s*(?!<|replace|postgres)/i,
  /api[_-]?key\s*=\s*[^<\s]/i,
  /token\s*=\s*[^<\s]/i,
];
for (const pattern of suspiciousEnvPatterns) {
  if (pattern.test(envExample)) fail.push(`.env.example contains suspicious non-placeholder value: ${pattern}`);
}
if (!/ALLOW_DEV_HEADER_AUTH=false/.test(envExample)) {
  fail.push(".env.example must default ALLOW_DEV_HEADER_AUTH=false");
}
if (!/NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL=false/.test(envExample)) {
  fail.push(".env.example must default NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL=false");
}

for (const envFile of [".env.local", ".env.production", ".env.staging"]) {
  if (tracked(envFile)) fail.push(`${envFile} must not be tracked`);
}

const e2eFiles = listFiles(path.join(root, "tests", "e2e")).filter((file) => /\.(ts|js)$/.test(file));
for (const file of e2eFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/test\.(skip|only)|\.fixme/.test(text)) fail.push(`Forbidden E2E marker found in ${path.relative(root, file)}`);
  if (/forbiddenTables:\s*\[\s*\]/.test(text)) fail.push(`Empty forbiddenTables escape found in ${path.relative(root, file)}`);
}

const stagingDocs = requiredDocs.filter((doc) => doc.startsWith("docs/product/staging-") || doc.includes("tenant-admin"));
for (const doc of stagingDocs) {
  if (!exists(doc)) continue;
  const text = read(doc);
  if (/seed:e2e-demo/.test(text) && !/demo-only|test-only|isolated|not run|never target/i.test(text)) {
    fail.push(`${doc} references seed:e2e-demo without a staging safety caveat`);
  }
}

if (fail.length) {
  console.error("Staging readiness check failed:");
  for (const item of fail) console.error(`- ${item}`);
  if (warn.length) {
    console.error("Warnings:");
    for (const item of warn) console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log("Staging readiness check passed.");
if (warn.length) {
  console.log("Warnings:");
  for (const item of warn) console.log(`- ${item}`);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}
