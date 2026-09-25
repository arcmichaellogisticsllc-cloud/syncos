# SyncOS training: demand, operations, quality and oversight

Prepared 2026-09-24 from the local candidate based on `04b61bc`. **Evidence level: code-reviewed training, not a claim that every click has been observed in a browser.** Follow the release verification report for executed tests and approved environment. A locally available route does not establish that staging has the same release.

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
5. If sign-in fails, read the message below Password, correct the entries and retry. Ask the administrator for account recovery; this page has no password-reset, SSO or magic-link workflow.

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
3. Before qualification, independently verify territory, capability, crew count, availability and equipment. Enter the correct **Explicit Partner Organization ID for qualification/invite**, checking it again whenever the selected inquiry changes.
4. Choose **Qualify**, **Future Capacity**, or **Not a Fit** for the supported decision. Important limitation: the current handler submits all five verification flags as true for these decisions, without individual verification controls. Do not click a decision when that would create an inaccurate verification record; report the gap.
5. For a qualified inquiry with the verified organization link, click **Invite Qualified Inquiry**. Confirm the result and the new entry in **Recent invitations**. Qualification/invitation does not approve the company or authorize work.
6. For an approved manual invitation, use **Invite without public inquiry**: fill **Partner company**, **Primary contact name**, **Email** and **Source**, then click **Send Partner Admin Invite** once. Wait for **Manual invitation request complete** and inspect delivery status. Company autofill suggestions must be checked against the intended recipient.
7. In **Recent invitations**, a permitted **Resend** is available for a sent invitation; **Revoke** invalidates the designated invitation. Check the company, email and current status before either action. This list shows only the most recent eight entries.
8. In **Partner readiness and approval**, review checklist status and each missing item. **Approve When Ready** is enabled only for **READY_FOR_REVIEW** and an authorized approver. Click once, then verify the refreshed company state. This approval does not replace crew, work-order, mobilization or daily-safety gates.
9. The recipient continues with the activation/onboarding procedures in the field guide.

Known recovery gaps: the organization-ID field can retain the previous inquiry's value; contact text is cleared even when the save fails; several inquiry actions lack an in-flight click guard. Preserve a failed note before leaving, inspect existing results before retrying invitations, and record these gaps in pilot feedback. These are unresolved UI defects, not certified reliable paths.

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

**Handoff gap:** the coverage UI explicitly reports “No project was created.” There is no `/projects/new` page or project-handoff creation screen in this candidate. A trainer must provide an existing project or separately provision an authorized handoff through the supported operational process. Do not invent a Create Project click to bridge this gap.

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

The `/qc/[id]/edit` page is informational: it explicitly states there is no direct PATCH editing route. Use the lifecycle actions; no Save QC Review workflow is available there. Internal QC is not automatically customer acceptance. Customer-QC daily reports/reinspection are covered in the field guide, including the missing internal decision-entry UI; the general QC review type is not a substitute for that separate daily-report workflow.

## Executive and administrative oversight

Actor: Executive or designated read-authorized operator.

1. Open `/command-center` or `/executive`; review prioritization and permitted drill-throughs. On Command Center, an authorized **Refresh** recalculates the derived snapshot; inspect **As of** and **Refreshed** afterward. This does not change operational approvals. Its current recalculation handler lacks a visible failure/busy state, so an unchanged screen is not confirmation. Follow the target record's workflow to change operational state.
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
- Coverage approval has no project-creation UI handoff.
- Work-order/production forms still require raw IDs for some relationships and structured JSON for some requirements; provide validated training values.
- QC edit is read-only guidance, not a working edit form.
- Real phone/connectivity behavior, every permission/state combination and all external public links require separate observed checks. This document does not establish flawless behavior.

Source review: `apps/web/app/login/page.tsx`; `partner-network/page.tsx`; `partner-performance/page.tsx`; `command-center/page.tsx`; `intelligence/{account-onboarding,organizations,contacts,signals,relationship-maps}`; `opportunities/{candidates,pipeline,coverage,capacity-matching}`; `projects/project-workspace.tsx`; `work-orders/work-order-workspace.tsx`; `production/production-workspace.tsx`; `qc/qc-workspace.tsx`; dashboard center pages; and `docs/product/syncos-operating-model.md`. Paths are relative to the SyncOS checkout.
