#!/usr/bin/env node
/**
 * CI gate: fail if any action state is "not-certified" or "blocked" without a notes field.
 *
 *   "not-certified" → always fail (every state must be tested before being declared uncertified)
 *   "blocked" without notes → fail (technical blockers must be documented so they can be revisited)
 *   "blocked" with notes → warn (accepted, documented blocker)
 *   "certified" → pass
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const fixturePath = path.join(__dirname, "../tests/e2e/fixtures/action-states.ts");
const source = fs.readFileSync(fixturePath, "utf8");
const lines = source.split("\n");

const errors = [];
const warnings = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // "not-certified" is never allowed in production — every state must be tested
  if (/submitCertificationStatus:\s*["']not-certified["']/.test(line)) {
    errors.push(`  Line ${i + 1}: submitCertificationStatus "not-certified" — write the test or document a real technical blocker`);
    continue;
  }

  // "blocked" is allowed only with an adjacent notes field in the same object
  if (/submitCertificationStatus:\s*["']blocked["']/.test(line)) {
    // Scan backward to the object's opening { (first line that starts with optional whitespace then {)
    let objStart = i;
    for (let j = i - 1; j >= 0; j--) {
      if (/^\s*\{/.test(lines[j])) {
        objStart = j;
        break;
      }
    }

    // Scan forward to the object's closing } (first line that starts with optional whitespace then })
    let objEnd = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*\}/.test(lines[j])) {
        objEnd = j;
        break;
      }
    }

    const block = lines.slice(objStart, objEnd + 1).join("\n");

    // Extract stateKey for a readable error message
    const stateKeyMatch = block.match(/stateKey:\s*["']([^"']+)["']/);
    const stateKey = stateKeyMatch ? stateKeyMatch[1] : "(unknown)";

    const hasNotes = /\bnotes\s*:/.test(block);
    if (hasNotes) {
      warnings.push(`  ${stateKey}: blocked with notes (documented technical blocker)`);
    } else {
      errors.push(`  Line ${i + 1} (${stateKey}): submitCertificationStatus "blocked" without notes — add a notes field explaining the technical blocker`);
    }
  }
}

const certifiedCount = lines.filter((l) =>
  /submitCertificationStatus:\s*["']certified["']/.test(l)
).length;

if (warnings.length > 0) {
  console.warn("E2E certification — documented blockers (action required before release):");
  for (const w of warnings) console.warn(w);
  console.warn("");
}

if (errors.length > 0) {
  console.error("E2E certification check FAILED:");
  for (const e of errors) console.error(e);
  console.error("");
  console.error(`  ${certifiedCount} certified, ${errors.length} violation(s)`);
  process.exit(1);
}

const blockedWithNotes = warnings.length;
console.log(
  `E2E certification check passed — ${certifiedCount} certified` +
    (blockedWithNotes > 0 ? `, ${blockedWithNotes} documented blocker(s)` : "")
);
