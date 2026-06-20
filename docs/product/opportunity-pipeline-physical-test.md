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
15. Confirm missing core fields and missing permissions still block.
16. Move to pursuing, proposal, negotiation, awarded, lost, deferred, and archived where permissions allow.
17. Confirm lost, deferred, archive, and capacity archive reasons are captured.
18. Add and edit a capacity requirement.
19. Archive capacity requirement with reason.
20. Mark an opportunity awarded and confirm no project, work order, contract, settlement, invoice, payment, payroll, or cash record is created.
21. Confirm timeline shows opportunity and capacity events.
22. Confirm audit is visible only to authorized users.
23. Confirm Analyze Pursuit placeholder is visible and performs no live AI automation.

## Pass Criteria

- No direct API calls by tester.
- No database access by tester.
- Permissions are reflected in visible/enabled actions.
- Tenant boundaries are enforced by API.
- Writes create event, event_payload, audit_log, and system_action through backend routes.
- Relationship weakness is a warning/override path, not an acquisition blocker.
- Awarded status creates no downstream execution or finance records.
- Operator understands status, next action, relationship risk, capacity planning state, and pursuit boundary.
