# Relationship Mapping Physical UI Test

## Purpose

Validate that an operator can use the Relationship Mapping workspace without API calls, database access, or developer intervention.

## Test Steps

1. Open `/intelligence/relationship-maps`.
2. Confirm Relationship Maps is an active Intelligence navigation item.
3. Create a relationship map for a target organization with map type, objective, desired outcome, priority, strategic flag, and due date.
4. Add a target contact if one exists for the organization.
5. Open the Relationship Map Detail page.
6. Confirm owner, priority, due date, objective, desired outcome, backend relationship access score, backend relationship gaps, and backend recommended next action are visible.
7. Create a relationship path with path name, from contact, target contact, strength score, confidence score, rank, summary, and recommended action.
8. Add intermediary contact ids if supported by available data.
9. Rank the path up or down.
10. Edit the path and confirm strength, confidence, risk notes, blocked reason, and summary remain readable.
11. Confirm relationship access score updates from backend-calculated path score.
12. Confirm relationship gaps reflect target/contact/path state.
13. Update map status using the approved backend status route and required reason.
14. Request introduction when source and target contacts are available.
15. Confirm strategic access and dormant appear only through supported backend status behavior.
16. Confirm Create Constraint is disabled or permission-aware when direct backend gap-to-constraint support is unavailable.
17. Open the related organization.
18. Open the related contact.
19. View timeline and confirm map/path events appear when permission allows.
20. View audit as an authorized user and confirm map/path write audit records appear.
21. Confirm an unauthorized user cannot see audit.
22. Confirm the AI relationship analysis placeholder is visible and states no automatic updates occur.
23. Archive a relationship path with a valid reason.
24. Archive the relationship map with a valid reason.

## Pass Criteria

- No API calls by tester.
- No database access.
- No developer intervention.
- Permissions are reflected in UI actions.
- Tenant boundaries are enforced by backend APIs.
- Writes create event, audit, and system action records.
- Relationship path strength, confidence, rank, and access score are understandable.
- Timeline and audit are backend-backed when authorized.
- Unsupported workflow linkage is shown honestly.
- User understands the best path and recommended next action.
