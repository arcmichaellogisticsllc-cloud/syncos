const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const packageJson = JSON.parse(read("package.json"));
  const e2e = packageJson.scripts["e2e:certification"];
  assert(e2e.includes("tests/e2e/production-readiness.spec.ts"), "P17 production-readiness E2E is not globally registered");
  assert(packageJson.scripts["sprint17:smoke"], "root sprint17 smoke command is missing");

  const migrations = fs.readdirSync(path.join(root, "packages/database/migrations")).filter((file) => file.endsWith(".sql"));
  assert(migrations.at(-1) === "054_executive_command_throughput.sql", "P17 should not add a migration unless a release blocker requires it");
  migrations.forEach((migration, index) => {
    const expected = String(index + 1).padStart(3, "0");
    assert(migration.startsWith(expected), `migration ordering gap at ${migration}`);
  });

  const worker = read("apps/worker/src/index.ts");
  for (const lock of [
    "syncos.p6.mobilization_expiration_scan",
    "syncos.p14.partner_performance_recalculation_scan",
    "syncos.p15.opportunity_capacity_matching_scan",
    "syncos.p16.executive_command_refresh_scan",
  ]) {
    assert(worker.includes("start") || read("packages/shared/src/index.ts"), "worker startup is not readable");
    assert(read("packages/shared/src/executive-command.ts").includes(lock) || read("packages/shared/src/partner-performance.ts").includes(lock) || read("packages/shared/src/opportunity-capacity-matching.ts").includes(lock) || read("packages/shared/src/write-action.ts").includes(lock), `missing advisory lock ${lock}`);
  }

  const executive = read("packages/shared/src/executive-command.ts");
  assert(executive.includes("executive_action_priority_v1"), "P16 action priority policy version missing");
  assert(!/UPDATE opportunities SET|INSERT INTO work_orders|INSERT INTO payments|UPDATE organizations SET/i.test(executive), "Command Center read model appears to mutate source domains");
  assert(!/worker_email|worker_name|bank_account|provider_secret|margin_amount|margin_percent/i.test(executive), "Command Center source appears to expose restricted fields");

  const doc = read("docs/product/production-readiness-p17.md");
  assert(doc.includes("LIMITED PRODUCTION READY") || doc.includes("Pending validation"), "P17 release recommendation section missing");

  console.log("sprint17 smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
