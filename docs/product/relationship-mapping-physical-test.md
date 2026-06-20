# Relationship Mapping Physical UI Test

## Purpose

Validate that an operator can use the Relationship Mapping workspace without API calls, database access, or developer intervention.

## Test Steps

1. Open `/intelligence/relationship-maps`.
2. Confirm Relationship Maps is an active Intelligence navigation item.
3. Create a relationship map for a target organization.
4. Add a target contact if one exists for the organization.
5. Open the Relationship Map Detail page.
6. Create a relationship path.
7. Select a from contact.
8. Select a target contact.
9. Add intermediary contact ids if supported by available data.
10. Set path strength.
11. Set path confidence.
12. Set path rank.
13. Rank the path up or down.
14. Edit the path.
15. Confirm relationship access score is visible.
16. Confirm relationship gaps are visible.
17. Update map status using an allowed backend status.
18. Request introduction when source and target contacts are available.
19. Confirm unsupported strategic access and dormant transitions are not silently performed.
20. Confirm Create Constraint is disabled or permission-aware when direct backend gap-to-constraint support is unavailable.
21. Open the related organization.
22. Open the related contact.
23. Confirm timeline shows an honest unsupported state.
24. Confirm audit shows an honest unsupported state.
25. Confirm the AI relationship analysis placeholder is visible and states no automatic updates occur.
26. Archive the relationship map with a reason in the UI.

## Pass Criteria

- No API calls by tester.
- No database access.
- No developer intervention.
- Permissions are reflected in UI actions.
- Tenant boundaries are enforced by backend APIs.
- Writes use backend routes that create event, audit, and system action records.
- Relationship path strength, confidence, rank, and access score are understandable.
- Unsupported backend relationships are shown honestly.
- User understands the best path and recommended next action.

