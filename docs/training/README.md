# SyncOS click-by-click training

Open **Training** in the internal app header or the Partner/SyncField navigation, or open `/training` directly after signing in. Select a guide, search for a workflow, and use **Download this guide** for an offline Markdown copy.

These manuals describe the current implementation. They retain incomplete requirements as explicit gaps rather than inventing buttons or treating API-only features as finished UI workflows. Review the [verification report](../releases/ui-workflow-audit-2026-09-24.md) before scheduling crew acceptance.

| Guide | Audience and coverage |
| --- | --- |
| [Demand, operations and quality](demand-operations-and-quality.md) | Account intake, relationships, opportunities, coverage, projects, work orders, production, QC and oversight |
| [Sync crews and partner crews](field-and-partner.md) | Workforce setup, readiness, assignments, maps, JSA, daily production, review/submission, corrections and company oversight |
| [Finance and payment controls](finance-and-controls.md) | Customer billing, collections, partner settlements, employee payroll, external payment recording, bank matching, accounting and Passport simulation |
| [Route inventory](route-inventory.md) | 151 application page routes mapped to their source and training chapter |

## Run a supervised training session

1. Agree on a practice environment and named test records. Preserve shared demo and operational records.
2. Confirm the actor's workforce type, organization, crew and granted permissions. A missing unauthorized action is expected behavior.
3. Select one documented procedure. Complete its prerequisites before clicking an action.
4. Follow the steps in order, verifying each resulting heading, record identity and status. Reopen saved records to confirm persistence.
5. Record the expected result, actual result and any error. Stop that scenario if the guide marks its required click path incomplete.
6. Use both a Sync employee crew and a partner crew. Track their acceptance separately; do not assume one proves the other.
7. For finance exercises, distinguish accepted production, invoice status, customer cash, partner eligibility and actual external payment. Passport examples do not move money or mark real records paid.
8. Repeat field exercises on actual phones using the checklist below before crew release.

## Actual-phone and connectivity acceptance — not yet executed

| Check | Click sequence and expected observation |
| --- | --- |
| Sign-in and assignment | On each supported iPhone/Android device, sign in as the assigned crew actor; open Today; select the assigned work; verify company, crew, work order and map version. No other crew's work should appear. |
| Touch and reading | Open each field section used that day; tap controls without zooming; rotate the phone; open the keyboard in quantity/notes fields. Labels, errors and save actions must remain readable and reachable. |
| Already-loaded connection loss | Load the assignment online, then enable airplane mode. Enter a designated test draft and attempt only the documented operation. Record the visible offline/error state and whether the draft survives. Do not assume a queued save unless it is explicitly shown. |
| Reconnect and duplicate protection | Restore connectivity and retry the same failed submission. Reopen the record and verify one submission/revision, unchanged totals and clear confirmation. |
| Offline cold start | Close the browser tab, enable airplane mode, and open the application afresh. Record the actual result separately from the loaded-session test. Offline startup is not certified. |
| Corrections | On a designated rejected test item, open the correction, edit a supported field, submit, and have the authorized QC actor reinspect. Confirm original history remains and acceptance is separate. |
| Evidence | Follow only an implemented evidence path. General photo upload and incident filing are currently gaps; a note or JSA checkbox does not replace them. |

Record device model, OS/browser version, workforce, role, test record IDs, connection condition, expected/actual outcome, time, evidence and retest result. Do not include passwords, tokens or private document contents.

## Maintain the in-app manuals

The three chapter files are authoritative training sources. Run `node scripts/build-training-manuals.js` after editing them to regenerate `apps/web/app/training/manuals.json`, then rebuild and verify the training screen. Keep this index, route inventory and verification report aligned with the candidate actually tested.
