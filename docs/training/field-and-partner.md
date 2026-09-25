# Partner and Sync crew training

Source baseline: `04b61bc`, with the daily submission feedback repair in this working candidate. Reviewed 2026-09-24. This chapter is **code-reviewed training, not a claim that every step has been observed on a phone or staging**. Browser test results must be read in the release verification report. Screens and available actions depend on server-approved permissions and the selected organization/assignment. An absent action is not a reason to switch to an administrator account.

## Before a supervised session

1. Open the agreed pilot environment and sign in with the participant's own assigned role.
2. Confirm the organization, crew, work order and date with the supervisor. Use approved test records; preserve demo examples.
3. Use separate sessions for Operations, Partner Administrator and Foreman. Sync employee foremen and partner foremen share SyncField screens but have different workforce/readiness authority.
4. Record the phone/browser, route, visible outcome and any failure. Do not include credentials or private files in training evidence.
5. If a form fails, read its message, retain the entered information and correct the stated prerequisite. Do not invent IDs, substitute another organization or repeatedly submit an uncertain payment/production event.

## Route and action inventory

| Route | Actor/purpose | Available interaction |
| --- | --- | --- |
| `/partner/invite/[token]` | Invited Partner Administrator or Foreman | Activate Account; Continue to Partner Onboarding or Continue to SyncField; sign-in link |
| `/activate-employee?token=…` | Invited Sync employee | Activate account; Sign in |
| `/internal-workforce` | Authorized internal Operations | Create activation link, Create crew, Add member, Assign work, Record decision |
| `/field-setup` | Authorized map administrator | Upload and assign map; Prepare planned spans |
| `/syncfield/design-prep` | Authorized internal design preparer | Load Segments; Add Design Segment; Operations |
| `/partner` | Partner Administrator | Dashboard links, Refresh, permitted Acknowledge Notice |
| `/partner/onboarding` | Partner Administrator | Checklist links, Continue, Submit for Sync Review when eligible |
| `/partner/company`, `/partner/compliance` | Partner Administrator | Read company/compliance state; no editing/upload forms here |
| `/partner/workforce`, `/partner/workers`, `/partner/workers/[id]` | Partner Administrator | Read roster and worker detail |
| `/partner/crews`, `/partner/crews/[id]` | Partner Administrator | Read crew readiness and roster |
| `/partner/agreements`, `/partner/agreements/[id]` | Partner Administrator | Read agreement status/detail; no signing/download action in these views |
| `/partner/vehicles` | Partner Administrator | Read assigned equipment/inspection information |
| `/partner/work-orders`, `/partner/work-orders/[id]` | Partner Administrator | Read assigned work-order summary |
| `/partner/mobilization` | Partner Administrator or permitted Foreman | Read readiness/authorization and Acknowledge Notice |
| `/partner/jsa` | Partner Administrator | Read crew JSA status; Foreman persona receives JSA workflow |
| `/partner/production`, `/partner/production/review` | Partner Administrator | Read production; Foreman persona receives production/review workflow |
| `/partner/customer-qc`, `/partner/corrections` | Partner Administrator | Read customer QC/correction instructions |
| `/partner/settlements`, `/partner/payments`, `/partner/performance` | Permitted Partner Administrator | Read organization-safe commercial/performance views; no payment execution |
| `/syncfield/today` | Assigned Sync or partner Foreman | Choose assignment, Open Map, Complete JSA/View Daily JSA, Open Production, permitted notice acknowledgment |
| `/syncfield/crew` | Assigned Foreman | Issue note; Present, Absent, N/A for each worker |
| `/syncfield/workload` | Assigned Foreman | Read scope/map package/vehicle |
| `/syncfield/map` | Assigned Foreman | Page −/+, zoom −/+, Open assigned PDF, zone navigation, Open Production |
| `/syncfield/jsa` | Assigned Foreman | Complete JSA after required controls and certification |
| `/syncfield/production` | Assigned Foreman | Asset, Route / Span, Daily, Save production, Cancel, Save Fiber Span, Mark Complete / Redline, Save Coil / Slack, Review & Submit, Retry Sync |
| `/syncfield/production/review` | Foreman with submission permission | Submit Daily Production, Retry Sync |
| `/syncfield/corrections` | Foreman with resubmission permission | Review correction, Edit correction, Resubmit Correction |
| `/partner/field/today`, `/partner/field/map` | Legacy Partner routes | Redirect directly to `/syncfield/today` and `/syncfield/map`, respectively |

Global Partner/SyncField **Log Out** clears the local authentication context and goes to `/login`. Permission-filtered links are intentionally absent when their required permission is missing.

## 1. Activate a partner account

Prerequisite: a valid invitation supplied through the approved invitation process.

1. Open the private invitation link. Verify **Organization**, **Role**, and **Email**.
2. Enter **Display name**, **Password**, and **Confirm password**. Password length is 12–128 characters.
3. Click **Activate Account** once. Expect **Account Activated**.
4. Click **Continue to Partner Onboarding** for an administrator, or **Continue to SyncField** for a foreman.
5. If the invitation fails to load or is expired, ask the issuer for a replacement. The **Already have access? Sign in** link is for an already activated account.

## 2. Review partner onboarding and readiness

Role: Partner Administrator. This is currently a review-and-submit experience over an existing company package; it is not complete self-service onboarding.

1. Open **Onboarding** (`/partner/onboarding`). Read **Company Approved**, **Crew Ready**, and **Project Mobilization** separately.
2. In **Required order**, click **Company Setup**, **W-9 / Tax Information**, **Payment Setup**, **Insurance**, **Agreements**, **Workers**, **Crews**, **Vehicles / Equipment**, **Safety / Compliance**, or **Capabilities / Territories** to inspect its current state. **Continue** opens the next checklist destination.
3. On **Company**, check business/contact details and **Correction Reason**. On **Compliance**, check **Overall**, **W-9**, **Payment Setup**, insurance expiration/review/correction status and blockers.
4. On **Workers**, select a worker row for role/review information. On **Crews**, select a crew card for staffing/readiness and roster. Check equipment in **Vehicles & Equipment** and agreement execution status in **Agreements**.
5. If the information is missing or incorrect, stop and escalate to the onboarding coordinator. The current destination pages do **not** contain the upload/edit/add controls described by some checklist wording. “Certified P3 submission workflow” text is informational, not a clickable workflow.
6. When the existing required package is ready, return to `/partner/onboarding` and click **Submit for Sync Review**. Expect **Company onboarding submitted for Sync review.** and **Submitted for Sync Review**.
7. A disabled submission button means the package is not eligible. Submission is not company approval, crew readiness, mobilization approval or authorization to start production.

## 3. Prepare Sync employee crews

Role: internal actor holding the relevant worker, crew, assignment and start permissions. Use `/internal-workforce` (**Sync crews**).

1. Under **Invite a Sync employee**, enter **Full name** and **Email**, then **Create activation link**. Give the **Private activation link (expires in 24 hours)** directly to that employee through an approved private channel. This action sends no email; repeating it for an unactivated account replaces the previous link.
2. Employee: open that link, enter **Password (12–128 characters)** and **Confirm password**, click **Activate account**, then **Sign in**. A missing/expired token requires a replacement; refreshing after the token has been removed from the URL can require reopening the original link.
3. Under **Create a crew**, choose **Sync operating organization**, enter **Crew name**, select **Work type** and **Required staffing**, then **Create crew**.
4. Under **Add a crew member**, choose **Crew**, enter **First name**/**Last name**, choose **Role**. For **Foreman**, select **Existing Sync account (required for foreman)**. Click **Add member**. Repeat for the approved roster.
5. Under **Assign work**, choose **Crew** and **Work order**. Enter **Scope**, **Work area**, and **Customer map/package reference**. Click **Assign work**. **Create a work order** opens the separate work-order workflow.
6. Under **Authorize field readiness**, select **Assignment**, choose **Decision** (**Authorize** or **Place on hold**), check the actually verified evidence items, enter **Evidence package reference** and **Valid through**, then **Record decision**.
7. Expect **Saved. Readiness is checked again before production can start.** Confirm the **Assignments** row has the intended clearance and expiration. Readiness approval does not replace the daily JSA or customer QC.

Recovery: each form displays its server error. Missing organization/work-order/account choices require authorized setup upstream. Do not use a partner account to bypass Sync employment requirements.

## 4. Assign the customer map and prepare spans

Role: authorized internal map administrator; crew/work assignment and linked foreman must already exist.

1. From Sync crews click **Upload and assign customer maps**, or open `/field-setup` (**Field map setup**).
2. Select **Work assignment**. Verify company, work-order number and crew together.
3. Enter **Map name**, **Revision**, **Source / customer**. Choose **Customer map PDF** (maximum 15 MB).
4. Click **Upload and assign map**. Expect **Map assigned. The foreman can open it in SyncField; production still requires readiness approval and a completed daily safety meeting.** Confirm **Current maps** says **Map assigned**.
5. Replacement upload creates a new revision. If no foreman is linked, repair crew setup first. If an upload partially fails, check **Current maps** before retrying rather than assuming nothing was saved.
6. Optional: click **Prepare planned spans** for the correct map. This prepopulates **Organization ID** and **Map Version ID** in design prep. Click **Load Segments** to inspect current segments.
7. Enter **Page**, **From Pole / Asset**, **To Pole / Asset**, **Design Footage**, and **Label**, then **Add Design Segment**. Expect **Design segment saved to the selected immutable map version.**

Known design-prep limitation: this screen uses fixed line geometry; it is not an interactive map tracing tool. It also lacks visible request-error handling and an in-flight button guard at this baseline. Do not train users to represent the generated line as a surveyed/customer-traced location. Treat real design preparation as a supervised gap pending repair.

## 5. Start a foreman's day — both workforce types

Prerequisite: active linked foreman, assigned crew/work order/map, and the workforce-specific authorization. Partner work additionally needs the applicable partner mobilization/start state.

1. Open `/syncfield/today` (**Today**). If **Choose today's Crew and Work Order** appears, click the intended work-order/crew button. Every field action and queued offline write belongs to this context.
2. Confirm the assignment strip, project, crew, map and gate messages. A missing assignment must be fixed by the responsible administrator.
3. If **Acknowledge Notice** appears, read the notice and click it. Expect **Notice acknowledgment recorded as receipt only.** Receipt does not grant permission to start work.
4. Open `/syncfield/workload` and confirm assigned scope, map package and vehicle.
5. Open `/syncfield/crew`. Enter an **Issue note** if appropriate, then use the named worker's **Present**, **Absent**, or **N/A** button. Expect **Crew participation updated for today's JSA.** These buttons record daily participation; they do not add/remove roster members.
6. Return to **Today** and choose **Open Map**. Check the map name/revision. Use **Page -**, **Page +**, **-** (Zoom out), **+** (Zoom in), and any configured zone button. **Open assigned PDF** opens the assigned document separately.
7. Production marks are listed as supporting records, not drawn over the original PDF. A PDF-view failure does not prove the map is absent; report the visible error and verify the assignment.

## 6. Complete the daily JSA

1. From **Today**, click **Complete JSA**, or open `/syncfield/jsa`. **View Daily JSA** means a completed or read-only view.
2. Fill **Work Area**, **Weather**, **Site Conditions**, and **Daily Task / Hazard / Procedure Notes** as appropriate.
3. Select **Scope of Work**; add **Other scope** where necessary.
4. Select applicable **Site Hazards** and the required mitigation controls. The screen lists missing required controls; at least one hazard is required.
5. Conduct the crew discussion, then check **I reviewed this JSA with the Crew, confirmed stop-work authority, and certify the site is ready for today's assigned work.**
6. Click **Complete JSA**. Expect **Daily JSA completed.**, completed status and completion time. Acknowledging this does not create production or financial records.
7. If blocked, satisfy the stated requirement honestly. Do not tick unverified safety controls merely to enable a button.

## 7. Record production and construction evidence

Role: assigned Foreman with production-create permission; JSA and start gates satisfied. Open **Open Production** or `/syncfield/production`. Verify **Gate**, **Sync**, **Map Revision**, and **Daily JSA** before entry. Buttons depend on configured production codes.

### Daily labor or asset work

1. Click **Daily** for configured daily labor, or **Asset** for asset work.
2. Enter **Quantity** and **Work notes**. For asset work also choose **Asset type**, and enter **Asset identifier**, **Map page**, **Across page (%)**, **Down page (%)** from actual observed work.
3. Click **Save production**. Expect **Production saved. Review your report before submitting.**, or the explicit saved-on-device message when disconnected.
4. Confirm the record under **Today's Production** and its unit/totals. **Cancel** closes the entry form without saving that entry.

### Fiber span

1. Click **Route / Span** to reach the fiber span form.
2. Fill **From pole**, **To pole**, **Reel / cable**, **Fiber type**, **Sequence start**, **Sequence end**, **Reported footage**, **Map page** and start/end page percentages.
3. Review the sequence calculation; enter **Variance explanation** when required.
4. Click **Save Fiber Span** and confirm the record/totals. Do not treat sequence footage as automatically customer-accepted footage.

### Planned span completion and coil/slack

1. In the planned span form choose **Planned segment**; confirm actual endpoints.
2. Enter **From pole**, **From input tick**, **From output tick**, **To pole**, **To input tick**, **To output tick**, and **Reported footage**.
3. Click **Mark Complete / Redline**. A planned segment is required. Review construction evidence and production; a redline does not overwrite the original map.
4. For coil/slack choose **Pole / asset**, **Easement**, **Coil / slack type**. Enter **Required FT**, **Actual FT**, **Reel / cable**, **Fiber type**, **Rule source**, **Source / notes**, and **Field notes** as applicable.
5. Click **Save Coil / Slack**. An eligible pole observation is needed first; **OTHER** needs field notes. Check **Construction Evidence** and **Daily Totals**.

Evidence limitations: this screen has construction record evidence, but no general photo/file upload button was found. Do not describe a nonexistent camera/upload workflow. Evidence/map/production-code correction requirements remain open where the correction editor cannot express them.

## 8. Synchronize and submit the day

1. Click **Review & Submit**. Verify date, record count, map revision, JSA, totals, production records and **Unsynced Mutations**.
2. If unsynced entries exist, reconnect. Use **Retry Sync** when displayed. Confirm **Synchronized** and zero unsynced entries before submitting. Failed entries remain traceable; read the error and ask a supervisor if authorization/map context changed.
3. Click **Submit Daily Production** once. In the repaired candidate it changes to **Submitting…**, then displays **Daily production submitted. Records are read-only and awaiting customer QC.** The submission button becomes disabled, and the report displays the returned submitted state.
4. If submission fails, the repaired candidate displays an alert and permits retry using the same request identity while that page remains open. Inspect the error; do not create a second report to work around it.
5. Customer QC follows separately. Submitted reported quantity is not yet customer-accepted quantity, a billable item, a partner settlement or payment.

Connectivity acceptance still needs an actual phone. Test an already-loaded session with lost connectivity and its subsequent replay separately from launching the app entirely offline. Do not assume offline map availability or offline cold-start support. Keep the selected crew/work order stable while verifying a queued record.

## 9. Correct failed QC work

Prerequisite: an authorized QC process has issued a correction for this assigned work. The latest business policy permits QC Managers to request correction when work fails QC.

1. Open `/syncfield/corrections`. Read work date, QC cycle/authority, production description, **Customer Instruction**, **Allowed Fields**, and **Due**.
2. For an editable open correction, enter only the requested fields: **Corrected quantity**, **Corrected asset identifier**, **Corrected route endpoint**, and/or **Correction notes**.
3. Click **Review correction**. Read the frozen values and **Review ready. These changes are not sent until you select Resubmit Correction.**
4. Use **Edit correction** to revise, or **Resubmit Correction** to send.
5. Expect **Correction submitted for customer reinspection. The original report is preserved; customer acceptance is still pending.**
6. On error, entries stay in the form for retry. A closed or awaiting-reinspection correction has no editable resubmission form.
7. If the screen says evidence/map changes need a supervisor, escalate. Do not claim the missing evidence requirement has been satisfied by entering a note. Reinspection and acceptance are separate authorized QC actions.

## 10. Partner oversight and financial visibility

Role: Partner Administrator with the relevant read permissions; Foremen must not see these commercial views.

1. Open `/partner` and use **Refresh** to reload the dashboard. Check action cards and crew/work-order status.
2. Use **View Production** for submitted/reported information and **View QC & Corrections** for customer outcomes. Partner administration views do not approve customer QC.
3. Use **View Settlements** and **View Payments** for permitted organization-safe status. Inspect the specific record shown; these are reading paths, not buttons to approve, send or automatically reconcile money.
4. Open **Performance** to review available scores/evidence. Missing snapshots should display empty-state information.
5. Any financial discrepancy is an authorized Finance follow-up. Passport automatic recording remains separately disabled pending its integration and sandbox acceptance.

## 11. Incident reporting boundary

No dedicated incident-report entry route/form was found in the current app source. **Incident reporting reviewed** is a JSA control, and **Issue note** is a daily crew-participation note; neither is a complete incident filing workflow. Follow the company's established incident/escalation procedure and record this missing application capability in pilot feedback. Do not tell trainees to use JSA completion as incident submission.

## Source and verification notes

Reviewed implementation: `apps/web/app/partner/partner-shell.tsx`, all Partner/SyncField route wrappers, `internal-workforce/page.tsx`, `activate-employee/page.tsx`, `partner/invite/[token]/page.tsx`, `field-setup/page.tsx`, and `syncfield/design-prep/page.tsx`.

Existing automated scenario sources inspected: `tests/e2e/syncfield-daily-production.spec.ts`, and references to `internal-workforce.spec.ts`/`syncfield-customer-qc.spec.ts`. This chapter's author did not execute these tests or operate shared data. The updated daily-production browser scenario checks a temporary failed submission, visible retry, reuse of the request identity, successful disabled state, and existing immutable-revision assertions. Its execution result belongs in the parent verification report.

Known source findings requiring follow-up: incomplete partner self-service onboarding destinations; absent incident and general photo-upload workflows; fixed design geometry and missing design-prep request feedback. These gaps are preserved requirements, not permission to narrow the product scope.
