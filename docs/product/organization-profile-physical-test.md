# Organization Profile Physical UI Test

## Goal

Validate that an operator can use the Organization workspace as a telecom actor dossier without API calls, database access, or developer intervention.

## Preconditions

- SyncOS API and web app are running.
- Tester has a valid SyncOS JWT.
- Tester has permissions appropriate for organization, contact, signal, candidate, and read-only slice validation.
- Database has the seeded Jackson Telcom tenant and at least one territory.

## Steps

1. Open `/intelligence/organizations`.
2. Paste the JWT into the Session panel and save.
3. Confirm the Organization List loads.
4. Use quick filters for Strategic, Work Creators, Capacity Providers, Missing Contacts, and Needs Research.
5. Open `/intelligence/organizations/new`.
6. Create a realistic telecom actor, for example a utility, ISP/carrier, engineering firm, prime contractor, subcontractor, customer, vendor, or public agency using the approved backend type values.
7. Assign at least one actor role.
8. Assign a territory.
9. Save and confirm navigation to the Organization Profile.
10. Confirm the header shows name, type, actor roles, territory, status, trust, and last updated.
11. Confirm the actor scorecard shows influence, work, capacity, payment, contacts, signals, opportunities, constraints, and next action.
12. Confirm the strategic sidebar shows primary role, secondary roles, missing intelligence, warnings, and best next action.
13. Open Edit Organization.
14. Update type, actor roles, status, relationship owner, trust level, scores, description, or identity fields.
15. Save and confirm the profile reflects the update.
16. Qualify organization if backend requirements are met.
17. Add a contact from the profile.
18. Open the Contacts tab and confirm the new contact appears.
19. Create a signal from the profile.
20. Open the Signals tab and confirm the new signal appears.
21. Create an opportunity candidate from organization context if permissions and required data allow it.
22. Open the Candidates tab and confirm the candidate appears.
23. Open the Opportunities tab and confirm existing tenant-safe related opportunities appear or an honest empty state is shown.
24. Create or view a Capacity Provider actor and confirm the Capacity tab appears.
25. Open Finance for a customer or cash-controller actor and confirm settlements, invoices, and payments appear where available or honest empty states are shown.
26. Open Constraints and Recommendations tabs.
27. Open Learning tab.
28. Open Events and confirm the organization timeline loads.
29. Open Audit as an authorized user and confirm organization audit records load.
30. Open Audit as an unauthorized user and confirm audit details are hidden.
31. Confirm unauthorized or permission-limited users cannot perform hidden/disabled actions.
32. Open Research Organization and confirm the AI research placeholder states that no automatic field updates occur.
33. Archive an organization if authorized, choose an approved archive reason, and confirm actions become limited.

## Pass Criteria

- No API calls by tester.
- No database access.
- No developer intervention.
- Permissions are reflected in visible or disabled actions.
- Tenant boundaries are enforced by the API.
- Writes create backend event, audit log, and system action through existing APIs.
- Actor roles visibly change profile emphasis and conditional tabs.
- Timeline and audit access use backend permissions.
- Unsupported backend relationships are clearly labeled.
- Tester can explain why the organization matters to telecom work.

## Known Limitations To Observe

- Relationship maps remain a placeholder until the Relationship Mapping Workspace is built.
- Some later-module relationship slices may still show partial data where the backend cannot safely infer an organization relationship.
