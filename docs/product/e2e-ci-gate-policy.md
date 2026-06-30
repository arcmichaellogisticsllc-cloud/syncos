# E2E CI Gate Policy

## Purpose

Defines the three CI gate tiers, their scope, pass/fail thresholds, and the npm scripts that execute each tier.

## Gate Tiers

### PR Gate

**Script:** `npm run e2e:ci:pr`

**Scope:**
- Route matrix
- Critical workflows
- Persona permission checks
- Boundary assertions

**Threshold:** 100% pass required. No critical failures. No workflow blockers. Any failure blocks merge.

**Artifacts retained:**
- Screenshots on failure
- Videos on failure
- Traces on retry or failure

**When it runs:** Every pull request targeting main.

---

### Nightly Certification Gate

**Script:** `npm run e2e:ci:nightly`

**Scope:**
- All PR gate scope
- Lifecycle tests
- Detail hydration
- Timeline and audit checks
- Full action-states suite (modals, boundaries, personas, readiness, submit)

**Threshold:** 100% pass on certified states. Legitimately blocked states (`submitCertificationStatus: "blocked"`) are skipped and do not count as failures. Any critical failure or workflow blocker fails the gate.

**Artifacts retained:**
- All PR tier artifacts
- Canonical screenshots
- Full videos and traces per CI policy

**When it runs:** Nightly on main.

---

### Release Certification Gate

**Script:** `npm run e2e:ci:release`

**Scope:** Same as nightly certification gate.

**Threshold:** Same as nightly. Must be preceded by `npm run release:validate` passing.

**Artifacts retained:** Same as nightly. All artifacts must be uploaded before release is approved.

**When it runs:** Before any external integration work begins. Required before marking SyncOS Release Certified.

---

## Full Modal Certification Script

**Script:** `npm run e2e:full-modals`

**Scope:** `action-state-submit.spec.ts` only — the modal submit certification suite.

**Use:** Local validation after seed or modal changes. Run after `npm run e2e:seed-smoke` confirms the seed is intact.

---

## Blocked State Policy

A state with `submitCertificationStatus: "blocked"` must include a `notes` field with:

1. The exact API guard or constraint that prevents submit.
2. The precise seed data or business-logic condition that causes the block.
3. Why the block cannot be resolved without mutating product behavior or introducing fake data.

Tests for blocked states must use `test.skip` with the BLOCKED reason in the title. They must not be silently removed.

States may only be moved from `"blocked"` to `"certified"` when:
- The root cause is identified and fixed in seed data or persona config
- A spec test exercises the full browser submit flow end to end
- The DB assertion confirms the expected mutation occurred
- No production application behavior was changed to make the test pass

---

## Forbidden CI Practices

- Do not weaken selectors to make tests pass
- Do not add arbitrary sleeps or broad retries
- Do not remove assertions
- Do not skip failing tests without a precise BLOCKED reason in the fixture
- Do not mark SyncOS fully certified unless all certification requirements are met
- Do not mutate production application behavior to make tests pass
