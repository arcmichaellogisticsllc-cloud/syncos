# Partner and Sync crew training

Updated for the workflow-completion candidate based on `161eeee`, reviewed 2026-09-25. This chapter is **code-reviewed training, not a claim that every step has been observed on a phone or staging**. Browser test results must be read in the release verification report. Screens and available actions depend on server-approved permissions and the selected organization/assignment. An absent action is not a reason to switch to an administrator account.

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
| `/partner/company`, `/partner/compliance` | Partner Administrator | Company profile, capability declaration, private compliance submissions, and review state |
| `/partner/workforce`, `/partner/workers`, `/partner/workers/[id]` | Partner Administrator | Add/update workers; submit photos, credentials and review requests; read worker detail |
| `/partner/crews`, `/partner/crews/[id]` | Partner Administrator | Create crews, add members, assign foremen, and inspect readiness |
| `/partner/agreements`, `/partner/agreements/[id]` | Partner Administrator | Read agreement status/detail; no signing/download action in these views |
| `/partner/vehicles` | Partner Administrator | Submit equipment declarations; read assigned equipment/inspection information |
| `/partner/work-orders`, `/partner/work-orders/[id]` | Partner Administrator | Read assigned work-order summary |
| `/partner/mobilization` | Partner Administrator or permitted Foreman | Read readiness/authorization and Acknowledge Notice |
| `/partner/jsa` | Partner Administrator | Read crew JSA status; Foreman persona receives JSA workflow |
| `/partner/production`, `/partner/production/review` | Partner Administrator | Read production; Foreman persona receives production/review workflow |
| `/partner/customer-qc`, `/partner/corrections` | Partner Administrator | Read customer QC/correction instructions |
| `/partner/settlements`, `/partner/payments`, `/partner/performance` | Permitted Partner Administrator | Read organization-safe commercial/performance views; no payment execution |
| `/syncfield/today` | Assigned Sync or partner Foreman | Choose assignment, Open Map, Complete JSA/View Daily JSA, Open Production, report incidents, permitted notice acknowledgment |
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

Role: Partner Administrator. Company, document, worker and crew maintenance is available through the permission-controlled forms described in the Partner self-service setup section below. Equipment and capacity declarations require internal review.

1. Open **Onboarding** (`/partner/onboarding`). Read **Company Approved**, **Crew Ready**, and **Project Mobilization** separately.
2. In **Required order**, click **Company Setup**, **W-9 / Tax Information**, **Payment Setup**, **Insurance**, **Agreements**, **Workers**, **Crews**, **Vehicles / Equipment**, **Safety / Compliance**, or **Capabilities / Territories** to inspect its current state. **Continue** opens the next checklist destination.
3. On **Company**, check business/contact details and **Correction Reason**. On **Compliance**, check **Overall**, **W-9**, **Payment Setup**, insurance expiration/review/correction status and blockers.
4. On **Workers**, select a worker row for role/review information. On **Crews**, select a crew card for staffing/readiness and roster. Check equipment in **Vehicles & Equipment** and agreement execution status in **Agreements**.
5. If information is missing or incorrect, use the authorized company, compliance, worker, and crew forms below. Submit equipment/capability declarations for Sync review; these do not create verified capacity or equipment custody. If a required action is absent, ask the onboarding coordinator to check your access.
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
7. Enter **Page**, **From Pole / Asset**, **To Pole / Asset**, **Design Footage**, and **Label**. Supply the source drawing reference and measured page coordinates for each point: X is the percentage from the left edge; Y is the percentage from the top. Use **Add bend point** when needed.
8. Select **Add Design Segment**. Expect **Design segment saved to the selected immutable map version.** A failure displays an error and retains the inputs; wait for the current request before retrying.

Design preparation now requires explicit measured coordinates instead of fixed sample geometry. It is not an interactive PDF tracing tool or GPS survey tool. Use the assigned source drawing and verified measurements.

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

General photo/file evidence is now available from Review & Submit; use the updated paths below. Construction record evidence remains a separate source.

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
7. For evidence, production-code, and map-location corrections, use the updated correction path below. Reinspection and acceptance remain separate authorized QC actions.

## 10. Partner oversight and financial visibility

Role: Partner Administrator with the relevant read permissions; Foremen must not see these commercial views.

1. Open `/partner` and use **Refresh** to reload the dashboard. Check action cards and crew/work-order status.
2. Use **View Production** for submitted/reported information and **View QC & Corrections** for customer outcomes. Partner administration views do not approve customer QC.
3. Use **View Settlements** and **View Payments** for permitted organization-safe status. Inspect the specific record shown; these are reading paths, not buttons to approve, send or automatically reconcile money.
4. Open **Performance** to review available scores/evidence. Missing snapshots should display empty-state information.
5. Any financial discrepancy is an authorized Finance follow-up. Passport automatic recording remains separately disabled pending its integration and sandbox acceptance.

## Customer-QC decisions, exports and closeout — incomplete UI paths

The daily-report customer-QC screen and production export controls now exist. Follow the updated click paths below. The general `/qc` workbench still represents a separate review model; use its **Daily report customer QC and reinspection** link for report-specific decisions.

## 11. Incident reporting boundary

Use Today → Report an incident or near miss, as described below. **Incident reporting reviewed** remains a JSA control; it is not an incident submission.

## Source and verification notes

Reviewed implementation: `apps/web/app/partner/partner-shell.tsx`, all Partner/SyncField route wrappers, `internal-workforce/page.tsx`, `activate-employee/page.tsx`, `partner/invite/[token]/page.tsx`, `field-setup/page.tsx`, and `syncfield/design-prep/page.tsx`; customer-QC/export route comparison also inspected `apps/api/src/routes/syncfield.controller.ts`.

Existing automated scenario sources inspected: `tests/e2e/syncfield-daily-production.spec.ts`, and references to `internal-workforce.spec.ts`/`syncfield-customer-qc.spec.ts`. This chapter's author did not execute these tests or operate shared data. The updated daily-production browser scenario checks a temporary failed submission, visible retry, reuse of the request identity, successful disabled state, and existing immutable-revision assertions. Its execution result belongs in the parent verification report.

The current candidate adds these operational paths. Real-phone, interrupted-connectivity, role-boundary and end-to-end acceptance remain required before pilot sign-off.

## Updated field evidence, incident and customer-QC paths

These paths are implemented in the current local candidate. Execute the matching pilot test before treating a step as accepted on an actual phone.

### Attach photos or documents
1. Sign in as the assigned foreman (Sync crew or partner crew), select the intended assignment, and open **Review & Submit**.
2. Under **Photos and evidence**, choose **Evidence file**: JPEG, PNG, HEIC, HEIF, PDF, MP4 or MOV, up to 100 MiB in the current local candidate.
3. Describe what it shows, then select **Upload evidence**. Wait for **Evidence saved on the server**.
4. The file appears with its description. **Download [filename]** retrieves the authorized file. Before transmission, the application stores a device copy and its request identifier. If confirmation is lost or you are offline, reconnect, reopen the same report as the same user and select **Retry upload**. The unchanged request is recorded once. **Discard device copy** removes only the pending local copy; keep your original file. Signing out clears local field data.
5. Evidence added after submission is an additional record. It does not overwrite the submitted quantity, accept work, create billing, or replace the original submission.

### Report an incident or near miss
1. From **Today**, confirm the intended assignment and expand **Report an incident or near miss**.
2. Choose the incident type; enter its time, location, description, and immediate action taken.
3. Select **Record incident**. The app first saves a draft on this device. A pending-device message does not mean Sync received it. If disconnected or the response is lost, reconnect as the same user, reopen this assignment and select **Retry incident**. The same request is reused to prevent duplicate records and audit entries. Wait for the server confirmation. Device storage failure is shown explicitly; keep the information and contact the supervisor.
4. Follow the company’s incident-response procedure. For emergencies, contact emergency services and the supervisor immediately; this form does not call or message them.
5. Authorized internal reviewers open **QC → Daily report customer QC and reinspection**. The **Incident queue** includes recent incidents even before a daily report is submitted.

### Record daily-report customer QC
1. Open **QC → Daily report customer QC and reinspection** (`/customer-qc`). This is separate from the general QC workbench.
2. Select **Submitted daily report** by date, project, Work Order and crew. Inspect attached evidence, incident records and correction history.
3. If authorized for completeness review, choose **Confirm completeness**, or enter **Return reason** and choose **Return for completion**. Neither action accepts production.
4. After completeness, enter **Customer source reference** and choose **Open customer inspection cycle**. A correction resubmission automatically creates a reinspection cycle; select that cycle instead of opening a duplicate.
5. Select **Inspection cycle**, then **Production record**. Read reported quantities and any proposed correction revision.
6. Choose **Customer decision**. Accepted/partially accepted decisions require **Customer-accepted quantity**. Other outcomes require the documented **Customer reason**. Enter crew-safe comments/instructions.
7. For correction-required or rejected work, select exactly the **Fields the crew may correct**, then **Record customer decision**.
8. Verify the confirmation and inspection history. The reported submission remains preserved. Customer acceptance is separate from internal completeness and from financial conversion.

### Correct evidence, code, or map position
1. Open **Corrections** and read the customer instruction and allowed fields.
2. When permitted, choose the corrected production code from the authorized Work Order list. For map-location correction, enter the assigned map page and horizontal/vertical position as percentages measured from its top-left corner.
3. If evidence is requested, upload the file under **Photos and evidence**, then select it under **Select evidence for this correction**. A file uploaded elsewhere cannot be substituted.
4. Complete any requested quantity, identifier, endpoint or notes changes. Click **Review correction**, check the entered values, then **Resubmit Correction**.
5. Expect **awaiting customer reinspection**. Changes are recorded in a new immutable proposed revision; the original report remains intact and nothing is automatically customer accepted.

### Generate and download production exports
Partner administrators open **Daily Production** and use **Production exports and closeout**. Choose a submitted report and authorized format, then **Generate export** and **Download**. Foremen see authorized existing downloads in **Review & Submit** history; they do not receive internal generation or financial authority. Internal users use the Production Dashboard’s permission-filtered export controls. Generating a closeout status package does not itself declare all work accepted.

## Partner self-service setup update

Use a Partner Admin account for the company you maintain. The server derives the company; these forms never ask you to select or type an organization ID. Controls appear only for the corresponding granted action. A Foreman account does not receive these controls.

## Company profile
1. Open **Partner Portal → Company**.
2. Expand **Save company profile**.
3. Confirm the legal name, business address, and business, primary, compliance, and settlement contact details.
4. Select **Save company profile**. Wait for **Saved**. On an error, keep the form open, correct the information or retry; entries remain.
5. To make another change, select **Enter another update**.

## Capabilities, territories, and equipment declarations
1. In **Company**, expand **Send capability declaration**. Describe the work capabilities, crew capacity, territories, and availability.
2. For equipment, open **Vehicles & Equipment**, then **Send equipment declaration**. Describe the equipment, ownership, inspection dates, and proposed crew.
3. Submit. The declaration appears in the list with its status. Return here for Sync's response.
4. If Sync requests information, submit a new declaration identifying the earlier request and supplying the requested detail.

A declaration enters internal review. It does not create verified capacity, an equipment custody agreement, a crew assignment, mobilization approval, or authorization to start. Sync reviews declarations through Partner Network and records the canonical capacity/custody records separately.

## Compliance
1. Open **Compliance → Submit W-9**. Enter the legal name, tax classification, identifier type and **last four digits only**, signed date, and choose the signed document. Select **Submit W-9**.
2. Expand **Submit payment enrollment**. Enter the enrollment contact, optional bank display name and account last four digits, and upload supporting documents when available. Submit for review. This does not activate Passport or send payment.
3. Expand **Submit insurance policy**. Choose the policy type; enter carrier, dates, dollar limits, coverage declarations, and endorsement information. Upload the certificate and applicable endorsement. Submit.
4. Select **Enter another update** for each additional required policy type. These submissions return to Sync review; partners cannot verify themselves.

If a document upload loses its confirmation, refresh and inspect the document list before submitting again. These legacy document endpoints do not guarantee server-side duplicate suppression after a lost response. Documents accept PDF, JPEG, PNG, or WebP up to 5 MB. Worker photos accept supported image formats up to 2 MB. Full tax identifiers and bank details belong only in the appropriate private documents, never ordinary form fields.

## Workers and crews
1. Open **Workers → Add worker**. Enter first/last name, work role, and your reference; save.
2. Select the worker under **Worker to maintain**. Use **Save worker details**, **Submit worker photo**, and **Submit worker credential** as applicable. Confirm the photo attestation yourself.
3. Select **Submit worker for review**. Submission does not approve the worker.
4. Open **Crews → Add crew**. Enter the name, type, and target staffing; save.
5. Select the crew under **Crew to maintain**. Use **Add crew member** with the named worker selector. Use **Assign crew foreman** or **Assign alternate foreman** when authorized. Backend readiness and membership restrictions still apply.
6. Return to **Onboarding** to inspect remaining blockers. Complete the required records and select **Submit for Sync review** when available.

Company approval, crew readiness, project mobilization, and authorization to start remain separate gates. The final submit now sends a stable request identifier, allowing safe retry without creating a second company submission.

## Verification boundaries

These steps describe the local candidate. Automated UI tests cover save/failure/retry, visibility for read-only users, and scoped worker creation. API tests cover declaration tenant scope, duplicate retry, internal response, and unchanged compliance readiness. Real-phone acceptance and staging activation remain separate release checks.


## Local candidate: resumable evidence and connection recovery

These instructions apply after the candidate containing migration 097 is activated; they do not describe the older deployed staging build.

1. Open the assigned report and **Photos and evidence**. Choose the original and describe it. Check the capture time, location and category.
2. Select **Upload evidence**. Larger originals upload in parts. A parts-progress message is not final submission confirmation.
3. If disconnected or interrupted, retain the device copy and original. Reconnect using the original account, reopen the report and choose **Retry upload**. Received parts are reused; the server checks the full original before recording evidence.
4. Wait for **Evidence saved on the server**. Customer acceptance and readability review remain separate.
5. If work is stopped or your assignment was removed, contact the supervisor. Retrying does not override these controls. Expired temporary sessions restart from the saved original without authorizing new work.
6. After an online SyncField visit prepares offline recovery, reopening a SyncField route without connectivity shows **SyncField connection recovery**. It displays last-verified assignment labels and supported pending device work for at most one hour, tied to the same session. This screen cannot authorize work or edit maps. Prepared map viewing and new report drafts are described below.
7. Choose **Reconnect and verify access** once connected. Review/retry pending work in its normal workspace. Logging out clears device context and drafts; preserve originals first.

## Assigned supplemental forms and offline answers

1. Sign in as the assigned Sync or partner foreman. Open **Assigned forms** from SyncField navigation.
2. Choose the work assignment, then the published form version. Only versions assigned by an authorized operator appear.
3. Enter answers and select **Save answers on this device** before leaving. A confirmed device save is not a server submission. Drafts expire after seven days and logout removes them.
4. If disconnected after closing the page, reopen SyncField. While the same account's one-hour offline context remains valid, expand **Edit saved form**, revise answers and select **Save edited answers on this device**.
5. Reconnect, open **Assigned forms**, select the same assignment/version and review restored answers. Select **Submit reviewed answers**.
6. If a work stop, removed assignment or expired authorization blocks submission, retain the draft and contact the responsible operator. Do not recreate approvals or choose another crew to bypass the restriction.
7. This saved-form workflow is separate from the prepared map and new daily-report workflow below.

## Crew material use

1. Open **Crew materials** and choose your current work assignment.
2. Review lot/reel identifiers and the balance in your crew's custody.
3. Select the material and classify use as **Installed**, **Scrap** or **Offcut**. Enter quantity, work date, source reference and reason.
4. Select **Record material use**. Work/safety authorization and available stock are checked on the server. Retry unchanged entries after an uncertain connection response.
5. Receipts, transfers and approved count adjustments remain inventory-operator actions. Material use is not accepted production and does not create billable quantities or partner earnings.

## Recover and correct saved offline work

1. While connected, open SyncField with your assigned account. The device keeps an expiring, same-session assignment snapshot.
2. If the app is reopened without connectivity, **SyncField connection recovery** lists saved work. It cannot verify current safety clearance. Contact the supervisor before continuing work.
3. Open **Saved production** to edit a production draft that has never been attempted. Correct its quantity, location labels or notes, then click **Save production edits on this device**. Wait for the saved confirmation before closing the screen.
4. An attempted request is locked against offline edits because the server may already have recorded it. Preserve its reference, reconnect and reconcile it rather than create a replacement.
5. Click **Reconnect and verify access**, then return to Production. Pending and interrupted in-flight entries retry using their original identities. After the automatic retry budget is exhausted, inspect the failure and use **Retry Sync**. Conflicts remain for review. Server authorization, assignment, JSA and work-stop checks still apply.
6. For supplemental forms, use **Edit saved form** in recovery, save, reconnect, choose the same assignment/version, review and submit. Device-saved answers are not accepted work. Unsaved-answer warnings appear before switching assignment or form.
7. In **Assigned forms**, inspect your submitted forms and use **Older submitted forms**. In **Crew materials**, use **Older material use** or **Latest material use**. These views stay within the current assignment, crew and authorized account.

Prepared PDF viewing and new daily-report drafts are available as described below. Actual-phone background suspension and storage-loss acceptance remain separate from browser tests.

If **Record material use** loses its response, the original request is saved before transmission. Reopen **Crew materials**, choose the same assignment and select **Retry saved material use**. The same reference is reused so stock is deducted once. Do not enter a replacement while confirmation is pending. A confirmed validation rejection offers **Correct rejected entries**. Existing recorded movements can be reconciled during a stop; new movements remain blocked. Logout clears local pending requests, so preserve the reference first.


## Prepare maps and create a daily report offline

1. While connected, sign in as the assigned Sync or partner foreman. Visit SyncField so the current account and assignments are verified.
2. Select **Prepare offline work**. For each required assignment, select **Prepare or refresh assignment**. Wait for **Assignment prepared**.
3. Confirm the assignment, preparation time and expiry. Select **Open cached PDF** and check its version. Supported cached originals are PDF files up to 25 MiB, with a 75 MiB total map limit on the device. An unavailable or failed-checksum map is not ready; reconnect and retry preparation. Use **Remove cached map** when storage needs to be freed.
4. Before disconnecting, retain the original photos and confirm applicable safety approvals with the supervisor. A downloaded map is not permission to start or resume work.
5. Reopen SyncField without connectivity. The same verified account can use prepared context for up to one hour. Expand **Create a new report on this device**, enter the work date, weather and daily notes, then select **Save report on this device**. Wait for the saved confirmation.
6. Reopen the screen to verify the draft survived. A never-attempted report can be edited. Expired context requires reconnecting and verifying the same account; switching accounts does not expose its drafts.
7. Reconnect and select **Send or reconcile saved report**. SyncOS rechecks the account, current assignment, map, daily safety requirements and work stops. An uncertain response leaves the original request intact for retry. Do not enter a duplicate replacement.
8. Wait for **Server draft confirmed**. Open **Production** to record quantities and evidence, review completeness and submit. The local report and server draft are not submitted production, internal QC approval or customer acceptance.
9. If the assigned map changed or another report already exists for that assignment and date, keep the original notes and reconcile with the responsible operator. The app does not silently merge or discard them. An attempted request cannot be edited because it may already exist on the server.
10. Signing out clears local recovery data. Preserve originals and reconcile uncertain requests before signing out or clearing browser storage.

## Company forms and material oversight

1. As the authorized partner company administrator, open **Company field oversight** from the company workspace. Internal Sync operators continue to use their authorized Forms and Material Inventory workspaces.
2. Search assignments, choose the work and crew, and use **More assignments** as needed. Review form versions, response counts and **Submitted answers**. **Older answers** reaches earlier records; **Latest / refresh** returns to the latest page.
3. If your account has form-delegation permission, choose another active assignment in your own company and select **Assign this form to selected crew assignment**. Each crew supplies its own answers. Delegation cannot reactivate an operator-disabled assignment or replace individual safety acknowledgments, QC or customer approvals.
4. Review **Crew material custody** and **Material movement history**. These balances describe physical stock, not accepted production or money owed. Use **Older movements** to review earlier custody changes.
5. To report a discrepancy, choose the material and custody location, enter the physical count, supporting count-sheet reference and description, then select **Request material review**. An unchanged retry reuses the same request. Review the resulting status under **Material discrepancies**.
6. The authorized inventory operator opens **Material and reel inventory → Company material review queue**. Review the evidence and custody movements. If stock requires correction, use **Approve a count adjustment**, then copy the resulting movement ID into the discrepancy resolution. Otherwise explicitly confirm that the documented review needs no adjustment. Select **Record resolution**.
7. The company administrator can review the resolution in the same assignment. Reporting a discrepancy does not change stock; resolution does not authorize production or financial acceptance.

## Older records and safety history

1. Open **Record history**, choose the record type and search by its name, reference, status or identifier. Use **Older matching records** and **Back to latest**.
2. For an authorized record, expand **Complete audit activity** or **Complete timeline activity**. Search actions and use **Older actions**. Supported legacy workspaces include the related child records allowed by their existing history permissions. These are recorded events, not a replacement for reviewing the actual evidence.
3. On **Safety reviews and work authorization**, use the older-record controls for personal safety reviews, work-order versions and shutdown authorization history. **Refresh latest safety records** returns to current records. A worker still acknowledges only their own participation.
4. Use **Find work order** when the required order is outside the initial selection list. On **Field map setup**, search assignments and use **More assignments**.
5. In customer QC and corrections, use **Older customer QC and corrections** to reach earlier customer decisions and unresolved corrections. Existing correction and resubmission permissions still apply.
