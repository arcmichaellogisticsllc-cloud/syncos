# Intelligence Signal Physical UI Test

## Purpose

Validate that an operator can use the Intelligence Workspace without API calls, database access, or developer intervention.

## Prerequisites

- SyncOS API is running against a migrated and seeded database.
- SyncOS web app is running.
- Tester has a valid SyncOS bearer token.
- Tester has permissions appropriate to the actions being tested:
  - `signal.read`
  - `signal.create`
  - `signal.categorize`
  - `signal.score`
  - `signal.verify`
  - `signal.archive`
  - `signal_evidence.create`
  - `signal_evidence.archive`
  - `opportunity_candidate.create`
  - `candidate_signal.create`

## Test Steps

1. Open `/intelligence/signals`.
2. Paste the bearer token into Operator Session and apply it.
3. Confirm the Signal Feed loads without direct API or database access.
4. Click Create Signal.
5. Create a realistic Jackson Telcom signal:
   - Title: Broadband funding opportunity near Jackson market
   - Summary: Public funding notice indicates fiber expansion activity.
   - Category: funding
   - Type: broadband_funding
   - Source name: State broadband office
   - Source URL or source note: use the real source under review
   - Territory: select an existing tenant territory if available
   - Related organization: select an existing tenant organization if available
6. Confirm the app navigates to Signal Detail after creation.
7. Return to Signal Feed.
8. Filter by High Confidence.
9. Filter by Missing Evidence.
10. Search by the signal title.
11. Open Signal Detail.
12. Categorize the signal if it is still discovered.
13. Score the signal with a confidence score of at least 60.
14. Add evidence with evidence type `funding_notice` or `source_url`.
15. Attach organization if supported by the current API. If disabled, confirm the UI states that the backend does not expose this action yet.
16. Verify the signal.
17. Confirm the Candidate Readiness checklist is visible.
18. If all checklist items are complete, click Create Opportunity Candidate.
19. Confirm the candidate modal is prefilled from the signal and requires the confirmation statement.
20. Create the candidate.
21. Create a second weak signal or open an existing weak signal.
22. Archive it with an approved reason such as Stale or Insufficient evidence.
23. Return to Signal Feed and confirm filters are still understandable.

## Pass Criteria

- Tester performs the workflow entirely through the UI.
- No API calls are manually issued by the tester.
- No database access is required.
- No developer intervention is required.
- Permissions are reflected in visible or disabled UI actions.
- Backend remains the source of truth for permissions and tenant boundaries.
- Signal writes still create events and audit logs through the existing API.
- The tester can understand the next action for a signal.

## Findings Log

Record any friction with:

- Missing backend field
- Confusing status
- Missing permission
- Error copy
- Navigation issue
- Filter issue
- Candidate readiness issue
