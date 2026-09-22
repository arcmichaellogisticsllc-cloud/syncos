# SyncOS field release candidate — September 22, 2026

## Agreed business scope

Both Sync employee crews and external Partner crews must execute work in SyncField. Customer QC/acceptance remains the authority for billable quantities. Completed payments are made externally and recorded with proof until Priority Passport integration is separately configured and verified. Jackson Telcom is absorbed into SyncOS; employee work is not a fictitious subcontractor relationship.

## Implemented

- Explicit internal workforce provider, Sync Foreman role, employee account activation and replacement of unaccepted invitations.
- Management forms at `/internal-workforce`: create crew, link members, assign existing work orders and record expiring field clearance. Only tenant-level Sync management can administer these actions.
- Internal readiness requires reviewed customer authority, qualifications, insurance, equipment inspection and safety evidence; the full active crew and foreman, current map and completed daily JSA remain necessary. Holds and expiration block new production, draft edits and submission.
- Both workforce types use `/field-setup` to select work, upload a customer PDF and assign it to the crew. Replacement maps preserve revision history. Planned span preparation opens with the selected map context.
- Employee production uses the existing customer QC and customer billing chain. Internal providers are rejected from Partner settlement creation.
- External payment entry requires amount in whole cents, completed date, payment method, reference, proof reference and confirmation. A payable lock and request/reference checks prevent concurrent overpayment and duplicate recording. No bank transfer is initiated.
- Payment history preserves internal proof references and exposes only the Partner-safe payment details to that Partner.
- Fixed a field-to-billing integration defect: billables now accept the actual LF, EA and HR field units and rate lookup recognizes their legacy equivalents.
- Project work order and production links open working filtered lists.
- Four background schedulers recover after connection/scan failures.
- Restored export file categories accidentally removed by migration 060; the historical migration also preserves existing export records during an upgrade. Invalid restricted uploads return a validation error, and access-denied screens retain the actual HTTP status.
- Repaired CI test authentication settings and migration commands, and updated the production configuration smoke fixture.
- Release browser testing now includes the dedicated field, QC, financial, Partner, performance and workforce suites previously omitted.

## Verification

Verification takes place in an isolated checkout and synthetic PostgreSQL databases. Existing business databases and files are not migrated or modified. Completed verification:

- Full `npm run release:validate`: passed (all workspace type checks; API, worker and web builds; 110 unit tests; clean database migration/seed verification; security and business smoke tests through accounting export).
- All 64 migrations applied to an empty database. A separate pre-060 fixture with an existing export survived upgrading through 064, with its checksum and classification preserved.
- Employee integration: activation and invalidated old invitation, own-workforce identity, phone-size field screen, management map upload, pre-clearance/JSA blocking, hold blocking of creation and edits, submission, customer acceptance, and HR/LF/EA customer billing. No Partner agreement or payable was created for the employee crew.
- External payment integration: evidence requirement, invalid amount/date rejection, permission denial, concurrent full-balance attempts, idempotent retry, internal proof history and redacted Partner payment history.
- Desktop management and phone-size map forms visually inspected; project work-order and production links verified to send the selected project filter.
- Full `npm run e2e:ci:release`: **682 passed, zero failed, zero skipped** (11.3 minutes). Includes interrupted-connectivity replay, cross-tenant boundaries, Partner onboarding, internal crews, customer QC, exports, finance and operator screens.

All verification used synthetic records and local services. No real payment, customer communication or deployment was performed.

## Operating procedure

1. Confirm the Sync operating organization, customer, project, work order, customer rate schedule and QC authority. Use matching customer production codes and units. Billing recognizes the explicit aliases LF/feet, EA/each and HR/hours, preferring an exact unit match. Field source quantities and units stay unchanged.
2. In Operations → Manage Sync Crews, invite an employee, share the private 24-hour activation link directly, create the crew and link its foreman. Reissuing an unaccepted invitation invalidates its previous link. Existing activated accounts are not reset by this feature.
3. Assign the work order to the crew with scope, work area and customer map reference. In Operations → Assign Field Maps, select that assignment and upload its actual customer PDF.
4. A manager reviews the real evidence package and records clearance through an explicit expiry date. A checked box is a human attestation; the application does not independently validate the truth of external evidence.
5. Foreman signs in to SyncField, selects the assignment, completes the day's safety meeting, records production and submits the day. Customer QC is recorded separately; accepted quantities feed billing.
6. Finance creates and reviews Partner settlements/payables using the existing Partner workflow. After an eligible payment actually completes externally, record it once with its bank/check reference and evidence reference. Reconcile against the history and external statement.

## Rollout boundaries

- This change is a release candidate, not evidence of a live deployment or a completed real-crew pilot.
- Back up the actual PostgreSQL database and restricted/map storage and rehearse restore before applying migrations 061–064 to a real environment. Test both upgrading an existing database and a clean installation.
- Keep `LIVE_AUTOMATED_PARTNER_PAYMENTS=false`. Test-provider submission is rejected in production/staging. No live Passport integration is included.
- Foremen must sign in and load the assignment while connected. Existing offline mutation replay supports interrupted connectivity after loading; cold-start/reload without connectivity is not certified.
- Internal qualification/insurance/equipment review is an expiring human-approved evidence package. The detailed automated Partner credential-review workflow remains separate.
- Employee account activation is included; self-service password recovery and automated employee invitation delivery are not included. Partner invitation delivery uses the existing configured email service.
- Payroll processing remains a separate workflow; employee production does not generate Partner debt.
- Actual deployment still needs the configured domain/TLS, persistent storage, secrets, operational monitoring, backup/restore rehearsal and a real phone/tablet test by a Sync foreman and a Partner foreman. API defaults to localhost; an explicit HOST setting is necessary where container networking requires a different binding.
- No legacy documents are deleted or bulk-imported by this change. Legacy record reconciliation remains subject to the inventory decisions.
