# UI/UX pilot repair

This repair addresses unauthorized action visibility, misleading queue states, preset field writes and incomplete correction interaction found during the September23 UI audit. Existing staging demo data must remain intact; no shared reseed or migration is required.

## Behavior

- Verify identity before mounting protected pages. Missing or failed permission lookup does not substitute development grants. Hide unauthorized navigation, forms and mutation controls; retain server authorization.
- Match lifecycle role authority as well as permission grants. Refresh access when returning to the application; remove revoked actions without resetting unchanged forms.
- Show access and loading failures separately from empty queues. Display queue descriptions from actual counts.
- Replace synthetic one-click field writes with explicit observation forms. Foremen enter quantities, assets and positions before saving. Never preset observed field facts.
- Provide review and resubmission for supported correction fields, retain immutable history and request retry identity. Unsupported correction scope must be explicit and never silently dropped.
- Remove nonfunctional sidebar placeholders, raw QC creation override JSON and unnecessary reviewer identifiers. Correction owners are named choices scoped to the current tenant.
- Dashboard requests use the current user's identity, with the same dashboard permissions as the API. A shared dashboard token is no longer used. Failed requests offer retry without showing zero figures, and login chooses an authorized destination.

## Required verification

Role visibility and direct-route tests, failed/empty queue tests, actual-value field entry and offline replay, correction resubmission and duplicate protection, both workforce types, API authorization, type/build/unit checks, full release and browser regression. Passing prior suites is not evidence for this new behavior.

Staging activation requires fresh database/file backups, verified restoration and unchanged demo inventories. Record exact candidate and actual results in the verification report. Real-phone PDF/position-entry usability and cold-start offline capability remain separate field acceptance checks.
