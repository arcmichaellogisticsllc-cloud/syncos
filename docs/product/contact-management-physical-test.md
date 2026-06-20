# Contact Management Physical UI Test

## Goal

Validate that an operator can use the Contact Directory and Contact Detail Workspace without API calls, database access, or developer intervention.

## Preconditions

- SyncOS API and web app are running.
- Tester has a valid SyncOS JWT.
- Tester has appropriate contact and related read/write permissions.
- Database has at least one tenant organization.

## Steps

1. Open `/intelligence/contacts`.
2. Paste the JWT into the Session panel and save.
3. Confirm the Contact Directory loads.
4. Use quick filters for Needs Verification, Missing Email/Phone, Stale Contacts, No Owner, and Finance Contacts.
5. Open `/intelligence/contacts/new`.
6. Select an organization.
7. Enter full name and title.
8. Select a contact role.
9. Add email, phone, mobile, or LinkedIn.
10. Save and confirm navigation to Contact Detail.
11. Confirm the header shows name, title, organization, status, verification status, and owner.
12. Confirm the scorecard shows influence, decision authority, relationship strength, completeness, related counts, and next action.
13. Open Edit Contact.
14. Update durable contact fields and save.
15. Verify the contact with verification method and source or note.
16. Confirm verification metadata appears in Contact Methods.
17. Assign a contact owner if authorized.
18. Mark Contacted and confirm last contacted updates.
19. Mark Engaged.
20. Mark Relationship Active with optional relationship strength score.
21. Mark Dormant with a reason.
22. Mark Invalid with an approved invalid reason.
23. Open Organization Context and use Open Organization.
24. Open Role & Authority and confirm unsupported authority categories are explicitly labeled.
25. Open Relationship Context and confirm the Relationship Mapping placeholder is shown.
26. Open Related Signals and confirm signal contact links appear where present.
27. Open Related Candidates and Related Opportunities and confirm unsupported contact-specific links are honestly empty.
28. Confirm Finance Relevance appears for AP/Billing/Contract/Economic Buyer roles.
29. Open Constraints and Recommendations.
30. Open Events and confirm contact timeline entries appear when authorized.
31. Open Audit and confirm audit entries appear only for authorized users.
32. Confirm unauthorized or permission-limited users cannot perform hidden/disabled actions.
33. Confirm the AI Contact Research placeholder is visible and says no automatic field updates occur.
34. Archive a contact with an approved archive reason and confirm actions become limited.

## Pass Criteria

- No API calls by tester.
- No database access.
- No developer intervention.
- Permissions are reflected in visible or disabled actions.
- Tenant boundaries are enforced by the API.
- Writes create backend event, audit log, and system action through existing APIs.
- Contact role and authority are understandable.
- Unsupported backend relationships are clearly labeled.
- Tester can explain why the contact matters to telecom work.
