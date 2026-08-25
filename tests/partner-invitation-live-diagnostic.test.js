const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("Partner Admin manual invite validates raw IDs before SQL", () => {
  const controller = read("apps/api/src/routes/partner-invitations.controller.ts");

  assert.match(controller, /private requiredUuid/);
  assert.match(controller, /organization_id must be a valid UUID/);
  assert.match(controller, /const organizationId = this\.requiredUuid\(body\.organization_id/);
  assert.doesNotMatch(controller, /const organizationId = this\.requiredString\(body\.organization_id, "organization_id is required"\)/);
});

test("Partner Network manual invite shows local feedback near the form", () => {
  const page = read("apps/web/app/partner-network/page.tsx");

  assert.match(page, /manualInviteState/);
  assert.match(page, /Primary contact name/);
  assert.match(page, /role="alert"/);
  assert.match(page, /Manual invitation request complete/);
  assert.match(page, /disabled=\{manualInviteState\.loading\}/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
