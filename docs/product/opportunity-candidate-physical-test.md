# Opportunity Candidate Physical UI Test

## Purpose

Validate that an operator can use the Opportunity Candidate workspace without API calls, database access, or developer intervention.

## Preconditions

- Tester has a valid SyncOS user session or JWT.
- Tester has permissions required for the actions being tested.
- Existing organization, signal, and relationship map data are available for the tenant.

## Test Steps

1. Open `/opportunities/candidates`.
2. Confirm Opportunity navigation is visible.
3. Confirm Candidate Board loads.
4. Toggle to table view.
5. Create a candidate from the UI.
6. Assign organization.
7. Assign territory.
8. Assign work type.
9. Enter estimated value if known.
10. Assign owner where permitted.
11. Link a relationship map where permitted.
12. Attach a signal during create if available.
13. Open Candidate Detail.
14. Confirm header shows candidate status, organization, territory, work type, estimated value, signal count, relationship access, and score fields.
15. View related organization panel.
16. View related signals panel.
17. Attach another signal from Candidate Detail.
18. View relationship access panel and confirm linked map data is backend-truthful.
19. Score candidate if the user has `opportunity_candidate.score`.
20. Move candidate to Monitoring.
21. Move candidate to Investigating.
22. Qualify candidate when backend readiness allows it.
23. Confirm readiness/completeness updates from backend data.
24. Reject a candidate with reason and optional note.
25. Archive a candidate with reason and optional note.
26. Archive a candidate signal link with reason where available.
27. View constraints slice.
28. View recommendations slice.
29. View timeline slice and confirm candidate/candidate-signal events are visible when permitted.
30. View audit slice as authorized user.
31. Confirm unauthorized user cannot see audit.
32. Open AI Candidate Research placeholder.
33. Confirm no opportunity is created.

## Pass Criteria

- No API calls by tester.
- No database access by tester.
- No developer intervention.
- Permissions are reflected in UI.
- Tenant boundaries are enforced by backend APIs.
- Writes use backend APIs and retain event/audit/system_action behavior.
- Candidate lifecycle is understandable.
- User understands whether candidate should move forward.
- Unsupported backend relationships are shown honestly.
- No Opportunity Pipeline, project creation, capacity deployment, or finance execution is introduced.

## Expected Deferred States

- Full Opportunity Pipeline is not present.
- Capacity fit is only a placeholder/score display in this sprint.
- Project, capacity deployment, pricing, and finance execution are not introduced.
