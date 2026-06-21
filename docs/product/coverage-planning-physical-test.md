# Coverage Planning Physical Test

This test validates the Coverage Planning Workspace as an operator experience. The tester must use the UI only.

Pass criteria:

- No database access.
- No direct API calls.
- No developer intervention.
- No project, work order, production, settlement, invoice, payment, payroll, AR, or cash records are created.
- Coverage readiness is understandable.
- The operator understands whether awarded work can be covered.

## Preconditions

- Tester has a valid SyncOS token.
- Tester has coverage permissions required for the actions being tested.
- At least one awarded opportunity exists.
- Backend coverage routes are available.

## Test Steps

1. Open `/opportunities/coverage`.
2. Confirm the Opportunity navigation includes Coverage Planning.
3. Confirm the list loads or shows the no-coverage-plans empty state.
4. Confirm the no-downstream-record boundary is visible.
5. Confirm the list shows backend counts for requirements, sources, open gaps, and hard-stop gaps.
6. Confirm operations owner displays as a name where backend enrichment is available.
7. Confirm recommended next action is visible in the list.
8. Use filters for hard stops, economic risk, compliance risk, and capacity gap.
9. Open `/opportunities/coverage/new`.
10. Select an awarded opportunity.
11. Optionally enter operations owner and notes.
12. Create the coverage plan.
13. Confirm the app navigates to coverage detail.
14. Confirm no project was created.
15. Add a coverage requirement with work type, quantity, unit, and territory.
16. Edit the requirement.
17. Add a coverage source with source type, covered quantity, unit, confidence score, and commitment status.
18. Add economic or margin source data.
19. Edit the source.
20. Add a coverage gap with gap type, severity, gap quantity, and unit.
21. Recalculate readiness.
22. Confirm readiness scores update or remain honestly unavailable.
23. Confirm backend warnings, blockers, and required override fields are visible in detail.
24. Confirm margin unknown, low margin, or negative margin appears as a warning and not an automatic hard block.
25. Add or edit a gap so `hard_stop = true`.
26. Open the Approval For Handoff panel.
27. Confirm the hard stop blocks approval.
28. Resolve the hard stop gap or archive it if supported.
29. Add a non-hard-stop open gap.
30. Confirm approval requires override reason.
31. Override the non-hard-stop gap.
32. Approve for handoff with approval note and required override reasons.
33. Confirm the success message says no project was created.
34. Open the Timeline tab and confirm coverage plan, requirement, source, and gap events are visible.
35. Open the Audit tab as an authorized user and confirm audit rows are visible.
36. Remove audit permission locally and confirm the Audit tab does not expose audit payloads.
37. Archive a requirement if supported and provide an approved archive reason.
38. Archive a source if supported and provide an approved archive reason.
39. Archive a gap if supported and provide an approved archive reason.
40. Archive the coverage plan if supported and provide an approved archive reason.
41. Confirm unauthorized actions are hidden or disabled when permissions are removed from the local permission list.

## Expected Results

- Coverage plan list is usable.
- Coverage plan create/edit works.
- Coverage detail is usable.
- Coverage list uses backend-enriched counts and owner names.
- Backend recommended next action is visible.
- Backend warnings, blockers, and required override fields are visible.
- Requirements can be created, edited, and archived.
- Sources can be created, edited, and archived.
- Gaps can be created, edited, resolved, overridden, and archived.
- Economic and margin readiness are visible.
- Compliance readiness is displayed honestly.
- Recalculate works through backend API.
- Approve for handoff works only when backend validation allows it.
- Hard stop gaps block handoff approval.
- Non-hard-stop gaps require override or resolution.
- Approval creates no project or downstream records.
- Timeline shows coverage operational history when authorized.
- Audit summary is permission-protected.
- Permissions are reflected in visible actions.

## Failure Conditions

- The tester must use direct API calls or database access.
- Coverage approval creates any downstream execution or finance record.
- Hard stop gaps can be approved without resolution.
- Non-hard-stop warnings can be approved without required override reasons.
- Unauthorized actions remain available as primary UI actions.
