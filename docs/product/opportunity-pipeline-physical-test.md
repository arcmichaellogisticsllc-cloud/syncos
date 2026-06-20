# Opportunity Pipeline Physical UI Test

## Goal

Validate that an operator can manage pursue-worthy work from Opportunity Pipeline without creating downstream execution or finance records.

## Setup

- Use a tenant user with opportunity, capacity requirement, candidate, organization, relationship map, constraint, and recommendation read permissions.
- Use elevated permissions only for lifecycle actions that require them.
- Do not use direct API calls.
- Do not use database access.

## Test Steps

1. Open `/opportunities/pipeline`.
2. Confirm the Opportunity navigation shows Candidate Board, Opportunity Pipeline, and Pursuit Management placeholder.
3. Confirm summary cards render Total, Draft, Pursuit Review, Pursuit Approved, Pursuing, Proposal, Negotiation, Awarded, Lost, Deferred, High Value, Weak Relationship Access, Missing Capacity Requirements, Open Constraints, and Ready For Pursuit Approval.
4. Toggle board/table view.
5. Apply filters for status, organization, work type, relationship access, missing capacity requirements, and open constraints.
6. Open `/opportunities/new`.
7. Create an opportunity manually if the backend actor has authority.
8. Create an opportunity from a qualified candidate if current backend candidate creation is supported through `POST /opportunities` with `candidate_id`.
9. Confirm unqualified candidates are not presented as conversion-ready.
10. Open the Opportunity Detail page.
11. Edit the opportunity.
12. View source candidate panel.
13. Open source candidate if linked.
14. View organization context and open organization.
15. View relationship access panel.
16. Confirm weak or missing relationship access shows the warning: it must not hide or delete the opportunity.
17. Attempt pursuit approval if permissions and backend prerequisites support it.
18. If backend blocks approval because relationship path, pursuit score, capacity fit, margin fit, or authority is missing, confirm the UI displays the backend error and does not bypass it.
19. Add a capacity requirement.
20. Confirm capacity requirement appears in the Capacity panel.
21. Move opportunity to Pursuing if supported.
22. Move opportunity to Proposal if supported.
23. Move opportunity to Negotiation if supported.
24. Mark opportunity Awarded if supported.
25. Confirm no project was created.
26. Confirm no work order was created.
27. Confirm no contract, settlement, invoice, payment, payroll, or cash record was created.
28. Mark an opportunity Lost with reason if supported.
29. Defer an opportunity with reason and review date if supported.
30. Archive an opportunity if supported.
31. View constraints and recommendations slices.
32. Confirm timeline panel shows unsupported state when no endpoint exists.
33. Confirm audit panel shows unsupported state when no endpoint exists.
34. Confirm Analyze Pursuit placeholder is visible.
35. Confirm unauthorized users cannot see or use actions they lack permission for.

## Pass Criteria

- No API calls by tester.
- No database access by tester.
- No developer intervention.
- Writes go through backend routes and create event/audit/system_action.
- Relationship weakness appears as warning/constraint, not UI blocker.
- Backend pursuit approval blockers are not bypassed.
- Awarded opportunity creates no project, work order, production, contract, settlement, invoice, payment, payroll, or cash record.
- Unsupported backend sections are shown honestly.
- Operator can understand the current status, next action, relationship risk, capacity planning state, and pursuit boundary.

## Known Backend Gaps To Confirm During Test

- `draft` and `pursuit_review` are display concepts only; backend currently starts opportunities at `qualified`.
- Opportunity timeline endpoint is not available.
- Opportunity audit summary endpoint is not available.
- Explicit candidate conversion endpoint is not available.
- Opportunity archive reason is not persisted by the current route.
