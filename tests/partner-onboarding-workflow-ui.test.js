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
  assert.match(shell, /Review & Submit/);
  assert.match(shell, /Company Approved/);
  assert.match(shell, /Crew Ready/);
  assert.match(shell, /Project Mobilization/);
  assert.match(shell, /Approval remains locked until required gates are complete/);
  assert.match(shell, /onboardingStatusLabel/);
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

test("Partner invite activation is separated from company onboarding", () => {
  const invite = read("apps/web/app/partner/invite/[token]/page.tsx");

  assert.match(invite, /You've been invited to join SyncOS/);
  assert.match(invite, /Create your account/);
  assert.match(invite, /Activate Account/);
  assert.match(invite, /Continue to Partner Onboarding/);
  assert.match(invite, /acceptedPath/);
  assert.match(invite, /Password must be 12 to 128 characters/);
  assert.match(invite, /Use a password unique to SyncOS/);
  assert.match(invite, /sync-comm-systems-logo\.png/);
  assert.doesNotMatch(invite, /preview\.checklist/);
  assert.doesNotMatch(invite, /Complete Onboarding/);
  assert.doesNotMatch(invite, /MobilizationLocked/);
});

test("Partner onboarding and activation use Sync brand colors for primary surfaces", () => {
  const styles = read("apps/web/app/styles.css");

  assert.match(styles, /--accent: #0457ff/);
  assert.match(styles, /--accent-2: #f6b600/);
  assert.match(styles, /\.partner-button\.primary\s*{\s*background: var\(--accent\);/);
  assert.match(styles, /\.onboarding-current-step\s*{[^}]*border-top: 4px solid var\(--accent-2\);/s);
  assert.match(styles, /\.partner-invite-summary\s*{[^}]*border-top: 4px solid var\(--accent-2\);/s);
  assert.doesNotMatch(styles, /\.partner-button\.primary\s*{[^}]*#236344/s);
});

test("Partner onboarding presentation protects against raw enums and IDs", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");

  assert.match(shell, /OnboardingStatusBadge/);
  assert.match(shell, /onboardingStatusLabel/);
  assert.doesNotMatch(shell, /organization_id/);
  assert.doesNotMatch(shell, /MOBILIZATION_LOCKED/);
  assert.doesNotMatch(shell, /INTERNAL_REVIEW_PENDING/);
  assert.doesNotMatch(shell, /Company ProfileRequired/);
  assert.doesNotMatch(shell, /W-9Required/);
  assert.doesNotMatch(shell, /AgreementPending/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
