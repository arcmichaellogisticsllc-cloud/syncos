# Safety authorization candidate

This is a local candidate, not a staging deployment or a field-readiness certificate. Priority automation remains disabled. Demo and operational databases were not reseeded or reset.

## Implemented

- Present workers acknowledge their own current completed JSA using an authenticated, active worker account. Another worker cannot be selected; revision mismatch and former revisions are rejected. Foreman certification remains separate.
- Attendance must meet the crew staffing target and include the foreman. New crew members require a JSA revision.
- Management records the reviewed safety scope and its governing source. Applicable pre-bore inspection requires a separate verified construction-supervisor approval. Underground codes also require this approval. Revocation blocks production.
- Shutdowns cover all selected crews/work orders. A location label is retained, but enforcement conservatively covers the entire selected crew/work order until authoritative geographic boundaries exist.
- Utility strikes require utility-owner clearance, Safety approval, then Operations approval. Other stops require Safety then Operations. Actual approver, approval time, evidence reference, recorder and audit history are retained. Restart also requires a renewed JSA and individual acknowledgments; previous-location pre-bore approval does not transfer.
- The older production-record release endpoint cannot independently release an active stop. Existing imported shutdowns require an explicit Safety classification review before restart approvals.
- Field production, edits, submission and physical correction paths recheck applicable stops. Existing underground records are rechecked after approval revocation. Generic administrative production mutations also check scoped stops.
- A linked worker without another application workspace lands on the safety page. Privileged forms are hidden from field users; server authorization is independent of the UI.

## Verification

Final local API/web candidate: 27 Playwright checks passed across `internal-workforce.spec.ts`, `syncfield-daily-production.spec.ts`, and `syncfield-customer-qc.spec.ts`. These include both workforce types, independent worker identities, pre-bore approval/revocation, ordered utility-strike restart, imported-stop classification, legacy release denial, safety-page visibility, offline production replay, upload retry, correction history and existing production-to-finance paths.

All migrations through 073 applied successfully to a fresh disposable database. Historical acknowledgment flags were not promoted into personal acknowledgment evidence. Two explicit database preservation tests passed against a disposable restored database. The broader unit suite had 197 passes and two intentionally skipped database checks before those two checks were run explicitly. A final unit rerun is recorded separately when complete.

An earlier browser test timed out during context cleanup; it passed on subsequent full runs. A safety-page SQL error was exposed by the browser test, fixed, and covered by the final passing run. These intermediate failed runs do not count as acceptance evidence.

## Remaining limits

- Actual phone/passkey/shared-device identity and device suspension testing remains unperformed. Browser viewport/offline simulation is not actual-phone acceptance.
- The location scope is conservative, not a geographic boundary engine.
- Staff verify and record external approval evidence; the application does not contact utilities or supervisors or manufacture their approval.
- The generic administrative production pathway still needs review against all individual-JSA and pre-bore prerequisites, beyond the scoped-stop checks added here.
- The separate evidence completeness, quantity overlap/subset, prime-policy deadline, contract terms, invoice-package and reconciliation priorities remain open. Existing end-to-end test success does not waive them.
