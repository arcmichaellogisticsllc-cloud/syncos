# Correction deadline supervision

Use synthetic work on the local acceptance candidate first. This screen has not been deployed to staging. No real prime terms are seeded by this change.

1. Sign in as an authorized QC, project or operations manager with customer-decision permission. Open **Daily report customer QC** and choose the submitted report.
2. Open **Correction deadlines and ownership**. Check existing policy revisions and their source references.
3. Expand **Approve a prime correction policy**. Enter the approved duration, elapsed/calendar/business-day basis, triggering event, IANA time zone, effective period, holiday dates and governing source. Verify the actual policy before checking the confirmation and saving.
4. Calendar and business-day deadlines preserve local clock time. Business days exclude Saturday, Sunday and the explicit holiday list. Policies with different cutoff hours, workweeks or severity rules require additional implementation; do not approximate them here.
5. Record the customer's failed finding with crew-safe instructions and, when known, the original received timestamp including its UTC offset. The correction belongs to the report's foreman. Recording it does not approve production or billing.
6. Confirm the correction shows its responsible owner and calculated deadline. If policy or receipt evidence is missing, the finding remains open and shows the missing prerequisite. Do not treat a historical manual date as a certified deadline.
7. To resolve a missing prerequisite, enter the approved policy, verify the original customer received time, then select **Apply approved deadline policy**. The clock starts from that original event, even when it is already overdue.
8. A retry must preserve the same deadline. A later policy revision must not alter a scheduled correction. Received times and scheduled deadlines cannot be silently overwritten.
9. Sign in as the partner or field user and review the correction. They see the deadline and zone but cannot approve internal deadline policies. Return corrected evidence for review and customer reinspection.

Do not close pilot acceptance until actual prime policy coverage, owner handoffs, escalation behavior and both physical-phone paths are verified. This implementation does not send reminders or external messages.
