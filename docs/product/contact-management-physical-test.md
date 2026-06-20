# Contact Management Physical UI Test

## Goal

Validate that an operator can use the Contact Directory and Contact Detail Workspace without API calls, database access, or developer intervention.

## Preconditions

- SyncOS API and web app are running.
- Tester has a valid SyncOS JWT.
- Tester has contact, organization, signal, candidate, opportunity, constraint, and recommendation read permissions as appropriate.
- Database has at least one tenant organization.

## Steps

1. Open `/intelligence/contacts`.
2. Paste the JWT into the Session panel and save.
3. Confirm the Contact Directory loads.
4. Use quick filters for Needs Verification, Missing Email/Phone, Stale Contacts, No Owner, and Finance Contacts.
5. Open `/intelligence/contacts/new`.
6. Select an organization.
7. Enter full name and title or role description.
8. Add email, phone, mobile, or LinkedIn.
9. Select a contact role and confirm the UI explains that the current backend does not persist contact role yet.
10. Save and confirm navigation to Contact Detail.
11. Confirm the header shows name, title, organization, status, verification status, and last verified.
12. Confirm the scorecard shows influence, decision authority, relationship strength, completeness, related counts, and next action.
13. Open Edit Contact.
14. Update durable contact fields such as title, email, phone, mobile, LinkedIn, or status.
15. Save and confirm Contact Detail reflects the update.
16. Verify the contact.
17. Confirm verification requires at least one contact method, verification method, and source or note in the UI.
18. Confirm verification status and last verified update after successful verification.
19. Open Organization Context and use Open Organization.
20. Open Contact Methods and confirm missing-method warnings are clear.
21. Open Role & Authority and confirm unsupported authority categories are explicitly labeled.
22. Open Relationship Context and confirm the Relationship Mapping placeholder is shown.
23. Open Related Signals.
24. Open Related Candidates.
25. Open Related Opportunities.
26. Confirm Finance Relevance appears only when role data or related finance data is available.
27. Confirm Related Projects appears only when role data or related project data is available.
28. Open Constraints and Recommendations.
29. Open Events and confirm the missing contact timeline endpoint is clearly labeled.
30. Open Audit and confirm the missing contact audit endpoint is clearly labeled.
31. Confirm unauthorized or permission-limited users cannot perform hidden/disabled actions.
32. Confirm the AI Contact Research placeholder is visible and says no automatic field updates occur.
33. Archive a contact if authorized and confirm actions become limited.

## Pass Criteria

- No API calls by tester.
- No database access.
- No developer intervention.
- Permissions are reflected in visible or disabled actions.
- Tenant boundaries are enforced by the API.
- Writes create backend event, audit log, and system action through existing APIs.
- Contact role and authority limitations are understandable.
- Unsupported backend relationships are clearly labeled.
- Tester can explain why the contact matters to telecom work.

## Known Backend Gaps To Observe

- Contact role is not persisted by the backend yet.
- Contact owner is not persisted by the backend yet.
- Influence, decision authority, and relationship strength scores are not persisted yet.
- Contact timeline and audit-summary endpoints are not available yet.
- Contact-specific relationship mapping is deferred.
