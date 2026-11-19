const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('reviewer fixture helper and authenticated test contract exist', () => {
  const helper = fs.readFileSync('tests/e2e/helpers/partner-compliance-fixtures.ts', 'utf8');
  const reviewer = fs.readFileSync('tests/e2e/partner-compliance-reviewer-download.spec.ts', 'utf8');
  assert.match(helper, /signE2EJwt/);
  assert.match(helper, /Authorization|authorization/);
  for (const name of ['createReviewerDownloadFixtureContext','ensurePartnerAdminFixture','ensureInternalReviewerFixture','assertEffectivePermission','createCompanyComplianceSource','uploadPartnerComplianceEvidence','loadEvidenceArtifactRelationship','countReviewerDownloadAuditEvents']) assert.match(helper, new RegExp(name));
  assert.match(reviewer, /authenticated reviewer downloads exact evidence-linked binary artifact @authenticated-reviewer/);
  assert.match(reviewer, /authenticated Partner Admin downloads own-company artifact through Partner route @authenticated-reviewer/);
  assert.match(reviewer, /authenticated Partner Admin is denied from internal reviewer route @authenticated-reviewer/);
  assert.match(reviewer, /beforeAll/); assert.match(reviewer, /afterAll/);
  assert.equal((reviewer.match(/@authenticated-reviewer/g)||[]).length, 3);
  const positives = reviewer.split('test("route registration smoke"')[0];
  assert.doesNotMatch(positives, /randomUUID\(\)|not-a-uuid|123456/);
  assert.doesNotMatch(reviewer, /test\.skip|test\.fixme/);
});
