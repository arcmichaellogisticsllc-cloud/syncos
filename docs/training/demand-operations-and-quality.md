# SyncOS training: demand, operations, quality and oversight

Updated 2026-09-25 for the workflow-completion candidate based on `161eeee`. **Evidence level: code-reviewed training, not a claim that every click has been observed in a browser.** Follow the release verification report for executed tests and approved environment. A locally available route does not establish that staging has the same release.

## Before a session

Use a designated training account and training records. Record the user's role, environment, release, test record names and starting states. Preserve existing demo records; use a trainer-approved example before performing any mutation. A button hidden by permission is expected. A disabled lifecycle button means its state/prerequisite must be resolved; do not switch to an administrator merely to bypass a rejection.

For every save or lifecycle action: click once, wait for the response, reopen the record and verify the new state and timeline when available. If a request fails or times out, inspect the saved record before retrying. Closing a dialog cancels unsaved input; it does not reverse an earlier successful operation. Use a separate designated record for archive/void/cancel practice.

Role names below describe the business assignment. Actual access requires the corresponding server permission and tenant scope; sensitive approval actions also require the authorized business role. The role label alone does not prove that a pilot account is provisioned correctly.

## Sign in and workspace routing

Actor: any provisioned user. Prerequisite: active account and known password.

1. Open `/login` in the approved environment.
2. Enter **Email** and **Password**.
3. Click **Sign In** once. While pending it reads **Signing In...**.
4. Confirm the destination matches the authenticated role: internal Operations, Finance or Command Center; Partner Portal for a partner administrator; SyncField for an assigned foreman.
5. If sign-in fails, read the message below Password, correct the entries and retry. Use **Forgot password** and the recovery instructions below when configured delivery is available, or ask the administrator for help. SSO and magic-link login remain future enhancements.

**Become a Partner** and **Become a Sync Partner** lead to the public partner inquiry page. They do not create an approved operational user. Employee and partner invitation activation are covered in the workforce/field guide. Never paste a token or alter browser permissions for ordinary training.

## Read the operational dashboards

Actor: internal user with the relevant dashboard permission.

1. Open `/operations` (**Operations Board**).
2. Review capacity, stop-work and quality indicators.
3. Click **Open Work Orders**, **Review Production**, or **Open QC Queue** to enter the relevant workflow below.
4. **Manage Sync Crews** opens `/internal-workforce`; **Assign Field Maps** opens `/field-setup`. Follow the field guide for those mutations.
5. **Review gap summary** remains on the Operations page; it is not a gap editor.

`/growth` is **Growth Command Center**, a dashboard for demand indicators. `/partner-network`, `/partner-performance` and `/production-dashboard` provide operational summaries and permitted drill-throughs. Treat counters as reports, not approvals. Empty/error states are not proof there are no records: check filters, permissions and the displayed request error.

## Partner inquiries, invitations and onboarding approval

Actor: internal Partner Network operator with separate inquiry, invitation and onboarding permissions. Entry: `/partner-network`. Use approved training recipients; invitation actions can deliver email when the environment has a delivery provider.

1. In **Human qualification queue**, select **Status**, then click the intended company row. Confirm the company/contact in **Inquiry detail**; filtering alone does not select a new company.
2. Use **Assign to Me** to claim ownership. Enter the **Conversation note** field and click **Record Contact** only after the contact actually occurred. Check the completion message and saved context.
3. Before qualification, independently verify territory, capability, crew count, availability and equipment. Choose the named **Partner company for qualification/invite**, checking that it matches the inquiry. If absent, maintain its organization/capacity-provider record first.
4. Under **Checks completed for [company]**, check only the facts you actually verified: territory, capability, crew count, availability, and equipment. Choose **Qualify**, **Future Capacity**, or **Not a Fit**. Unchecked items remain unverified; the decision does not silently check them.
5. For a qualified inquiry with the verified organization link, click **Invite Qualified Inquiry**. Confirm the result and the new entry in **Recent invitations**. Qualification/invitation does not approve the company or authorize work.
6. For an approved manual invitation, use **Invite without public inquiry**: fill **Partner company**, **Primary contact name**, **Email** and **Source**, then click **Send Partner Admin Invite** once. Wait for **Manual invitation request complete** and inspect delivery status. Company autofill suggestions must be checked against the intended recipient.
7. In **Recent invitations**, a permitted **Resend** is available for a sent invitation; **Revoke** invalidates the designated invitation. Check the company, email and current status before either action. This list shows only the most recent eight entries.
8. In **Partner readiness and approval**, review checklist status and each missing item. **Approve When Ready** is enabled only for **READY_FOR_REVIEW** and an authorized approver. Click once, then verify the refreshed company state. This approval does not replace crew, work-order, mobilization or daily-safety gates.
9. The recipient continues with the activation/onboarding procedures in the field guide.

Recovery: switching inquiry resets the organization link and verification controls to that inquiry. Failed conversation saves retain the note; retry after resolving the error. Inquiry actions are locked while a request is in flight. In a partner readiness card, authorized compliance reviewers can open **Review equipment and capability declarations**, read each declaration, choose a review status, enter a response/next action, and **Save review response**. Recording a declaration does not verify capacity, assign equipment, or authorize mobilization.

## Internal partner performance review

Actor: internal user with `partner_performance.read`; recalculation additionally requires `partner_performance.recalculate`. Entry: `/partner-performance`.

1. Read **Executive Ranking** and the partner list.
2. In **Filters**, choose the displayed **Confidence**, **Score Band** and **Recommendation** values, then click **Apply**.
3. Click the intended partner's **Open**. Confirm the partner identity, component scores, capacity horizons, crew performance and critical risks.
4. An authorized operator can click **Recalculate** to refresh derived snapshots. Check the refreshed ranking. This does not award work, change contract/rate terms, or approve payment.
5. If Apply fails, record the displayed error. Current Open/Recalculate handlers lack reliable visible error/busy feedback; do not interpret an unchanged screen as a confirmed successful action. The filter selects also need explicit accessible labels. These issues remain open.

## Organization directory and account onboarding

Actor: Growth/relationship operator with organization read/create/update and separate action permissions.

1. Open `/intelligence/organizations` and search/filter for the company before creating a duplicate.
2. Click **Create Organization**. Fill the identity, organization context and supported fields in the form; click **Save Organization**.
3. Open the organization detail; verify identity and actor roles before using **Qualify**.
4. Use **Add Contact** → enter **Full name**, **Title**, **Email**, **Phone** → **Create Contact** to attach a person.
5. Use **Create Signal** → enter title, summary, category/type, source and evidence context → **Create Signal**. This records intelligence, not work authorization.
6. Use **Create Candidate** to enter an opportunity candidate for this organization; verify the linked organization and evidence.
7. For a capacity-provider organization, use **Add Capacity Provider** (or the **Create Capacity Provider** action in its tab), complete provider information and save. This is not company approval or crew mobilization.
8. Use **Research Organization** to inspect the research view. Do not interpret analysis as independently verified evidence.
9. To retire a designated record: **Archive** → select archive reason, add note → confirm. Verify the archived status.

At `/intelligence/account-onboarding`, choose a stage tab, lane and search text to narrow the work queue. **Reset** restores the Identified stage/all lanes/empty search. **Create Organization** and **Create Candidate** open the forms above. This workbench organizes relationship development; it is distinct from partner compliance onboarding.

Recovery: correct missing required fields in the current form. If a related organization is absent, verify access and that it exists before creating another. Read the returned error on qualification rather than repeatedly clicking.

## Contact maintenance

Actor: relationship operator with the particular `contact.*` permission.

1. Open `/intelligence/contacts`; search and open a contact, or choose **Create Contact**.
2. Select the correct organization and enter the contact's details. Submit **Create Contact**; for changes use **Edit Contact** → **Save Contact**.
3. **Verify Contact** opens a verification dialog; enter the evidence/context requested and submit **Verify Contact**.
4. **Assign Owner** opens ownership assignment; select the intended user and submit **Assign Owner**.
5. Record an actual interaction with **Mark Contacted**, **Mark Engaged**, or **Relationship Active**. Complete the respective dialog and confirm; these actions must reflect real events, not an aspirational pipeline state.
6. Use **Mark Dormant**, **Mark Invalid**, or **Archive** only with a reason appropriate to the contact's condition; verify the changed state.
7. Use organization/record links and permitted tabs to review related records.

Known limitation: **Add to Relationship Map** on this page is a disabled placeholder. Open the actual Relationship Maps workspace for available path editing. Some explanatory text still says relationship mapping is upcoming even though that separate workspace exists.

## Signals to candidates

Actor: Growth user with separate signal and candidate permissions.

1. Open `/intelligence/signals` (`/intelligence` redirects here).
2. Choose **Needs Review**, **High Confidence Unassigned**, **Missing Organization**, **Missing Evidence**, or **Ready for Candidate**, or set individual filters.
3. Use **Review Next Signal** to open the highest-priority available signal in the queue. When the queue is empty it is unavailable.
4. **Create Signal** opens a form. Enter source, title, type/category, organization/territory and supported evidence fields; submit and check the signal detail.
5. On a row, **Categorize**, **Score**, and **Verify** open their own dialogs. Supply the requested values/reasons, confirm and check updated state. These actions update the signal only.
6. **Archive** opens a destructive-boundary dialog; complete it only on an approved training record.
7. Open `/opportunities/candidates`; select **Create Candidate**, enter candidate context, and save.
8. On candidate detail use **Assign Owner** → select owner → **Assign Owner**; **Attach Signal** → select the evidence signal → **Attach Signal**.
9. Use **Link Relationship Map** (or **Change Relationship Map**) → choose the map → **Save Relationship Link**.
10. Use **Score Candidate**, inspect evidence and missing prerequisites, then **Qualify**. For unsuitable records use **Reject** → reason → **Reject Candidate**. For retirement use **Archive** → reason → **Archive Candidate**.
11. **Research Candidate** opens analysis. It does not itself award work or create a project.

Result: a maintained and qualified demand record. Qualification is not customer award, dispatch or payment. If qualification is rejected, resolve the specific evidence/organization requirements first.

## Relationship maps

Actor: relationship operator with map/path creation and status permissions.

1. Open `/intelligence/relationship-maps`; choose **Create Relationship Map**.
2. Enter target organization/contact, map name/type and required context; submit **Create Relationship Map**.
3. Open the map and choose **Add Path**. Enter supported source/target/path context and submit **Create Path**.
4. Review paths; choose **Edit Path** → **Save Path** for changes, **Move Up**/**Move Down** for priority, or **Archive Path** for an obsolete path.
5. Use **Update Status** → select supported status/context → **Update Status**.
6. Use **Request Introduction** → record introduction details → **Set Introduction Requested**. Recording this state does not send an email.
7. Use **Analyze Relationship** to review decision support.
8. **Archive Map** → reason/context → **Archive Map** retires the designated map. Archived maps block lifecycle/path actions.

## Opportunity pursuit pipeline

Actor: Growth/pursuit operator and designated approving roles; each transition requires its own permission.

1. Open `/opportunities/pipeline`. Toggle **Table View**/**Board View** or filter to locate an opportunity.
2. Click **Create Opportunity** (form at `/opportunities/new`), supply the customer and opportunity details, and submit **Create Opportunity**.
3. Open the opportunity. **Edit Opportunity** → **Save Opportunity** updates editable data; it does not substitute for lifecycle transitions.
4. Click **Submit for Pursuit Review**, fill review context, then **Submit for Review**.
5. The authorized approver reads warnings/blockers, then **Approve Pursuit** → required rationale → **Approve Pursuit**.
6. Once approved: **Begin Pursuit** → complete dialog → **Begin Pursuit**.
7. While pursuing: **Move to Proposal** → complete dialog → **Move to Proposal**.
8. At proposal: **Move to Negotiation**. At negotiation, use **Mark Awarded** → award details → **Mark Awarded** only with actual award evidence.
9. Alternative outcomes: **Mark Lost**, **Defer**, or **Archive** → provide the corresponding reason and confirm.
10. **Score Opportunity** refreshes scoring; **Analyze Pursuit** presents analysis. Neither awards work.
11. **Add Capacity Requirement** → enter quantity/unit/territory/dates/type → **Add Capacity Requirement** supplies planning requirements.

Recovery: a disabled transition indicates an incompatible current state or blocked prerequisite. Reopen and check the actual state after any uncertain response. Do not repeat award/creation just because a page took time to refresh.

## Capacity matching and coverage planning

Actor: internal planner with matching read/recalculate and coverage permissions.

1. Open `/opportunities/capacity-matching`.
2. Set **Capability** and **Coverage Status**, then **Apply**.
3. Click a row's **Open**, or enter its **Opportunity ID** and click **Open**.
4. Read **Requirements**, **Recommended Partners**, **Crew Matches**, **Coverage Options**, and **Shortlist**.
5. Authorized users may click **Recalculate** to refresh matching. Wait for completion before another action.
6. If the ID is blank, supply one or open a row. On error read the inline message; retry after confirming the target. For a coverage-load failure use **Try again**. Switching IDs clears old detail to avoid mistaking one opportunity for another.

Recommendations do not assign a partner, reserve a crew or change rates.

For a coverage plan:

1. Open `/opportunities/coverage`; choose **Create Coverage Plan** and link the appropriate opportunity.
2. Complete the plan form and submit **Create Coverage Plan**.
3. Open the plan; **Add Requirement** → fill requirement fields → submit the dialog.
4. **Add Source** → identify the supported coverage source → submit.
5. **Add Gap** → describe gap, severity, ownership and hard-stop context → submit.
6. For an existing gap, **Edit** updates it; **Resolve** records resolution; **Override** is available only where policy allows (not a hard stop); **Archive** retires it with context.
7. **Recalculate** updates readiness. Inspect requirements, sources, economic risks and hard stops.
8. **Approve For Handoff** → review blockers/warnings and provide required rationale → confirm. Verify approval status.
9. Use **Archive Plan** only on an authorized retired record.

Coverage approval alone creates no project. Continue through **Project Handoffs** using the separate review, approval, and planning-project creation steps below.

## Project readiness and lifecycle

Actor: Operations/project manager with project-specific permissions. Prerequisite: existing project.

1. Open `/projects`; filter/search and click the project.
2. **Edit Project** → set planning ownership, scope, dates and requirements → **Save Project**.
3. Review **Readiness**, **Compliance**, **Documentation** and **Constraints** tabs; use **Recalculate Readiness** and confirm its dialog.
4. From planning, click **Mark Ready For Work**. Inspect blockers and supply **Readiness override reason** only when applicable; confirm.
5. From ready-for-work, **Start Project** → complete dialog → confirm.
6. To pause, **Place On Hold** → reason → confirm; after resolution, **Release Hold** → note → confirm.
7. At the proper completed state, use **Complete** and then **Close**, completing the required notes and confirming each separately. **Archive** is retirement, not completion.
8. **Work Orders** tab → **Open project work orders** opens `/work-orders` filtered by project; **Production** → **Open project production** similarly filters production.
9. Inspect **Timeline** and permitted **Audit** after lifecycle changes.

Changing project readiness does not create work orders, field facts or finance records.

## Work order creation, assignment and control

Actor: Operations/project manager with individual `work_order.*` permissions.

1. Open `/work-orders` → **Create Work Order**.
2. Select **Project**; enter **Work Order Name**, **Scope Summary**, **Location Summary**, **Work Type**, **Territory ID**, **Planned Quantity**, and **Unit**. Add the applicable planning dates and coverage context.
3. Submit **Create Work Order** and check the record. Do not guess identifier fields; the trainer must supply verified IDs where this form has no named selector.
4. **Edit Work Order** → revise fields → **Save Work Order** when changes are needed.
5. **Recalculate Readiness**, inspect blockers, then **Mark Ready To Assign** from draft. An override reason must describe a permitted exception, not bypass a hard stop.
6. **Assign Provider/Crew** → choose **Assignment type**, **Assigned organization**, **Assigned provider**, **Assigned crew**, optional equipment and notes → confirm.
7. **Schedule** → **Scheduled start**, **Scheduled end**, **Schedule note** → confirm.
8. **Start** → **Start note** → confirm. Follow field guide separately for maps, mobilization/readiness and daily JSA; assignment alone does not authorize field production.
9. After execution, **Submit** → **Submit note** → confirm; **Start QC Review** → note → confirm.
10. If work fails, **Request Corrections** → **Correction reason** and **Correction note** → confirm. Review actual corrected evidence before approval.
11. **Approve** → **Approval note** and appropriate **Approved quantity** → confirm.
12. **Mark Billable** → **Billable note** and any authorized explanation → confirm. This creates no invoice, settlement or payment.
13. Exceptions: **Place On Hold**/**Release Hold** with reasons; **Cancel** with cancellation reason; **Close** with closeout notes; **Archive** with archive reason. Each is a separate transition on an eligible record.

## Internal production review

Actor: field supervisor/Operations for capture and review; QC for authorized decisions; billing authority for billable readiness. Foreman daily execution uses the field guide instead.

1. Open `/production`; use queue tabs, **Open Corrections**, or authorized **Review Submitted Production**.
2. For an authorized manual entry, **Create Production** → select work order, performer, production type/date, quantity/unit and required notes → **Create Production**.
3. Open the draft, **Edit Production** → correct field-truth values → **Save Production**.
4. **Submit** → complete the submission dialog → confirm. A submitted record may enter **Start Review**.
5. Reviewer inspects evidence/context and quantity; use **Approve**, **Reject**, or **Request Correction**, enter requested quantities/reasons, then confirm.
6. For a QC Manager finding, open the linked review in `/qc` and use **Request Correction** there with a recorded reason. This does not grant the general production-record correction action to QC Managers. A request is not evidence that a crew already corrected the work.
7. After actual correction and review, an authorized user uses **Mark Corrected**; follow subsequent review/approval requirements.
8. **Add Evidence Metadata** records supported evidence metadata. It is not proof that a file was uploaded or a corrected photo/map/code was persisted.
9. **Mark Approved Billable** on the board selects a queue. On an approved record, authorized **Mark Billable** performs the lifecycle action.
10. Use **Void** or **Archive** only on a designated record with the required reason. Check the detail state and timeline.

Claimed quantity, internal approval, customer acceptance and billable quantity are distinct. Customer-accepted quantity controls downstream financial truth. This page's action does not itself create invoices or partner payments.

## QC review workspace

Actor: QC reviewer/manager with each required `qc_review.*` grant. Prerequisite: eligible production and assigned reviewer.

1. Open `/qc`; filter the queue and open an existing review, or **Create QC Review**.
2. Select production and review type; choose the named reviewer (default current reviewer where supported), evidence/location/documentation/production statuses and acceptance context.
3. If needed, select the source QC review. **Advanced review details** exposes structured override reasons; use only an authorized, evidenced exception.
4. Click **Create QC Review** and confirm the created record opens.
5. **Start Review** → complete dialog → confirm.
6. Inspect production/evidence and use **Approve**, **Reject**, or **Request Correction** with the relevant quantity/reason; confirm and check the updated review status.
7. When corrections are verified, **Mark Corrected** → complete dialog → confirm and repeat required review.
8. **Void** and **Archive** require their separate rationale and appropriate record state.

The `/qc/[id]/edit` page is informational: it explicitly states there is no direct PATCH editing route. Use the lifecycle actions; no Save QC Review workflow is available there. Internal QC is not automatically customer acceptance. Customer-QC daily reports/reinspection are covered in the field guide, using the dedicated `/customer-qc` daily-report decision and reinspection screen; the general QC review type is not a substitute for that separate workflow.

## Executive and administrative oversight

Actor: Executive or designated read-authorized operator.

1. Open `/command-center` or `/executive`; review prioritization and permitted drill-throughs. On Command Center, an authorized **Refresh** recalculates the derived snapshot; inspect **As of** and **Refreshed** afterward. This does not change operational approvals. Refresh is guarded while pending, and failures show a retryable message. An unchanged screen is not confirmation. Follow the target record's workflow to change operational state.
2. Open `/constraints-center` (**Constraint Command Center**); inspect **By Type**, **By Severity**, **By Owner**, **By Due Date**, **By Value Impact**, and **Active Constraints**.
3. Open `/recommendations-center` (**Recommendation Inbox**); inspect **Pending Review**, **Approved**, **Deferred**, **Completed**, and **Measured**.
4. Open `/workflows-center` (**Workflow Operations View**); review open/completed instances, open tasks, overdue tasks and escalations.
5. Open `/kpis-center` to review KPI results. A report does not certify source data completeness.

These center pages render report tables; they do not expose general-purpose create/approve/resolve task controls. Recommendation status displays are not clickable approval workflows. There is no general user/role administration screen among the current application routes. Account/role provisioning requires the separately controlled operator process; do not teach a nonexistent Settings → Users action.

## Coverage and known limitations

This chapter covers login, growth/operations dashboards, account-onboarding workbench, partner inquiries/invitations/approval, partner performance, organizations, contacts, signals, relationship maps, candidate/pursuit/coverage/matching, projects, work orders, internal production/QC and oversight centers. Field/partner setup, customer QC, finance and Passport have companion chapters.

Code-review gaps to demonstrate honestly during training:

- Disabled **Create Constraint** placeholders exist in several relationship/candidate/opportunity tabs. A placeholder cannot be counted as an executed workflow.
- Some relationship links offer disabled **Create Relationship Map** despite a separate creation workspace.
- Coverage approval and project creation remain separate explicit actions.
- Work-order/production forms still require raw IDs for some relationships and structured JSON for some requirements; provide validated training values.
- QC edit is read-only guidance, not a working edit form.
- Real phone/connectivity behavior, every permission/state combination and all external public links require separate observed checks. This document does not establish flawless behavior.

Source review: `apps/web/app/login/page.tsx`; `partner-network/page.tsx`; `partner-performance/page.tsx`; `command-center/page.tsx`; `intelligence/{account-onboarding,organizations,contacts,signals,relationship-maps}`; `opportunities/{candidates,pipeline,coverage,capacity-matching}`; `projects/project-workspace.tsx`; `work-orders/work-order-workspace.tsx`; `production/production-workspace.tsx`; `qc/qc-workspace.tsx`; dashboard center pages; and `docs/product/syncos-operating-model.md`. Paths are relative to the SyncOS checkout.

## Production exports and closeout

1. Open `/production-dashboard` with dashboard read permission.
2. In **Production exports and closeout**, choose the named **Submitted daily report** (work order, date and crew).
3. Choose **Export format**: Daily production PDF, Annotated map PDF, Production CSV, or the authorized Closeout status package.
4. Click **Generate export** once. On failure the selection is preserved for retry.
5. After success, click **Download** beside the generated artifact. Download authorization is checked separately.
6. Review reported versus customer-accepted quantities and correction status. A closeout status package does not certify all work complete, approve a report, or create financial records. Partner and foreman history screens expose only their permitted company/crew exports.

## Planned segment preparation

1. In **Field map setup**, choose **Prepare planned spans** for the correct assigned map.
2. Confirm organization, immutable map version and PDF page. Enter from/to assets, footage and label.
3. Enter each measured point as full-page percentages: X from the left, Y from the top. **Add bend point** supports a polyline; **Remove point** removes a bend. No sample coordinates are prefilled.
4. Enter **Source drawing and measurement reference**, then **Add Design Segment**.
5. On failure, correct the issue and retry; inputs are retained. Use **Load Segments** to review the selected map's saved records.

This is measured-coordinate entry, not a drag-to-trace PDF editor or surveyed/GPS geometry.

## Coverage to project handoff

1. Open **Coverage Planning → Project Handoffs**. Only authorized users see this destination.
2. Expand **Create project handoff**. Choose a named approved coverage plan for an awarded opportunity. Select the named operations owner and project manager; enter scope, location, and expected dates. Create the handoff.
3. Choose an existing handoff with **Handoff to review**. Read its blockers, warnings, and recommended next action.
4. Expand **Save handoff details** to correct the operational information. General editing cannot approve a handoff or mark a project created.
5. Review each checklist item against its supporting records. Expand its **Confirm** action, check the acknowledgement yourself, and submit only when verified.
6. Add any missing risk. To resolve an existing risk, provide the resolution evidence and explanation. Required gates cannot be removed or overridden through general editing.
7. **Recalculate readiness**, then **Submit readiness review** with a review note.
8. An authorized approver can **Approve handoff** when no hard blockers remain. Each remaining warning requires its own explicit acceptance explanation. Alternatively, **Reject handoff** with a reason and explanation.
9. A user holding both handoff project-creation and project-creation permissions can **Create planning project** from the approved handoff. Enter the creation note and acknowledge the planning-only boundary.
10. Select **Open created planning project**. The project starts in planning. Work orders, crew mobilization, production authorization, and financial records are separate workflows.

The source coverage and opportunity are linked by the server. The UI does not require raw IDs. Saved states and errors appear in their forms; errors retain entered values. These instructions describe the local candidate, pending release and real-device verification.

## Record constraints and relationship paths — local candidate

1. Open the authorized contact, relationship map, opportunity, or candidate. Select **Create constraint** where available.
2. Enter its category, severity, title and details; review whether it is a hard constraint, then save. The constraint is linked to the record you opened. A constraint does not substitute for a field safety shutdown.
3. If a network error appears, keep the form contents and retry. The same request is protected against duplicate creation. Review success before starting a different constraint.
4. On a contact, select **Add to Relationship Map**, select the existing map and the other contact, and enter the path name/context. Save the proposed path and follow its map link. This does not approve a commercial relationship or award work.

## Recover access — local candidate, email activation required

1. On **Sign in**, select the password-recovery link and enter your own account email.
2. Submit once. The response is deliberately the same whether an account exists. Email recovery must be configured by the deployment owner before it can deliver a link.
3. Open the latest recovery email within 15 minutes. Enter and confirm a new password, then submit. If the link expired or was already used, request another.
4. Sign in again on each device. A successful reset invalidates prior sessions and outstanding recovery links. Users without active organization access cannot use recovery to restore that access.

Delivery retries are bounded. If the email does not arrive, contact the administrator; repeatedly requesting links is rate-limited. These steps do not enable SSO or magic-link login.

## Customer request queue — local candidate

1. Open **Demand → Customer Inquiries** with the assigned inquiry permissions.
2. Under **Record a customer request**, enter the customer, contact email, subject, request details and the source/permission reference. Confirm authorization and select **Record inquiry**.
3. Open the inquiry in **Follow-up queue**. Check possible duplicate matches before creating downstream work.
4. Select the follow-up owner and status. Link an already reviewed opportunity or project when appropriate; qualification requires one of these links. Enter the follow-up, acknowledgment evidence or closure note, then select **Save follow-up**. This records the communication; it sends no email.
5. Use **Attach original** for PDF, JPEG, PNG or WebP originals, up to 5 MiB each and ten per inquiry. **View attachments** lists downloads. Retrying identical file contents does not create a duplicate attachment.
6. If another reviewer changed the inquiry, refresh and reconcile the current version before submitting again. The original request remains preserved.

This is authorized internal intake. Public website submission and automatic acknowledgment delivery are separate activation work.

## Supplemental form templates — local candidate

1. Open **Forms → Supplemental Forms**. Template management, submission and reading are separate permissions.
2. Enter the form name and instructions. Select **Add field**, enter a label, choose the answer type and whether it is required. Choice fields need one choice per line.
3. To show a field conditionally, choose an earlier choice or yes/no field under **When to show this field**, then its matching answer. Save the draft.
4. Review the version's fields, acknowledge approval, and select **Publish version**. A published version cannot be changed. Use **Create revised version** for later changes.
5. Under **Complete a published form**, choose the exact approved version, enter responses and submit. Hidden fields are not submitted; required visible fields must be answered.
6. Open the response under **Submitted records** and select **Download record** to export its original schema and answers.

Supplemental forms do not replace JSA, shutdown, QC, customer acceptance, contract or payment controls. Persisted offline answer drafts and broader field-assignment integration are not yet certified.

## Material and reel reconciliation — local candidate

1. Open **Materials → Material Inventory**. Register the material with its unique reel/lot identifier and fixed unit: feet or each.
2. Register a warehouse or crew custody location. Choose the actual crew for crew locations; both Sync and partner crews can be represented.
3. Record the initial **Receive from supplier** movement with quantity, destination and supplier/document reference.
4. Use **Transfer or return** to move material between custody locations. A transfer cannot exceed the source balance.
5. Record **Installed use** against the work order, or record scrap/unusable offcuts with supporting references. Reusable offcuts remain stock and should be transferred, not written off.
6. Compare **Current stock** with the physical count and review **Work-order material reconciliation**. Physical material usage does not establish accepted production or billing quantities.
7. Only an adjustment-authorized reviewer can use **Approve a count adjustment**. Enter the signed difference from the recorded balance, the count sheet reference and discrepancy explanation. A negative adjustment cannot create negative stock.
8. Review the immutable movement history. Correct discrepancies with a documented new adjustment; do not replace past entries.


## Local candidate: form drafts and historical records

1. In **Supplemental forms**, choose the published version and enter answers. Select **Save answers on this device** before closing. Wait for the device-save confirmation; it is not a submitted record.
2. Reopen with the same account and select the same published version. Choose **Restore saved answers**, review them, then **Submit form** while connected. Drafts expire after seven days and are removed on logout. A different version is not silently substituted.
3. Use the history search and **Load older** controls to reach earlier forms, inquiries and inventory movements. Searches do not change stored records.
4. When an older project, opportunity, crew or work order is absent from a selection list, use its **Find** control, then choose the returned record. Searching alone does not link it.

## Public service requests and follow-up

Available in the local candidate; enable channels deliberately after deployment.

1. Sign in with `customer_inquiry.manage` and open **Customer service inquiries**.
2. Under **Public request channels**, enter a public channel address, customer-facing title and reviewed privacy notice.
3. Choose the follow-up owner, overdue escalation owner and deadline in elapsed hours. Both owners must have current organization-wide inquiry-management access.
4. Select **Enable public submissions**, then **Save channel**. Open **Open request form** to verify the customer page before sharing its address.
5. On the customer page, enter name, email, subject and request details. Confirm permission to process the request and select **Submit request**. Save the receipt reference. No work authorization or confirmation email is implied.
6. If the connection fails, preserve the entries and retry. The same submission reference protects against duplicate inquiry creation.
7. Return to **Follow-up queue**, expand the request and review its owner, deadline and source. Enter follow-up notes and any reviewed project/opportunity link, then **Save follow-up**.
8. If reassigning the owner, a new internal notification is queued. Change the deadline deliberately using the local-time field.
9. Under **Inquiry notification delivery**, search status/kind, load older history, and inspect failures. **Retry failed notification** records who requested the retry. Pending means queued; sent means provider acceptance, not recipient acknowledgment. Disabled delivery leaves the queue intact.
10. Closing or qualifying an inquiry cancels pending follow-up messages at delivery time. Requests never bypass project readiness, field authorization or approved agreements.

Delivery is disabled by default. Staging must use its approved recipient allowlist. No live email was sent during synthetic acceptance.

## Assign a supplemental form to field work

1. With `form.manage`, open **Supplemental forms** and create/review a version.
2. Confirm approval and **Publish version**. Published schemas remain immutable.
3. In the published version's **Assign to field work** section, choose the project/work order/crew assignment and select **Assign this version**.
4. To stop future submissions, select that assignment and **Remove field assignment**. Previously submitted records remain unchanged.
5. Both Sync and partner foremen access only their current authorized assignments in SyncField. Supplemental forms do not replace fixed safety, QC, customer acceptance or financial controls.

## Find older records across workspaces

1. Open **History** in the workspace navigation, or `/record-history`.
2. Select **Record type**. Only types your current tenant-wide role can read appear.
3. Enter a name, reference, status or record ID and click **Search history**. Search applies across that type's available records, not only the visible page.
4. Use **Older matching records** until the desired record appears. Equal creation times do not skip records. **Back to latest** starts the same search again.
5. Click the record title to open its existing authorized detail page. Workflow tasks and instances currently show reference metadata without a dedicated detail link. This history view does not change records or grant approval authority.

## Workflow reminders and escalation delivery

1. Open **My workflow notifications** from `/workflows-center`, or `/workflow-notifications`.
2. Review the task title, deadline, current task state and delivery state. Assignment notices use the assigned person or role. Overdue notices use the task deadline. Escalation notices use the most recent explicitly recorded escalation role; no recipient or deadline is invented.
3. A pending notice is queued. A sent notice means the configured provider accepted the message; it is not proof that the recipient read it. Delivery stays pending while the delivery switch is disabled.
4. An authorized task updater can click **Retry delivery** on their own failed notice. The original attempts remain in the delivery audit. Revoked access, reassignment, changed deadlines and closed tasks are checked again before a send.
5. Use **Older notifications** for history. Follow the relevant work-record process to perform the task. Reading or receiving a reminder never approves safety, customer acceptance or finance.

Provider interruptions can result in repeated emails when the provider cannot confirm the first send. SyncOS prevents duplicate queue entries and retries with a stable delivery reference; email itself is not claimed to be exactly once.
