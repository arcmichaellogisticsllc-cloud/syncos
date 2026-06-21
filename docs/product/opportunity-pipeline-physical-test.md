# Opportunity Pipeline Physical UI Test

## Goal

Validate that an operator can manage pursue-worthy work without creating downstream execution, capacity deployment, or finance records.

## Steps

1. Open `/opportunities/pipeline`.
2. Confirm Opportunity navigation shows Candidate Board, Opportunity Pipeline, and Pursuit Management placeholder.
3. Confirm summary cards render all required status, value, relationship, capacity, constraint, and approval-readiness counts.
4. Toggle board/table view and apply required filters.
5. Open `/opportunities/new`.
6. Create a manual opportunity.
7. Create an opportunity from a qualified candidate through the conversion flow.
8. Confirm unqualified candidates cannot be converted.
9. Open Opportunity Detail.
10. Edit opportunity fields.
11. View source candidate, organization, relationship access, capacity, constraints, recommendations, timeline, and audit panels.
12. Confirm weak/no relationship access remains visible as warning, not a UI blocker.
13. Submit for pursuit review.
14. Approve pursuit with override reasons when warnings exist.
15. Confirm approval tier and required approver roles are visible.
16. Confirm Growth Director can approve pursuit under `$50k`.
17. Confirm Growth Director cannot approve pursuit at `$50k+`.
18. Confirm missing estimated value requires Regional Director+ and `missing_value_override_reason`.
19. Confirm weak relationship access requires `relationship_access_override_reason`.
20. Confirm unknown capacity requires `capacity_override_reason`.
21. Confirm unknown margin requires `margin_override_reason`.
22. Confirm non-hard-stop critical constraints require `constraints_override_reason`.
23. Confirm `hard_stop = true` constraints block approval.
24. Confirm missing core fields and missing permissions still block.
25. Move to pursuing, proposal, negotiation, awarded, lost, deferred, and archived where permissions allow.
26. Confirm lost, deferred, archive, and capacity archive reasons are captured.
27. Add and edit a capacity requirement.
28. Archive capacity requirement with reason.
29. Mark an opportunity awarded and confirm no project, work order, contract, settlement, invoice, payment, payroll, or cash record is created.
30. Confirm timeline shows opportunity and capacity events.
31. Confirm audit is visible only to authorized users.
32. Confirm Analyze Pursuit placeholder is visible and performs no live AI automation.

## Pass Criteria

- No direct API calls by tester.
- No database access by tester.
- Permissions are reflected in visible/enabled actions.
- Tenant boundaries are enforced by API.
- Writes create event, event_payload, audit_log, and system_action through backend routes.
- Relationship weakness is a warning/override path, not an acquisition blocker.
- Awarded status creates no downstream execution or finance records.
- Operator understands status, next action, relationship risk, capacity planning state, and pursuit boundary.
