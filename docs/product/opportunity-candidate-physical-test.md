# Opportunity Candidate Physical UI Test

## Purpose

Validate that an operator can use the Opportunity Candidate workspace without API calls, database access, or developer intervention.

## Preconditions

- Tester has a valid SyncOS user session or JWT.
- Tester has permissions required for the actions being tested.
- Existing organization and signal data are available for the tenant.

## Test Steps

1. Open `/opportunities/candidates`.
2. Confirm Opportunity navigation is visible.
3. Confirm Candidate Board loads.
4. Toggle to table view.
5. Create a candidate from the UI.
6. Assign organization.
7. Assign territory.
8. Assign work type.
9. Attach a signal during create if available.
10. Open Candidate Detail.
11. Confirm header shows candidate status, organization, territory, work type, signal count, and score fields.
12. View related organization panel.
13. View related signals panel.
14. Attach another signal from Candidate Detail.
15. View relationship access panel.
16. Confirm no relationship map is invented when none exists.
17. Score candidate if the user has `opportunity_candidate.score`.
18. Move candidate to Monitoring.
19. Move candidate to Investigating.
20. Qualify candidate when backend readiness allows it.
21. Reject a candidate with reason.
22. Archive a candidate with reason where supported.
23. View constraints slice.
24. View recommendations slice.
25. View timeline slice and confirm unsupported state if endpoint is absent.
26. View audit slice as authorized user and confirm unsupported state if endpoint is absent.
27. Confirm unauthorized user cannot perform hidden or disabled actions.
28. Open AI Candidate Research placeholder.
29. Confirm no opportunity is created.

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

## Expected Unsupported States

- Candidate timeline endpoint is not available yet.
- Candidate audit summary endpoint is not available yet.
- Candidate estimated value is not captured by the current backend contract.
- Direct candidate-to-relationship-map linking is not available yet.
- Capacity fit is only a placeholder/score display in this sprint.

