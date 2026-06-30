#!/usr/bin/env node
/**
 * E2E certification and test hygiene enforcer.
 *
 * Modes:
 *   dev (default)  — blocked+notes warns; all other violations fail
 *   CI             — blocked always fails regardless of notes (release-ready standard)
 *
 * CI mode activates when --ci flag is passed OR process.env.CI is truthy.
 * GitHub Actions sets CI=true automatically.
 *
 * Checks — action-states.ts:
 *   "not-certified"          → always fail
 *   "blocked" without notes  → always fail
 *   "blocked" with notes     → warn in dev, fail in CI
 *   forbiddenTables: []      → always fail (must declare downstream mutation scope)
 *   notes: "..." / "" / "TODO" → always fail (placeholder is worse than no notes)
 *
 * Checks — *.spec.ts files under tests/e2e/:
 *   test.skip   → always fail (use submitCertificationStatus instead)
 *   test.only   → always fail (breaks CI by running a focused subset)
 *   .fixme      → always fail (marks a test as known-broken without resolution)
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CI_MODE = process.argv.includes("--ci") || !!process.env.CI;
const MODE_LABEL = CI_MODE ? "CI" : "dev";

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "tests/e2e/fixtures/action-states.ts");

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

// ── action-states.ts ─────────────────────────────────────────────────────────

const source = fs.readFileSync(fixturePath, "utf8");
const lines = source.split("\n");

/**
 * Given a line index, walk backward/forward to find the containing object
 * literal's line range (the innermost { ... } block).
 */
function findObjectBlock(lineIndex) {
  let objStart = lineIndex;
  for (let j = lineIndex - 1; j >= 0; j--) {
    if (/^\s*\{/.test(lines[j])) {
      objStart = j;
      break;
    }
  }
  let objEnd = lineIndex;
  for (let j = lineIndex + 1; j < lines.length; j++) {
    if (/^\s*\}/.test(lines[j])) {
      objEnd = j;
      break;
    }
  }
  return lines.slice(objStart, objEnd + 1).join("\n");
}

function extractStateKey(block) {
  const match = block.match(/stateKey:\s*["']([^"']+)["']/);
  return match ? match[1] : "(unknown)";
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // not-certified — always fail
  if (/submitCertificationStatus:\s*["']not-certified["']/.test(line)) {
    fail(`  action-states.ts:${i + 1}: "not-certified" — every state must be certified or carry a documented technical blocker`);
    continue;
  }

  // blocked
  if (/submitCertificationStatus:\s*["']blocked["']/.test(line)) {
    const block = findObjectBlock(i);
    const stateKey = extractStateKey(block);
    const hasNotes = /\bnotes\s*:/.test(block);

    if (!hasNotes) {
      fail(`  action-states.ts:${i + 1} (${stateKey}): "blocked" without notes — document the technical blocker`);
    } else if (CI_MODE) {
      fail(`  action-states.ts:${i + 1} (${stateKey}): "blocked" — all states must be certified for release (resolve the blocker)`);
    } else {
      warn(`  action-states.ts:${i + 1} (${stateKey}): "blocked" with notes — must be certified before release`);
    }
  }

  // forbiddenTables: [] — each state must explicitly declare its downstream mutation scope
  if (/forbiddenTables:\s*\[\s*\]/.test(line)) {
    const block = findObjectBlock(i);
    const stateKey = extractStateKey(block);
    fail(`  action-states.ts:${i + 1} (${stateKey}): forbiddenTables is [] — declare which downstream tables this action must not mutate`);
  }

  // placeholder notes — literal "...", empty string, or "TODO"
  if (
    /\bnotes\s*:\s*["']\.\.\.["']/.test(line) ||
    /\bnotes\s*:\s*["']\s*["']/.test(line) ||
    /\bnotes\s*:\s*["']TODO["']/i.test(line)
  ) {
    fail(`  action-states.ts:${i + 1}: notes is a placeholder ("...", empty, or "TODO") — replace with a real explanation of the blocker`);
  }
}

// ── spec files ───────────────────────────────────────────────────────────────

function findSpecFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSpecFiles(fullPath));
    } else if (entry.name.endsWith(".spec.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

const specFiles = findSpecFiles(path.join(root, "tests/e2e"));

for (const specPath of specFiles) {
  const rel = path.relative(root, specPath);
  const specLines = fs.readFileSync(specPath, "utf8").split("\n");

  for (let i = 0; i < specLines.length; i++) {
    const line = specLines[i];
    const loc = `  ${rel}:${i + 1}`;

    // Skip lines that are pure comments
    if (line.trimStart().startsWith("//")) continue;

    if (/\btest\.skip\b/.test(line)) {
      fail(`${loc}: test.skip — use submitCertificationStatus "blocked" with notes instead`);
    }

    if (/\btest\.only\b/.test(line)) {
      fail(`${loc}: test.only — remove before committing (breaks CI by running only this test)`);
    }

    if (/\.fixme\b/.test(line)) {
      fail(`${loc}: .fixme — fix the test or document the blocker via submitCertificationStatus`);
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────

const certifiedCount = lines.filter((l) =>
  /submitCertificationStatus:\s*["']certified["']/.test(l)
).length;

if (warnings.length > 0) {
  console.warn(`E2E certification — ${MODE_LABEL} warnings (must resolve before release):`);
  for (const w of warnings) console.warn(w);
  console.warn("");
}

if (errors.length > 0) {
  console.error(`E2E certification check FAILED [${MODE_LABEL}]:`);
  for (const e of errors) console.error(e);
  console.error(`\n  ${certifiedCount} certified, ${errors.length} violation(s)`);
  process.exit(1);
}

console.log(
  `E2E certification check passed [${MODE_LABEL}] — ${certifiedCount} certified` +
    (warnings.length > 0 ? `, ${warnings.length} warning(s)` : "")
);
