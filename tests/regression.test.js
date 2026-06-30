const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

const coverage = [
  ["Sprint 1 organizations", "apps/api/src/routes/organizations.controller.ts", "organization.create"],
  ["Sprint 1 contacts", "apps/api/src/routes/contacts.controller.ts", "contact.verify"],
  ["Sprint 1 signals", "apps/api/src/routes/signals.controller.ts", "signal.verify"],
  ["Sprint 2 relationship maps", "apps/api/src/routes/relationship-maps.controller.ts", "relationship_map.create"],
  ["Sprint 2 candidates", "apps/api/src/routes/opportunity-candidates.controller.ts", "opportunity_candidate.qualify"],
  ["Sprint 3 opportunities", "apps/api/src/routes/opportunities.controller.ts", "opportunity.pursuit_approve"],
  ["Sprint 4 capacity", "apps/api/src/routes/capacity.controller.ts", "capacity_provider.activate"],
  ["Sprint 5 production", "apps/api/src/routes/production.controller.ts", "production_record.submit"],
  ["Sprint 6 QC billable", "apps/api/src/routes/production.controller.ts", "production.mark_billable"],
  ["Sprint 7 settlements", "apps/api/src/routes/settlements.controller.ts", "settlement.approve"],
  ["Sprint 8 invoices payments", "apps/api/src/routes/cash.controller.ts", "payment.reconcile"],
  ["Sprint 9 constraints recommendations", "apps/api/src/routes/constraints.controller.ts", "recommendation.approve"],
  ["Sprint 10 workflow runtime", "apps/api/src/routes/workflows.controller.ts", "workflow_task.escalate"],
  ["Sprint 11 KPIs", "apps/api/src/routes/kpis.controller.ts", "kpi.calculate"],
  ["Sprint 12 dashboards", "apps/api/src/routes/dashboards.controller.ts", "dashboard.executive.read"],
  ["Sprint 13 learning", "apps/api/src/routes/learning.controller.ts", "learning_score.recalculate"],
  ["Payment execution", "apps/api/src/routes/payment-execution.controller.ts", "payment_batch.approve"],
];

test("regression route and permission coverage exists for completed sprints", () => {
  for (const [label, file, permission] of coverage) {
    const source = read(file);
    assert.match(source, new RegExp(permission.replace(".", "\\.")), label);
    assert.match(source, /@RequirePermission\(/, `${label} must remain explicitly permission protected`);
  }
});

test("all sprint smoke commands are wired", () => {
  const packageJson = JSON.parse(read("package.json"));
  for (let sprint = 1; sprint <= 14; sprint += 1) {
    assert.equal(typeof packageJson.scripts[`sprint${sprint}:smoke`], "string", `missing sprint${sprint}:smoke`);
  }
  assert.equal(typeof packageJson.scripts["security:smoke"], "string");
  assert.equal(typeof packageJson.scripts["intelligence:smoke"], "string");
  assert.equal(typeof packageJson.scripts["organization:smoke"], "string");
  assert.equal(typeof packageJson.scripts["contact:smoke"], "string");
  assert.equal(typeof packageJson.scripts["relationship:smoke"], "string");
  assert.equal(typeof packageJson.scripts["payment-execution:smoke"], "string");
  assert.equal(typeof packageJson.scripts.test, "string");
});

test("migration ordering is lexical and complete", () => {
  const migrations = fs.readdirSync(path.join(root, "packages/database/migrations")).filter((file) => file.endsWith(".sql"));
  assert.deepEqual(migrations, [...migrations].sort());
  assert.equal(migrations[0], "001_tenants_users_roles_permissions.sql");
  migrations.forEach((migration, index) => {
    const expectedPrefix = String(index + 1).padStart(3, "0");
    assert.equal(migration.slice(0, 3), expectedPrefix, `${migration} should keep contiguous migration numbering`);
  });
});

test("write helpers remain the only shared write action path", () => {
  const source = read("packages/shared/src/write-action.ts");
  assert.match(source, /INSERT INTO events/);
  assert.match(source, /INSERT INTO event_payloads/);
  assert.match(source, /appendAuditLog/);
  assert.match(source, /INSERT INTO system_actions/);
});

test("Sprint 14 does not introduce disallowed business artifacts", () => {
  const allFiles = listFiles(root).filter((file) => !file.includes("node_modules") && !file.includes(".git") && !file.includes(`${path.sep}dist${path.sep}`) && !file.includes(`${path.sep}.next${path.sep}`));
  const forbidden = ["ai_models", "forecasts", "autonomous_recommendations", "vector_embeddings", "payroll_records", "collections_automation"];
  for (const file of allFiles) {
    const relative = path.relative(root, file);
    if (relative === "apps/api/scripts/sprint13-smoke.js") continue;
    if (relative.endsWith(".md")) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const term of forbidden) {
      assert.equal(source.includes(`CREATE TABLE ${term}`), false, `${relative} creates ${term}`);
    }
  }
});

test("e2e certification enforcer: all action states are certified and none lack required notes when blocked", () => {
  const source = read("tests/e2e/fixtures/action-states.ts");
  const lines = source.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    if (/submitCertificationStatus:\s*["']not-certified["']/.test(lines[i])) {
      violations.push(`Line ${i + 1}: not-certified state found`);
    }
    if (/submitCertificationStatus:\s*["']blocked["']/.test(lines[i])) {
      let objStart = i;
      for (let j = i - 1; j >= 0; j--) {
        if (/^\s*\{/.test(lines[j])) { objStart = j; break; }
      }
      let objEnd = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*\}/.test(lines[j])) { objEnd = j; break; }
      }
      const block = lines.slice(objStart, objEnd + 1).join("\n");
      if (!/\bnotes\s*:/.test(block)) {
        const match = block.match(/stateKey:\s*["']([^"']+)["']/);
        violations.push(`Line ${i + 1} (${match ? match[1] : "unknown"}): blocked without notes`);
      }
    }
  }

  assert.deepEqual(violations, [], `E2E certification violations:\n${violations.join("\n")}`);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function listFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}
