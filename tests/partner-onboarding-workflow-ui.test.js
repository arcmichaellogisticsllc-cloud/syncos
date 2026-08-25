const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("Partner onboarding shows ordered readiness gates without partner-side approval", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");

  assert.match(shell, /Company Setup/);
  assert.match(shell, /W-9 \/ Tax Information/);
  assert.match(shell, /Payment Setup/);
  assert.match(shell, /Insurance/);
  assert.match(shell, /Agreements/);
  assert.match(shell, /Workers/);
  assert.match(shell, /Foremen/);
  assert.match(shell, /Crews/);
  assert.match(shell, /Vehicles \/ Equipment/);
  assert.match(shell, /Safety \/ Compliance/);
  assert.match(shell, /Final Review/);
  assert.match(shell, /Company Approved/);
  assert.match(shell, /Crew Ready/);
  assert.match(shell, /Project Mobilization/);
  assert.match(shell, /Approval remains locked until required gates are complete/);
  assert.doesNotMatch(shell, /Approve my company/i);
});

test("Partner onboarding routes users to existing portal workspaces", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");

  assert.match(shell, /route: "\/partner\/company"/);
  assert.match(shell, /route: "\/partner\/compliance"/);
  assert.match(shell, /route: "\/partner\/workers"/);
  assert.match(shell, /route: "\/partner\/crews"/);
  assert.match(shell, /route: "\/partner\/vehicles"/);
  assert.match(shell, /route: "\/partner\/agreements"/);
  assert.match(shell, /\["Mobilization", "\/partner\/mobilization"\]/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
