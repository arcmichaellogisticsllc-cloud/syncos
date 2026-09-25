# SyncOS UI workflow and training audit — 2026-09-24–25

## Verdict

The application is **not certified flawless or complete**. This audit adds click-by-click training, repairs four bounded interaction/permission defects, and records incomplete workflows without narrowing the intended product scope. Passing automated scenarios does not establish that every button, record state, device or external integration works.

Functional candidate: `be16120` on branch `codex/passport-preparation`, based on `04b61bc`. Training-only follow-up: `ba47071`; no operational code changed in that follow-up. No deployment was performed. Shared staging, existing demo records and production data were not changed.

## What changed

| Finding | Repair | Verification scenario |
| --- | --- | --- |
| Daily submission had no reliable visible success/failure state and permitted uncertain repeat clicks | Busy state, immediate duplicate-click guard, stable request identity on retry, visible error/success, updated submitted record, disabled completion button and protection against a late response replacing another selected assignment | Daily-production P9 scenario: temporary failure, same-identity retry, success and immutable submitted revisions |
| Capacity matching could fail silently or display stale details | Blank-ID validation, pending state, visible error, stale-detail clearing and retry | Isolated UI test: blank ID, failed Open, successful Recalculate |
| Bank matching tabs exposed Open Match Form without its action permission | Exact `bank_transaction.match` gate on all three match tabs; inactive records remain disabled | Read-only, authorized and archived scenarios across Payment Batch, Payment Item and Cash Receipt tabs |
| QC Manager could request correction through the API but its UI authority list omitted that role | Added QC Manager to `qc_review.request_correction` only; general production approval authority unchanged | QC scenario submits correction through the actual modal, verifies persisted state and no premature acceptance/billing |

Training: new `/training` screen, internal-header and Partner/SyncField navigation links, three searchable/downloadable manuals, 151-route inventory, and a supervised actual-phone checklist. Training access does not grant operational permissions.

## Remaining findings

These findings come from source inspection unless an executed scenario is cited. They are not counted as browser-observed failures.

| Priority | Gap | Effect and required follow-up |
| --- | --- | --- |
| High | Partner inquiry qualification can carry stale organization context and asserts verification flags automatically | Selecting another inquiry can retain the previous organization ID; every qualification decision submits all five verification flags as true without individual controls. Reset/revalidate company context and capture explicit verification before relying on this path. |
| High | Partner self-service onboarding destinations are largely read-only | Checklist language suggests upload/edit/setup that the destinations cannot perform. Complete company/compliance/workforce/equipment entry or clearly identify the coordinator-mediated process before a new-partner onboarding pilot. |
| High | Daily-report customer-QC decision entry has no complete internal UI | Completeness, cycle creation and decision recording exist as APIs; partner views are read-only and foreman correction is separate. The generic `/qc` review model is not an equivalent customer decision. Build the authorized decision/reinspection screens before a click-only end-to-end pilot. |
| High | Production exports/closeout lack Generate/Download UI | Annotated maps, daily-production PDF/CSV and closeout packages have APIs but no complete UI control path on the production dashboard or portal. Do not certify viewing a status as generation/download. |
| High | Accepted-production finance lacks its full click path | Conversion, invoice/cash-clearing, partner settlement/payable creation and eligibility operations have API coverage but no equivalent complete UI path on `/accepted-production-financials`. Older workbench actions must not be described as interchangeable. Build and test that exact chain for both workforce types. |
| High | General photo/evidence upload and incident filing are absent | A construction record, note or JSA checkbox does not replace a required photo or incident report. Retain these requirements and implement/accept them before depending on them in the field. |
| High | Some correction requirements cannot be entered | Evidence/map/production-code revisions are not supported by the current correction editor. Unsupported changes remain rejected rather than silently discarded. Complete these paths and preserve original history. |
| High | Design-prep uses fixed geometry and lacks request feedback | Add Design Segment does not trace a real map line; Load/Add lack robust visible errors and busy guards. Do not use the generated line as surveyed geometry. |
| Medium | Partner inquiry feedback and retry gaps | Contact text is cleared even after a failed save; several actions lack an in-flight guard. Preserve failed input and prevent ambiguous repeats, especially for invitation actions. |
| Medium | Performance and executive refresh actions lack robust feedback | Partner Performance Open/Recalculate and Command Center Refresh can reject without a visible recovery state; the performance filters lack explicit accessible labels. Add pending/error handling and labels before calling this screen fully verified. |
| Medium | Retainage and adjustment UI is incomplete | The payment page has no clickable retainage-release or credit/rebill form despite backend operations. These cannot be certified as click-only workflows. |
| Medium | Coverage approval does not create a project through the UI | There is no complete project-creation handoff. Document the gap and implement an explicit, audited handoff. |
| Medium | QC edit and some relationship/constraint actions are placeholders | QC edit is guidance without Save; some tabs expose disabled future actions. Preserve requirements and distinguish informational screens from implemented workflows. |
| Medium | External-payment screen permissions need alignment | Page access checks read permission while initial data requests require execution permission; confirmation alone is insufficient for this screen. Resolve the intended role matrix without widening access as a workaround. |
| Medium | Raw identifiers and structured JSON remain in operational forms | Users need validated record values rather than guesswork. Replace with authorized record selectors and field-level guidance where appropriate. |
| Acceptance pending | Actual phones and connectivity | Desktop Chromium at narrow viewport is not iPhone/Android acceptance. Run the training index's real-device, loaded-session offline, reconnect/retry and offline cold-start checks for both crew types. |
| External dependency | Passport sandbox approval | Simulation and offline preparation are available. No live synchronization, external payment recording or transfer initiation is certified by these UI tests. |

## Evidence and limits

Testing uses localhost web port 3438 and API port 3457 with a newly created isolated database, `syncos_ui_training_test_20260924`. Only that database was migrated/seeded for this run. Synthetic test fixtures are not a customer pilot, and browser automation includes API-level checks as well as UI interactions.

The read-only action checks require the action button count to be zero. Some older test titles still say “hidden or disabled,” but their shared assertion requires absence; lifecycle-disabled controls are a separate authorized-user case.

The source-review manuals cover the available click paths and clearly mark unavailable ones. Route count is inventory coverage, not proof that every possible button/state combination was exercised. No passwords, tokens or private evidence belong in this report.

## Verification results

- Production web build and type validation passed for candidate `be16120`.
- All five isolated UI scenarios passed: training guide/search/download; capacity input/error/recalculation; Passport read-only simulation controls; unauthorized identity denial; failed-preview recovery.
- Training layout checks passed at 375, 390, 768, 844 and 1440 pixels, including landscape and reduced-motion mode. The mobile screenshot was visually reviewed. This is not native-phone, full-app accessibility, screen-reader, largest-system-text or independent dark-theme contrast certification.
- Local startup health passed with all 65 migrations, required tables, role seeds and permission seeds present. Redis readiness was intentionally skipped in this local test environment; no staging/production health claim follows from this check.
- The unit run passed 179 checks; four deployment-harness cases hit the original 20-second timeout. After increasing only the harness allowance and explicitly rejecting timeout errors, all six deployment safety cases passed. This resolves the four failures and rechecks the two early-denial cases: 183 distinct unit/control checks covered, no skipped cases. Deployment commands were mocked; no real deployment occurred.
- Full regression: **824 passed, 2 failed, 0 skipped, 0 flaky**, 28.8 minutes. Both failures came from the isolated wildcard test administrator being seeded before the complete base permission catalog: the auth permission hint and informational QC edit route were missing grants.
- Reconciled the 67 late-loaded catalog grants for **that isolated E2E wildcard administrator only**, matching its declared `*` fixture policy. No application role policy or shared account was changed. The two affected checks then passed: **2 passed, 0 failed, 0 skipped**. All 826 scenarios therefore have a passing result across the full run and targeted rerun; this was not one uninterrupted all-green run.
- Training-only follow-up `ba47071`: production build/type validation passed, bundled manuals matched their source files, and all five focused UI scenarios passed again (0 failed). The complete regression was not repeated for prose-only changes.

## Verification corrections

An initial unit run found that local shared-package resolution pointed to the older canonical checkout. Local dependency links were corrected to this candidate before the final build/API startup. The isolated database was renamed to include `test`, satisfying existing fixture safety guards without loosening those guards. An early browser run was interrupted for those final candidate changes; its partial results are not counted as the completed regression.

An early training assertion matched both the navigation status and workflow count. The selector was narrowed to the count. The corrected test passed without changing application behavior to accommodate the assertion.


## Observed repaired paths

| Scenario | Result |
| --- | --- |
| Bank matching: read-only, authorized and archived records across all three match tabs | Passed; unauthorized buttons absent, permitted modal opens/cancels, archived control disabled |
| QC Manager correction through the real modal/API | Passed; correction persisted, no premature acceptance or billable result |
| Foreman daily submission after a temporary failed request | Passed; same mutation identity on retry, visible success, disabled submitted control, immutable revision |
| Partner Administrator and Foreman Training navigation | Passed in authenticated portal scenarios |
| Sync employee crew provisioning through field production | Passed with readiness and access boundaries |
| Partner accepted-quantity financial handoff and employee exclusion from partner debt | Passed in API/role scenarios; does not fill the missing click-only finance UI |
| Mobile modal, tablet workbench and keyboard navigation scenarios | Passed in desktop Chromium emulation; actual devices remain pending |

## Reproduce safely

Use a newly created, explicitly named local test database and isolated file storage. Load migrations, **base seed before E2E seed**, then launch the candidate API/web on localhost with test authentication and local-only email delivery. Never run these seeds against shared staging.

The suite is `npx playwright test --workers=1`; focused Training/Passport/capacity UI checks use `npm run passport:ui:test`; unit/control checks use `npm test`. Use the current candidate's workspace packages so startup and migration checks resolve the same schema manifest. Keep credentials out of logs and reports.

Raw execution logs and JSON reports are retained locally under `/private/tmp/syncos-ui-training-*`; they are not committed as general training material. The guide index contains the supervised actual-phone checklist and evidence fields. Close the high-priority UI gaps and complete those observed crew checks before signing off a click-only end-to-end pilot.
