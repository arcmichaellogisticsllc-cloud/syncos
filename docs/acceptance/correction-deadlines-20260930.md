# Prime correction deadline candidate

Local changes only. Shared demo data, staging and payment automation are unchanged.

## Implemented

- Migration 076 adds immutable work-order-version policy revisions with source, approving actor, effective period, triggering event, duration, time zone and explicit holiday calendar.
- Duration supports elapsed hours, calendar days and Monday–Friday business days. Day-based periods preserve local time through DST. No default prime duration or holiday policy is invented.
- Failed customer findings retain their correction even without policy or received-time evidence. Missing prerequisites have explicit statuses. Scheduled corrections retain policy ID, original trigger, due timestamp/local date/zone and the report foreman's identity.
- Late scheduling uses the original event. Policy changes do not reset scheduled deadlines; previously recorded received times cannot be overwritten through this route. Existing historical manual dates remain stored but unverified.
- Policy approval requires both customer-decision permission and an active tenant-scoped operations, project, QC manager or executive role. Field/partner users cannot access internal policy controls. Original source, approval and scheduling changes enter the audit history.
- The customer-QC interface supports policy approval and missing-prerequisite resolution. Partner correction views display deadline status and zone.
- Customer-decision quantity snapshots now use the submitted correction's effective quantity. Operations summaries separate units and exclude summaries, subsets and unreviewed/stale quantities.

## Verification

The initial focused suite passed 11 checks, including DST transitions, elapsed/calendar differences, weekends/holidays, invalid policy inputs, late scheduling, retained deadlines, source quantity review and mixed-unit reporting. All migrations 001–076 passed on a fresh disposable database; upgrading the synthetic acceptance database also passed.

The first browser run identified an ambiguous test status selector when a loading announcement and action confirmation were present together. The targeted rerun passed all 14 partner workflow checks. The final combined run passed all 30 browser/API checks across Sync workforce, partner workforce, field evidence, customer QC and the existing finance path, including the manager policy approval form. The final full regression suite passed all 213 checks with no skips. A prior run was interrupted by a host pause and timeouts; it is not release evidence. The successful rerun used a process-scoped idle-sleep inhibitor without increasing test timeouts. Logs: `/private/tmp/syncos-qc-deadline-e2e-certified.log`, `/private/tmp/syncos-qc-deadline-full-unit-certified.log`.

## Remaining release limits

Current prime policies still require authoritative source confirmation. This policy model does not represent severity-specific durations, custom workweeks, end-of-day cutoff rules or automatic escalation/reminders. Owner reassignment needs a controlled workflow; initial owner is the report foreman. Legacy administrative corrections and reporting rollups need parity review. This candidate is not full seven-gate release approval, physical-phone acceptance or live Passport certification.
