const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const root = path.resolve(__dirname, "..");
const fail = [];

const implementationDocs = [
  "docs/product/staging-provider-decision-matrix.md",
  "docs/product/staging-architecture-decision-record.md",
  "docs/product/staging-deployment-checklist.md",
  "docs/product/staging-env-var-final-map.md",
  "docs/product/staging-tenant-admin-execution-plan.md",
  "docs/product/staging-uat-execution-packet.md",
  "docs/product/staging-implementation-gap-review.md",
  "docs/product/staging-approval-gate.md",
  "docs/product/staging-deployment-dry-run-plan.md",
];

const priorDocs = [
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
];

for (const file of [...implementationDocs, ...priorDocs]) {
  if (!exists(file)) fail.push(`Missing required staging planning document: ${file}`);
}

for (const file of [
  "scripts/check-staging-readiness.js",
  "scripts/check-e2e-certification.js",
  "package.json",
  ".env.example",
]) {
  if (!exists(file)) fail.push(`Missing required file: ${file}`);
}

for (const envFile of [".env.staging", ".env.production", ".env.local"]) {
  if (tracked(envFile)) fail.push(`${envFile} must not be tracked`);
}

if (exists(".env.example")) {
  const envExample = read(".env.example");
  const suspiciousEnvPatterns = [
    /STAGING_AUTH_JWT_SECRET=(?!<set-in-provider-secret-manager>)/,
    /STAGING_DATABASE_URL=(?!<set-in-provider-secret-manager>)/,
    /-----BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
    /api[_-]?key\s*=\s*(?!<)[A-Za-z0-9_\-]{20,}/i,
    /token\s*=\s*(?!<)[A-Za-z0-9_\-.]{24,}/i,
  ];
  for (const pattern of suspiciousEnvPatterns) {
    if (pattern.test(envExample)) fail.push(`.env.example contains suspicious non-placeholder value: ${pattern}`);
  }
}

const docsToScan = [...implementationDocs, ...priorDocs].filter(exists);
for (const file of docsToScan) {
  const text = read(file);
  const secretPatterns = [
    /postgres:\/\/[^<\s:]+:[^<\s@]+@/i,
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    /-----BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
    /api[_ -]?key[:=]\s*(?!<)[A-Za-z0-9_\-]{20,}/i,
    /\bsecret[:=]\s*(?!<|strong|provider|unique|reset|not document|never committed|pending|manager|TBD)[A-Za-z0-9_\-]{20,}/i,
  ];
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) fail.push(`${file} contains suspicious secret-like content: ${pattern}`);
  }
  if (/staging is deployed|staging has been deployed|production-ready/i.test(text)) {
    fail.push(`${file} may overstate deployment or production readiness`);
  }
}

const e2eFiles = listFiles(path.join(root, "tests", "e2e")).filter((file) => /\.(ts|js)$/.test(file));
for (const file of e2eFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/test\.(skip|only)|\.fixme/.test(text)) fail.push(`Forbidden E2E marker found in ${path.relative(root, file)}`);
  if (/forbiddenTables:\s*\[\s*\]/.test(text)) fail.push(`Empty forbiddenTables escape found in ${path.relative(root, file)}`);
}

if (exists("package.json")) {
  const pkg = JSON.parse(read("package.json"));
  for (const script of ["staging:check", "e2e:ci:release"]) {
    if (!pkg.scripts?.[script]) fail.push(`package.json is missing ${script}`);
  }
}

if (fail.length) {
  console.error("Staging implementation plan check failed:");
  for (const item of fail) console.error(`- ${item}`);
  process.exit(1);
}

console.log("Staging implementation plan check passed.");

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function tracked(relativePath) {
  try {
    childProcess.execFileSync("git", ["ls-files", "--error-unmatch", relativePath], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}
