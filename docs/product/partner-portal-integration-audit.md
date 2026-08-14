# SyncOS P0 Partner Portal Integration Audit

## 1. Executive Recommendation

Sync Partner Portal should be built as an organization-scoped external workflow layer inside SyncOS, not as a separate application or duplicated business system. The current repository already has strong internal foundations for tenants, organizations, capacity providers, crews, workers, equipment, compliance documents, projects, work orders, production, QC, billables, settlements, contractor payables, customer cash application, payment execution status, events, audit logs, and workflow tasks. Those objects should be reused.

The repository is not ready for Partner Portal implementation as a direct UI sprint. The missing first-order capabilities are external partner personas, server-enforced organization scope, sensitive file authorization, worker credential structure, vehicle custody/allocation records, daily JSA records, incident records, generated document/e-sign architecture, pay-when-paid eligibility linkage, and mobile/offline field submission support.

Recommendation: GO for a narrow P1 foundation sprint only. NO-GO for building external Partner Portal pages, production submission, payment visibility, or legal document signing until P1 and P2 establish the partner domain, organization-scoped access, external personas, and permission boundaries.

## 2. Repository Snapshot

- branch: `main`
- HEAD commit: `f1e697e03f8fa0448bf6d6e70f71cea896be4e41`
- git status at audit start:
  - `?? docs/product/partner-portal-integration-audit.md`
  - `?? synccommsystems.com/`
- git top-level: `/Users/User/syncos`
- current working directory used for audit: `/Users/User/syncos`
- repository was already dirty: yes. The nested `synccommsystems.com/` public website repository was untracked in the SyncOS root, and the audit document path was already untracked from prior documentation work.
- nested repository handling: `synccommsystems.com/` was not inspected or modified. Repository search outside that folder found no main SyncOS import/dependency on `synccommsystems.com`.
- workspace/package inventory from root `package.json`:
  - `apps/api`
  - `apps/web`
  - `apps/worker`
  - `packages/auth`
  - `packages/database`
  - `packages/events`
  - `packages/permissions`
  - `packages/shared`
  - `packages/ui`
  - `packages/workflows`
- current environment assumptions:
  - Node monorepo using npm workspaces.
  - API is NestJS, web is Next.js, worker is BullMQ.
  - No servers, migrations, tests, builds, seed scripts, installs, or database writes were run for this audit.
- migration inventory inspected in `packages/database/migrations`:
  - `001_tenants_users_roles_permissions.sql`
  - `002_territories_organizations.sql`
  - `003_contacts_relationships.sql`
  - `004_signals_evidence.sql`
  - `005_relationship_maps_paths.sql`
  - `006_opportunity_candidates_opportunities.sql`
  - `007_capacity_providers_crews_workers_equipment.sql`
  - `008_compliance_documents_capacity_records.sql`
  - `009_projects_work_orders_production.sql`
  - `010_contracts_rates_settlements_invoices_payments.sql`
  - `011_constraints_recommendations.sql`
  - `012_events_actions_approvals_audit.sql`
  - `013_workflows_tasks_escalations.sql`
  - `014_kpis_learning.sql`
  - `015_files_file_links.sql`
  - `016_tenant_fk_hardening.sql` through `041_account_onboarding_contract_foundation.sql`

## 3. Current Architecture Inventory

| Domain | Current object/table | Routes/controllers | UI routes | Permissions | Events | Tests | Support classification | Notes |
|---|---|---|---|---|---|---|---|---|
| Tenant/auth | `tenants`, `users`, `tenant_users` in `001_tenants_users_roles_permissions.sql`; JWT claims in `packages/auth/src/index.ts` | `apps/api/src/routes/auth.controller.ts`; guards in `apps/api/src/security/*` | API proxy in `apps/web/app/api/syncos/[...path]/route.ts` | Role/permission joins in `apps/api/src/security/permission.guard.ts` | Audit/write actions available through `packages/shared/src/write-action.ts` | `tests/e2e/fixtures/personas.ts`, `tests/e2e/personas/minimum-personas.spec.ts` | PARTIALLY SUPPORTED | Internal auth exists. External partner login/invite/session model was not found. |
| Roles/permissions | `roles`, `permissions`, `user_roles`, `role_permissions` in `001_tenants_users_roles_permissions.sql` | Global `PermissionGuard` in `apps/api/src/security/permission.guard.ts` | Internal navigation in `apps/web/app/operator-navigation.tsx` | `packages/permissions/src/index.ts` | Write action events | Persona tests | PARTIALLY SUPPORTED | Scope types include `organization`, `project`, and `contractor`, but no Partner Owner/Admin/Foreman permission set exists. |
| Organization | `organizations`, `organization_relationships` in `002_territories_organizations.sql` | `apps/api/src/routes/organizations.controller.ts` | `apps/web/app/intelligence/organizations/organization-workspace.tsx` | `organization.*` | `organization.created`, `organization.updated`, lifecycle events | Route/persona E2E coverage | SUPPORTED | Organization is the correct canonical business object for Partner company identity. |
| Contacts | `contacts` in `003_contacts_relationships.sql` | `apps/api/src/routes/contacts.controller.ts` | `apps/web/app/intelligence/contacts/*` | `contact.*` | Contact write events | Route/persona E2E coverage | PARTIALLY SUPPORTED | Contacts can represent authorized representatives, but signature role, signer authority, and e-sign identity are missing. |
| Account onboarding | `account_onboarding_profiles` in `041_account_onboarding_contract_foundation.sql` | `apps/api/src/routes/account-onboarding.controller.ts` | `apps/web/app/intelligence/account-onboarding/account-onboarding-workbench.tsx` | `account_onboarding.*` | `account_onboarding.created`, `.updated`, `.archived` | Route E2E coverage | PARTIALLY SUPPORTED | Internal onboarding spine exists for contractor/vendor lanes. It explicitly does not create contracts, payables, insurance verification, or external submissions per `docs/product/account-onboarding-backend-contract.md`. |
| Capacity providers | `capacity_providers` in `007_capacity_providers_crews_workers_equipment.sql` | `apps/api/src/routes/capacity.controller.ts` | `apps/web/app/opportunities/coverage/coverage-planning-workspace.tsx` | `capacity_provider.*` | Capacity provider lifecycle events in controller | Route E2E coverage | SUPPORTED | Correct operational extension for Partner capacity. Do not create duplicate Partner company table. |
| Crews/workers/equipment | `crews`, `workers`, `equipment` in `007_capacity_providers_crews_workers_equipment.sql` | `apps/api/src/routes/capacity.controller.ts` | Coverage planning UI references capacity slices | `crew.*`, `worker.*`, `equipment.*` | Crew/worker/equipment write events | Route E2E coverage | PARTIALLY SUPPORTED | Basic records exist. Worker credentials, driver/operator approval, home address, emergency contact, headshot, and vehicle custody are missing. |
| Compliance documents/capacity records | `compliance_documents`, `capacity_records` in `008_compliance_documents_capacity_records.sql` | `apps/api/src/routes/capacity.controller.ts` | Coverage planning UI | `compliance_document.*`, `capacity_record.*` | Compliance document verify/archive events | Route E2E coverage | PARTIALLY SUPPORTED | Document status and expiration exist. Endorsements, coverage limits, restricted file evidence, and verification-only privacy model are missing. |
| Coverage planning | `coverage_plans`, `coverage_requirements`, `coverage_sources`, `coverage_gaps` in `024_coverage_planning_contract_foundation.sql` | Coverage routes in `apps/api/src/routes/coverage.controller.ts` | `apps/web/app/opportunities/coverage/*` | `coverage_*` permissions | Coverage write events | Product docs and route tests | PARTIALLY SUPPORTED | Supports identifying partner workforce/capacity sources before project execution; not an external Partner Portal. |
| Project handoff/readiness | `project_handoffs`, checklist, risk, approval tables in `026_project_handoff_contract_foundation.sql` | `apps/api/src/routes/project-handoffs.controller.ts` | Project handoff UI under opportunities/projects | `project_handoff.*` | Handoff/checklist events | Product docs and route tests | PARTIALLY SUPPORTED | Useful readiness precedent, but Partner mobilization/NTP needs its own assignment gate and blockers. |
| Projects | `projects` in `009_projects_work_orders_production.sql`, hardened by `027_project_backend_contract_hardening.sql` | `apps/api/src/routes/projects.controller.ts` | `apps/web/app/projects/*` | `project.*` | Project write events | Route E2E coverage | PARTIALLY SUPPORTED | Project backbone exists. Partner project assignment visibility and cross-partner isolation are missing. |
| Work orders | `work_orders` in `009`, hardened by `028_work_order_contract_hardening.sql` | `apps/api/src/routes/production.controller.ts` work-order routes | `apps/web/app/work-orders/work-order-workspace.tsx` | `work_order.*` | Work-order lifecycle events | Route E2E and boundary tests | PARTIALLY SUPPORTED | Work-order statuses include assignment, start, QC, corrections, approved, billable, closed. Partner-specific signed WO, one-crew/one-truck validation, and partner-visible rate boundaries are missing. |
| Production/evidence | `production_records`, `production_evidence` in `009`, hardened by `029_production_contract_hardening.sql` | `apps/api/src/routes/production.controller.ts` | `apps/web/app/production/production-workspace.tsx` | `production_record.*`, `production_evidence.*` | Production/evidence events | Boundary and route tests | PARTIALLY SUPPORTED | Production revisions, evidence metadata, GPS, notes, and QC statuses exist. Explicit pole/tick fields, foreman certification, 9 PM/10 AM rules, and offline upload queue are missing. |
| QC/correction | `qc_reviews` in `030_qc_review_contract_foundation.sql`; production correction fields in `029` | `apps/api/src/routes/production.controller.ts` QC routes | `apps/web/app/qc/*` | `qc.*`, `qc_review.*` | QC action events | Boundary tests | PARTIALLY SUPPORTED | QC accept/reject/correction foundation exists. Dedicated corrective action/rework notice workflow and Partner response path are missing. |
| Billables | `billable_items` in `031_billable_contract_foundation.sql` | Billable routes in `apps/api/src/routes/billable-items.controller.ts` and production controller | `apps/web/app/billable/*` | `billable_item.*` | Billable events | Boundary tests | SUPPORTED | Correct boundary between accepted production and customer-chargeable work. |
| Settlements | `settlements`, `settlement_items` in `010`, hardened by `032_settlement_contract_foundation.sql` | `apps/api/src/routes/settlements.controller.ts` | `apps/web/app/settlements/*` | `settlement.*`, `settlement_item.*` | Settlement events | Boundary tests | PARTIALLY SUPPORTED | Settlement foundation exists. Partner statement artifact, dispute window, deemed acceptance, and pay-when-paid funding display are missing. |
| Invoices/customer cash/collections | `invoices`, `invoice_items`, `cash_receipts`, `payment_applications`, collection tables in `033`, `034`, `035` | Invoice, cash, payment application, collections controllers | `apps/web/app/invoices`, `apps/web/app/cash`, `apps/web/app/collections` | `invoice.*`, `cash_receipt.*`, `payment_application.*`, `collection_case.*` | Cash/invoice events | Boundary tests | SUPPORTED | Customer revenue chain exists and must remain separate from Partner payment. |
| Contractor payables | `contractor_payables`, `contractor_payable_items` in `036_contractor_payable_contract_foundation.sql` | `apps/api/src/routes/contractor-payables.controller.ts` | `apps/web/app/contractor-payables/*` | `contractor_payable.*` | Payable events | Boundary tests | PARTIALLY SUPPORTED | Correct Partner payable boundary. Pay-when-paid eligibility linkage to cleared customer funds is missing. |
| Payment execution | `payment_batches`, `payment_items` in `038_payment_execution_contract_foundation.sql` | `apps/api/src/routes/payment-execution.controller.ts` | `apps/web/app/payments/*` | `payment_batch.*`, `payment_item.*` | Payment execution status events | Boundary tests | PARTIALLY SUPPORTED | Status-only payment execution exists. No Priority Passport integration or bank transaction execution was found. |
| Files/documents | `files`, `file_links` in `015_files_file_links.sql` | No material file upload/download controller found in `apps/api/src/routes`; web API proxy is text JSON oriented | Organization docs tab says documents workspace coming later | No file-specific permission keys found | File events through generic write action if routed | No file E2E found | PARTIALLY SUPPORTED | File metadata/linking exists. Sensitive file categories, signed URL authorization, generated document artifacts, signatures, hashes beyond file checksum, and e-sign are missing. |
| Events/audit | `events`, `event_payloads`, `system_actions`, `audit_logs` in `012_events_actions_approvals_audit.sql` | `packages/shared/src/write-action.ts`; `packages/events/src/index.ts` | Timeline/audit panels across internal UIs | Permissioned route actions | Transactional events and audit logs | `tests/regression.test.js` | PARTIALLY SUPPORTED | Good append-only event/audit foundation. Idempotency column exists but current write helper does not set it. |
| Workflows/worker | Workflow tables in `013_workflows_tasks_escalations.sql`; BullMQ worker | `apps/api/src/routes/workflows.controller.ts`; `apps/worker/src/index.ts` | Workflow/admin surfaces | `workflow.*` | Workflow/task events | Regression test | PARTIALLY SUPPORTED | Workflow tables exist. Worker README states only minimal demo health job exists; no Partner business consumers. |
| Web routes/personas/mobile | Internal Next routes under `apps/web/app/*`; personas in `tests/e2e/fixtures/personas.ts` | Next proxy and pages | Internal workspaces only | Internal permissions only | N/A | E2E route/persona matrix | MISSING | No `/partner` route group, no Partner personas, no service worker/offline queue, and no mobile field portal were found. |

## 4. Canonical Partner Domain Decision

- Organization relationship: reuse `organizations` as the legal Partner company record. This is supported by `002_territories_organizations.sql` and `apps/api/src/routes/organizations.controller.ts`.
- capacity-provider relationship: use `capacity_providers.organization_id` from `007_capacity_providers_crews_workers_equipment.sql` as the operational capacity record for subcontractor/crew-provider behavior.
- payable-party decision: use Partner company/capacity provider as payable party through `contractor_payables.capacity_provider_id`, `contractor_payables.payable_party_type`, and `payment_items.payee_type = capacity_provider` in `036_contractor_payable_contract_foundation.sql` and `038_payment_execution_contract_foundation.sql`.
- Worker/crew relationship: reuse `crews.capacity_provider_id`, `workers.capacity_provider_id`, and `workers.crew_id`. Individual Partner workers should not be direct Sync payees in the first release.
- new Partner profile extension: a minimal Organization-linked or CapacityProvider-linked profile extension is likely required for Partner Portal-specific facts that do not belong in the generic organization row: external portal status, two authorized signer contacts, MSA execution state, payment setup status/provider reference, partner lifecycle status, and portal visibility settings. This must be an extension of Organization/capacity provider, not a duplicate Partner company.
- status ownership: do not overload `organizations.status`. Existing organization statuses are relationship intelligence statuses. Partner approval and mobilization need separate state models.

## 5. Document-to-Domain Mapping

| Document | Business facts captured | Canonical SyncOS object(s) | Current support | Gap | Recommended handling | Generated artifact requirement | Signature requirement |
|---|---|---|---|---|---|---|---|
| Master Project Partner Agreement | Legal Partner relationship, governing terms, authorized representatives, effective version | `organizations`, `contacts`, `capacity_providers`, `contracts`, future agreement version/signature records, `files` | PARTIALLY SUPPORTED | No agreement version, signer identity, executed artifact, hash, supersession | Reuse Organization plus CapacityProvider; add agreement/version/signature boundary rather than a generic partner form | Required immutable PDF derived from structured agreement version | Required from two authorized Partner representatives and Sync signer |
| Project Work Order & Rate Schedule | Project scope, work order, crew, truck, project rates, performance target, compensation change controls | `projects`, `work_orders`, `rate_schedules`, `rate_codes`, `capacity_providers`, `crews`, `equipment` | PARTIALLY SUPPORTED | No signed WO artifact, one crew/one truck enforcement, partner-visible rate boundary | Use existing WorkOrder and RateSchedule; add Partner assignment and signature/artifact linkage | Required generated WO/rate artifact | Required by authorized Partner representatives |
| Vehicle & Aerial Equipment Agreement | Vehicle custody, assignment dates, operator authorization, inspection, damages, return, allocation | `equipment`, `work_orders.assigned_equipment_id`, future equipment assignment/custody/inspection records | PARTIALLY SUPPORTED | No vehicle custody, rental allocation, inspection, return, tickets, fuel/toll responsibility fields | Extend equipment assignment/custody rather than create Partner vehicle shadow table | Required generated agreement per project vehicle | Required if vehicle/equipment is assigned |
| Four-Person Crew Personnel & Credential Packet | Crew composition, worker PII, credentials, driver/operator status, foreman, headshots, checks | `crews`, `workers`, `compliance_documents`, `files`, future worker credential records | PARTIALLY SUPPORTED | Worker schema is minimal; no credential/PII/restricted evidence model | Reuse Crew/Worker; add reusable worker credential/profile tables and restricted file links | Generated packet optional; structured data is primary | Partner admin certification may be required; worker signatures not required initially unless business decides |
| Daily JSA / Tailgate Safety Form | Crew/date/location, hazards, controls, acknowledgments, foreman completion before work | Future `jsa`/safety record, `projects`, `work_orders`, `crews`, `workers`, `production_records` | MISSING | Only safety note/evidence metadata exists in production | Create first-class JSA/safety record tied to work order/date/crew; do not store only uploaded PDF | Generated daily artifact optional; retained record required | Foreman certification and crew acknowledgment required |
| Daily Production & Acceptance Report | Start/stop, footage, tick marks, poles, photos, damages, blocked access, certification, QC relationship | `production_records`, `production_evidence`, `qc_reviews`, `billable_items` | PARTIALLY SUPPORTED | Missing explicit tick/pole fields, due-time rules, certification, offline/idempotent submission | Extend production schema/workflow; preserve revisions through existing parent/revision model | Generated report optional; immutable accepted revision required | Foreman certification required |
| Weekly Partner Settlement Statement | Accepted quantities, rates, vehicle allocation, deductions, retainage, funding status, dispute window | `settlements`, `settlement_items`, `contractor_payables`, `contractor_payable_items`, `payment_applications`, `files` | PARTIALLY SUPPORTED | No Partner statement artifact, no funding eligibility/pro-rata linkage, no 10-day deemed acceptance | Generate statement from Settlement and Payable records; add funding status projection and dispute window | Required immutable weekly statement | Partner acknowledgment optional; dispute/no-response rules required |
| Incident / Damage / Near-Miss Report | Injury, near miss, damage, utility strike, customer complaint, safety/data event, evidence | Future safety incident/issue/claim records, `production_evidence`, `files`, corrective actions | MISSING | No incident/damage/near-miss domain object found | Add incident record tied to tenant/org/project/work order/crew/evidence | Generated incident report required after submission | Foreman/submitter certification required |
| Corrective Action / Rework Notice | QC finding, affected production, hold, correction task, reinspection, backcharge | `qc_reviews`, `production_records`, `workflow_tasks`, future correction task if needed | PARTIALLY SUPPORTED | No dedicated Partner correction response/rework notice artifact | Reuse QC and production correction states; add correction task only if workflow task cannot carry domain facts | Generated notice useful for legal/operational trace | Partner acknowledgment recommended |
| Partner Mobilization Checklist / Notice to Proceed | Readiness checks, blockers, override, approval to mobilize, authorization to produce | `project_handoffs`, checklist items, `work_orders`, future partner assignment/readiness evaluation | PARTIALLY SUPPORTED | No Partner mobilization engine or NTP/production-start separation | Create readiness evaluation model that reads canonical objects and produces auditable decisions | Required NTP artifact when approved | Sync approval signature/authorization required |
| Partner W-9 & Payment Setup | Tax profile, W-9 artifact, settlement contact, payment profile, provider reference | `organizations`, `compliance_documents`, future payment profile, `contractor_payables` | PARTIALLY SUPPORTED | No payment provider reference/token model; W-9 file access restrictions missing | Store verification status and safe provider metadata, not full banking details in ordinary tables | W-9 artifact retained as restricted file | Partner signer/admin certification required |
| Partner Insurance & COI Compliance Checklist | Policies, coverage, endorsements, expiration, verification, suspension blockers | `compliance_documents`, `capacity_records` | PARTIALLY SUPPORTED | No structured coverage limits/endorsement flags/additional insured/waiver/primary fields | Extend insurance compliance profile linked to compliance document and capacity provider | COI artifact retained as restricted file | No e-sign; verifier audit required |
| Project Completion / Crew Release & Closeout | Final production/docs, open corrections, equipment return, claims, retainage, warranty | `work_orders`, `projects`, `contractor_payables`, `settlements`, future equipment return/closeout record | PARTIALLY SUPPORTED | Equipment/property/access return and warranty/surviving obligations not fully modeled | Use WorkOrder closeout as anchor plus assignment closeout extension | Generated closeout/release artifact recommended | Sync closeout approval required; Partner acknowledgment optional |
| Partner Performance Evaluation / Scorecard | Production, acceptance, safety, documentation, reliability, conduct, compliance | `kpis`, `learning`, `capacity_records`, future partner performance snapshot | PARTIALLY SUPPORTED | No internal Partner scorecard object or visibility boundary | Build internal-only performance snapshot from canonical metrics | Generated internal PDF optional, not Partner-visible by default | No Partner signature |

## 6. Partner Lifecycle and State Machines

- Organization: use a Partner-specific status on the Partner/capacity profile, not `organizations.status`. Proposed states: `prospect`, `applicant`, `qualifying`, `approved`, `conditional`, `suspended`, `rejected`. Transitions require Partner Operations or Site Admin. Events should map to existing capacity/account onboarding events where possible and add Partner-specific events only for missing domain meaning. Reversibility: `suspended` can return to `approved`; `rejected` requires privileged re-open.
- Crew: proposed states: `draft`, `pending_credentials`, `approved`, `conditional`, `suspended`, `inactive`. Preconditions include active Partner Organization, required worker records, approved foreman, driver/operator status, and credentials. Actor: Partner Admin submits, Partner Operations/Safety verifies. Reversibility: approval can be suspended; credential expiry moves to conditional or suspended.
- Assignment/mobilization: proposed states: `draft`, `pending_documents`, `readiness_blocked`, `ready`, `approved_to_mobilize`, `mobilized`, `authorized_to_produce`, `active`, `hold`, `closeout`, `completed`, `removed`. Actor: Project Manager/Partner Operations/Safety/Finance depending on blocker. Approval to mobilize and authorization to produce must be separate.
- Work Order: map to existing `work_orders.status` from `028_work_order_contract_hardening.sql`: `draft`, `ready_to_assign`, `assigned`, `scheduled`, `in_progress`, `submitted`, `qc_review`, `corrections_required`, `approved`, `billable`, `closed`, `on_hold`, `cancelled`, `archived`. Do not invent duplicate Partner Work Order statuses.
- Production: map to existing `production_records.status` in `029_production_contract_hardening.sql`: `draft`, `submitted`, `under_review`, `accepted`, `correction_required`, `rejected`, `voided`, with existing `corrected`, `qc_review`, `approved`, `billable`, `archived` retained for internal flow. Partner cannot alter accepted production after approval.
- QC/correction: use `qc_reviews` plus production correction fields. Proposed correction states: `open`, `acknowledged`, `in_progress`, `resubmitted`, `accepted`, `failed`, `reassigned`, `closed`. Existing workflow tasks may handle task assignment, but affected production and reinspection should remain tied to QC/production records.
- Settlement: map to existing settlement statuses in `010_contracts_rates_settlements_invoices_payments.sql` and `032_settlement_contract_foundation.sql`: draft/internal review/customer review/approved/disputed/void/archive style states. Partner statement visibility is a view of settlement plus payable/funding, not a new settlement ledger.
- Contractor Payable: map to `contractor_payables` and `contractor_payable_items` in `036_contractor_payable_contract_foundation.sql`: created/held/disputed/approved/payment-ready/payment-created-later style states. Add pay-when-paid eligibility without turning payable into payment.
- Payment: map to `payment_batches` and `payment_items` in `038_payment_execution_contract_foundation.sql`. Existing model is status-only. Actual payment provider execution remains an integration boundary.
- Closeout: use WorkOrder close/Project close where applicable, plus assignment closeout extension for Partner-specific open corrections, equipment return, retainage, claims, warranty, and surviving obligations.
- Transition requirements: every state transition should identify actor, permission, preconditions, event, audit log, downstream effect, override rules, and reversibility. Existing `executeWriteAction` in `packages/shared/src/write-action.ts` provides a transaction pattern for event plus audit logging.

## 7. Mobilization Readiness Engine

- checks:
  - active Organization and CapacityProvider
  - executed MSA
  - signed Work Order and rate schedule
  - W-9 submitted and verified
  - payment setup status and safe provider reference
  - current insurance and required endorsements
  - approved four-person crew
  - approved foreman
  - approved drivers/operators
  - required worker credentials
  - assigned vehicle/equipment
  - vehicle inspection/compliance
  - project map/work package
  - safety/orientation requirements
  - customer credentials when applicable
- blockers:
  - inactive/suspended Partner
  - unsigned agreement or Work Order
  - expired insurance
  - missing W-9/payment setup
  - unapproved crew/foreman/driver/operator
  - missing vehicle assignment/inspection
  - missing work package or hard-stop customer requirement
- warnings:
  - upcoming insurance or credential expiration
  - incomplete optional documents
  - conditional approval
  - open non-blocking project risks
- overrides:
  - must be permissioned, reasoned, auditable, and preferably time-limited.
  - `project_handoff_checklist_items` in `026_project_handoff_contract_foundation.sql` already has `hard_stop`, `override_allowed`, and override reason fields. Reuse this pattern for Partner readiness.
- permissions:
  - Partner Admin may submit documents and view blockers.
  - Partner Foreman may view crew/work-order readiness relevant to field start.
  - Partner Operations/Safety/Finance/Project Manager may verify their own requirement categories.
  - Site Admin may override only with reason and expiration.
- audit behavior:
  - each evaluation should write a readiness snapshot event and audit log when status changes.
  - sensitive blocker details should be redacted for Partner users where the underlying evidence is restricted.
- recommended evaluation model:
  - store readiness evaluation output as a derived snapshot with `status`, `passed_requirements`, `blocking_requirements`, `warnings`, `override_status`, `override_reason`, `override_actor`, `override_expires_at`, and `evaluated_at`.
  - canonical facts stay on source objects. Readiness snapshots cache results and are recalculated after relevant events.

## 8. Data Model Gap Analysis

| Proposed object or field | Existing model to reuse | Minimal extension | Why new object is or is not required | Ownership of business fact | Versioning/immutability requirement | Migration risk |
|---|---|---|---|---|---|---|
| Partner company | `organizations`, `capacity_providers` | None for company identity | New Partner company table would duplicate Organization | Organization owns legal identity; CapacityProvider owns operational capacity | Organization changes auditable | Low |
| Partner lifecycle/profile | `capacity_providers`, `account_onboarding_profiles` | One Organization/CapacityProvider-linked Partner profile or status extension | Existing org/capacity statuses do not exactly model approved Partner lifecycle | Partner profile/capacity provider | Status transition audit required | Medium |
| Partner user organization scope | `tenant_users`, `user_roles.scope_type`, `PermissionGuard` | Server-side partner scope resolver and external role set | Header-supplied scope is not sufficient for external isolation | Auth/permissions layer | Audit all sensitive access | Medium-high |
| Authorized representatives | `contacts` | Signer role/authority fields or agreement signer records | Contacts exist, but signing authority is document-specific | Agreement/signature record | Immutable after execution | Medium |
| Agreement versions/signatures | `contracts`, `files`, `file_links` | Agreement version, signature request, signer, executed artifact records | File metadata alone cannot represent legal status | Agreement domain | Executed artifacts immutable with hash | Medium |
| Worker profile and credentials | `workers`, `compliance_documents`, `files` | Worker credential/profile tables with restricted fields | Worker record is too minimal for crew packet facts | Worker owns reusable identity; credential owns verification | Credential versions and expiry audit | Medium-high |
| Four-person crew approval | `crews`, `workers` | Crew readiness status/checks | Crew status alone cannot represent credential gate | Crew readiness snapshot | Recalculate from worker credentials | Medium |
| Vehicle assignment/custody | `equipment`, `work_orders.assigned_equipment_id` | Equipment assignment, inspection, custody, return, allocation records | WorkOrder assigned equipment does not cover custody or rental allocation | Equipment assignment | Inspection/return records immutable after approval | Medium |
| Daily JSA | `production_evidence` safety form type | First-class JSA/safety record | Uploaded safety form alone is not enough for before-work gate and acknowledgments | JSA owns daily safety acknowledgment | Submitted JSA immutable; corrections versioned | Medium |
| Incident/damage/near-miss | Production notes/evidence | Safety incident/issue/claim record | Existing notes are unsafe for required reporting/legal flow | Incident owns event facts and evidence | Incident revisions/audit required | Medium |
| Daily production fields | `production_records`, `production_evidence` | Pole/tick/certification/due-time fields | Existing location/GPS fields partially cover field facts | Production record owns performed work; QC owns acceptance | Revisions already partly supported | Medium |
| Correction task/rework notice | `qc_reviews`, `production_records`, `workflow_tasks` | Domain correction task only if workflow task cannot hold required facts | QC owns finding; task owns assignment/response | QC/correction domain | Preserve affected production history | Medium |
| Settlement statement artifact | `settlements`, `settlement_items`, `contractor_payables`, `files` | Statement artifact/version/dispute fields | Settlement is financial approval, not the PDF statement | Settlement owns amounts; artifact owns rendered statement | Statement immutable after issuance | Medium |
| Pay-when-paid eligibility | `cash_receipts`, `payment_applications`, `contractor_payables` | Funding eligibility/allocation link between customer funds and payable items | Existing models preserve boundaries but do not link pro-rata eligibility | Funding eligibility projection owns derived payable eligibility | Recalculated from payment applications; audit changes | High |
| Partner payment profile | `contractor_payables`, payment execution | Provider reference/status/last4 metadata | Full banking data should not be stored in ordinary app tables | Payment profile owns safe metadata | Provider updates auditable | High |
| File sensitivity/access | `files`, `file_links` | File category, sensitivity, entity authorization, signed URL/access audit | Generic file metadata is not sufficient for PII/COI/W-9 | File security layer | Access events append-only | High |
| Partner performance scorecard | `kpis`, `learning`, `capacity_records`, production/QC/safety data | Internal partner performance snapshot | Existing metrics do not represent internal-only Partner scorecard | Performance snapshot | Snapshot immutable per period | Medium |

## 9. API and Route Gap Analysis

- internal API capabilities:
  - Internal CRUD/action routes exist for organizations, contacts, account onboarding, capacity providers, crews, workers, equipment, compliance documents, coverage planning, project handoffs, projects, work orders, production/evidence, QC, billables, settlements, invoices, cash receipts, payment applications, collections, contractor payables, payment execution, workflows, and dashboards.
  - These are all permission-gated through global guards in `apps/api/src/modules/app.module.ts`.
- Partner-facing API capabilities:
  - MISSING. No external Partner route group was found under `apps/api/src/routes`.
  - No server-side external organization-scope resolver was found.
  - No Partner Owner/Admin/Foreman persona endpoints were found.
- route group recommendation:
  - API: add a future `/partner/*` or `/portal/partner/*` route group only after P1/P2. It should read/write canonical SyncOS objects through scoped services, not Partner-specific shadow tables.
  - Web: add a future `apps/web/app/partner/*` route group after permissions and scoping exist.
  - Internal management can remain in existing internal route groups with additional Partner Operations pages only where needed.
- do not create routes in this sprint:
  - This audit created no routes and recommends no implementation in P0.

## 10. Partner Portal UI Map

- current reusable UI patterns:
  - Internal workspace shells under `apps/web/app/*`.
  - Operator navigation permission filtering in `apps/web/app/operator-navigation.tsx`.
  - Existing workspaces for account onboarding, coverage, projects, work orders, production, QC, billables, settlements, contractor payables, payments, and dashboards.
- proposed Partner pages:
  - Partner dashboard: readiness blockers, assigned work orders, current production status, settlement/payment status.
  - Company profile: Organization and authorized representatives.
  - Compliance: W-9, payment setup status, insurance status, credentials.
  - Crews/workers: crew packet, reusable worker records, credential status.
  - Agreements: MSA, Work Orders, vehicle agreements, executed artifacts.
  - Work orders: assigned scope, maps/work packages, vehicle assignment, NTP.
  - Field daily: JSA, production submission, evidence, incident, correction response.
  - Settlements: weekly statements, dispute window, funding/payment eligibility.
  - Closeout: open corrections, vehicle return, retainage, claims, final status.
- internal management pages:
  - Partner Operations dashboard.
  - Partner compliance review.
  - Mobilization readiness review.
  - Partner settlement/funding review.
  - Internal performance scorecard.
- mobile field pages:
  - JSA before work.
  - Production and photo/evidence capture.
  - Incident reporting.
  - Correction response.
- visibility rules:
  - Partner users only see their own Organization, assigned Projects/Work Orders, their crews/workers, their documents, their settlement/payment status, and their closeout status.
  - Partner users must not see customer rates, Sync internal margin, internal rate schedules, executive finance data, acquisition/intelligence pipelines, other tenants, other Partners, or internal scorecard details.
- no UI implementation:
  - No UI files were created or changed in this sprint.

## 11. Permission and Persona Matrix

Current architecture supports tenant roles and scoped permissions through `001_tenants_users_roles_permissions.sql`, `packages/permissions/src/index.ts`, and `apps/api/src/security/permission.guard.ts`. It does not yet define Partner Owner/Admin or Partner Foreman permission keys.

| Action | Site Admin | Executive | Partner Ops / Capacity Manager | Project Manager | QC / Assurance | Safety | Finance | Collections / Accounting | Partner Owner / Admin | Partner Foreman | Partner Worker | Current support |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| view own Partner Organization | Allow | Read | Allow | Read assigned | Deny unless assigned | Read compliance | Read payable setup | Deny unless needed | Own org only | Own org limited | Not first release | PARTIALLY SUPPORTED |
| edit Partner profile | Allow | Deny | Allow | Deny | Deny | Deny | Payment fields only | Deny | Own draft/submitted fields | Deny | Deny | PARTIALLY SUPPORTED |
| upload W-9 | Allow | Deny | Verify | Deny | Deny | Deny | Verify | Deny | Submit | Deny | Deny | PARTIALLY SUPPORTED |
| manage payment profile | Allow | Deny | View status | Deny | Deny | Deny | Verify/manage | Accounting status | Submit safe setup | Deny | Deny | MISSING |
| upload insurance | Allow | Deny | Verify | Deny | Deny | Verify safety-related | View | Deny | Submit | Deny | Deny | PARTIALLY SUPPORTED |
| view insurance status | Allow | Read | Allow | Read assigned | Read assigned | Allow | Read | Deny | Own status | Own status | Deny | PARTIALLY SUPPORTED |
| create/manage crews | Allow | Deny | Allow/approve | Read assigned | Deny | Read safety | Deny | Deny | Own draft/submit | Read own crew | Deny | PARTIALLY SUPPORTED |
| create/manage workers | Allow | Deny | Allow/approve | Read assigned | Deny | Verify safety fields | Deny | Deny | Own workers | Read own crew limited | Deny | PARTIALLY SUPPORTED |
| upload credentials | Allow | Deny | Verify | Deny | Deny | Verify | Deny | Deny | Submit | Submit assigned if allowed | Deny | MISSING |
| assign foreman | Allow | Deny | Approve | Read assigned | Deny | Verify | Deny | Deny | Nominate | Deny | Deny | MISSING |
| view Work Orders | Allow | Read | Allow | Allow assigned | Read assigned | Read assigned | Read financial | Read financial | Own assigned only | Own assigned only | Not first release | PARTIALLY SUPPORTED |
| sign agreements | Site signer | Deny | Prepare | Deny | Deny | Deny | Deny | Deny | Authorized reps only | Deny | Deny | MISSING |
| view assigned vehicle | Allow | Read | Allow | Allow assigned | Deny | Safety read | Finance read | Deny | Own assignment | Own assignment | Deny | PARTIALLY SUPPORTED |
| complete JSA | Deny | Deny | Review | Read | Read | Review | Deny | Deny | View own | Submit/ certify | Acknowledge only if accounts are added | MISSING |
| submit production | Deny | Deny | Review | Review | Review | Read safety | Deny | Deny | View own | Submit/certify | Not first release | PARTIALLY SUPPORTED |
| upload evidence | Allow | Deny | Review | Review | Review | Review safety | Deny | Deny | Own assigned | Own assigned | Not first release | PARTIALLY SUPPORTED |
| submit incident | Allow | Read restricted | Review | Review assigned | Review if QC impact | Own/review | Deny | Deny | Submit/view own | Submit/view own | Not first release | MISSING |
| respond to correction | Allow | Deny | Review | Review | Issue/accept | Review if safety | Deny | Deny | Own assigned | Submit response | Deny | PARTIALLY SUPPORTED |
| view own settlement | Allow | Read summary | Review | Read project | Deny | Deny | Allow | Accounting | Own settlement only | Deny or summary | Deny | PARTIALLY SUPPORTED |
| dispute settlement | Allow | Deny | Review | Read | Deny | Deny | Manage | Accounting | Own settlement dispute | Deny | Deny | PARTIALLY SUPPORTED |
| view payment status | Allow | Executive summary | Read | Deny | Deny | Deny | Allow | Allow | Own payment status only | Deny | Deny | PARTIALLY SUPPORTED |
| view closeout status | Allow | Read | Allow | Allow assigned | QC status | Safety status | Financial status | Financial status | Own assigned | Own assigned | Deny | PARTIALLY SUPPORTED |
| approve Partner | Allow | Approve if authorized | Allow | Deny | Deny | Compliance input | Finance input | Deny | Deny | Deny | Deny | PARTIALLY SUPPORTED |
| verify compliance | Allow | Deny | Allow | Deny | Deny | Safety docs | W-9/payment | Deny | Deny | Deny | Deny | PARTIALLY SUPPORTED |
| approve mobilization | Allow | Deny | Allow | Allow assigned | QC input | Safety input | Finance blockers | Deny | Deny | Deny | Deny | MISSING |
| authorize production start | Allow | Deny | Allow | Allow assigned | Deny | Safety gate input | Deny | Deny | Deny | Deny | Deny | MISSING |
| accept/reject production | Allow | Deny | Deny | Review | Allow | Safety hold only | Deny | Deny | Deny | Deny | Deny | PARTIALLY SUPPORTED |
| issue correction | Allow | Deny | Deny | Request | Allow | Safety correction | Deny | Deny | Deny | Deny | Deny | PARTIALLY SUPPORTED |
| approve settlement | Allow | Executive read | Deny | Review | Deny | Deny | Allow | Accounting review | Deny | Deny | Deny | SUPPORTED |
| approve Contractor Payable | Allow | Executive read | Deny | Review | Deny | Deny | Allow | Accounting review | Deny | Deny | Deny | PARTIALLY SUPPORTED |
| issue payment | Allow | Executive read | Deny | Deny | Deny | Deny | Allow | Accounting execute/status | Deny | Deny | Deny | PARTIALLY SUPPORTED |
| view internal margin | Allow | Allow | Deny unless explicit | Deny unless explicit | Deny | Deny | Allow | Accounting read | Deny | Deny | Deny | SUPPORTED internally; must restrict externally |
| view customer rate | Allow | Allow | Deny unless explicit | Deny unless explicit | Deny | Deny | Allow | Accounting read | Deny | Deny | Deny | SUPPORTED internally; must restrict externally |
| view internal Partner scorecard | Allow | Allow | Allow | Limited | Limited | Limited | Deny | Deny | Deny by default | Deny | Deny | MISSING |

## 12. Event and Workflow Map

| Required event | Existing equivalent | Existing producer | Existing consumer | Missing producer/consumer | Recommended payload and requirements |
|---|---|---|---|---|
| `partner.application.created` | `account_onboarding.created` | `account-onboarding.controller.ts` | Audit/timeline only | Partner portal producer missing | tenant, organization, capacity_provider, actor, idempotency key |
| `partner.approved` | Capacity/account onboarding approval/activation events | Capacity/account onboarding controllers | Audit/timeline only | Partner lifecycle consumer missing | tenant, organization, capacity_provider, approval status |
| `partner.suspended` | Capacity provider suspend event | `capacity.controller.ts` | Audit/timeline only | Partner portal visibility consumer missing | tenant, organization, reason, effective date |
| `compliance.document.submitted` | Compliance document created/updated | `capacity.controller.ts` | Audit/timeline only | External upload producer missing | tenant, organization, capacity_provider, document type, expires_at, file_id if any |
| `compliance.document.verified` | Compliance document verify | `capacity.controller.ts` | Audit/timeline only | Readiness recalculation consumer missing | verifier, status, expiration, blockers cleared |
| `compliance.document.expired` | No scheduled consumer found | None found | None found | Worker job missing | document id, expiration, affected readiness |
| `agreement.generated` | None found | None found | None found | Document generation missing | structured object id, template version, artifact id |
| `agreement.executed` | None found | None found | None found | E-sign integration missing | signer ids, timestamp, artifact hash, agreement version |
| `work_order.activated` | Work order schedule/start/in progress events | `production.controller.ts` | Audit/timeline only | Partner NTP/portal consumer missing | work_order, project, partner org, actor |
| `crew.created` | Crew create event | `capacity.controller.ts` | Audit/timeline only | Readiness recalculation consumer missing | capacity_provider, crew, status |
| `crew.readiness.changed` | None found | None found | None found | Readiness engine missing | crew, passed/blockers/warnings |
| `worker.credential.expiring` | None found | None found | None found | Worker job missing | worker, credential, expires_at, severity |
| `vehicle.assigned` | Work order assigned equipment partially | `production.controller.ts` work-order assign | Audit/timeline only | Equipment custody consumer missing | equipment, crew, work_order, assignment dates |
| `vehicle.returned` | None found | None found | None found | Equipment return workflow missing | equipment, condition, damages, return timestamp |
| `mobilization.readiness.changed` | Project handoff readiness pattern only | Project handoff routes | Audit/timeline only | Partner readiness producer missing | assignment, status, blockers, override |
| `mobilization.approved` | Handoff approval pattern only | Project handoff routes | Audit/timeline only | Partner mobilization producer missing | assignment, approver, blocker snapshot |
| `production_start.authorized` | Work order start event partially | `production.controller.ts` | Audit/timeline only | Separate authorization gate missing | work_order, authorized_by, NTP artifact |
| `jsa.completed` | None found | None found | None found | JSA producer missing | date, crew, work_order, hazards, acknowledgments |
| `production.submitted` | Production submit event | `production.controller.ts` | Audit/timeline only | Partner producer/offline idempotency missing | production, submitted_by, client_uuid, certification |
| `production.accepted` | Production/QC accept events | `production.controller.ts` | Audit/timeline only | Settlement/billable consumer should be explicit | accepted quantity, QC reviewer, revision |
| `production.correction_required` | Correction-required action | `production.controller.ts` | Audit/timeline only | Partner notification consumer missing | affected quantities, due date, reason |
| `correction.resubmitted` | Mark corrected partially | `production.controller.ts` | Audit/timeline only | Partner correction response producer missing | correction task, production revision, evidence |
| `incident.reported` | None found | None found | None found | Incident object missing | incident type, severity, project/work order, evidence |
| `settlement.generated` | Settlement create/recalculate/internal review | `settlements.controller.ts` | Audit/timeline only | Partner statement artifact producer missing | settlement, statement period, artifact |
| `settlement.accepted` | Settlement approve/resolve states | `settlements.controller.ts` | Audit/timeline only | Partner dispute-window consumer missing | settlement, accepted_by/deemed, timestamp |
| `settlement.disputed` | Settlement dispute route | `settlements.controller.ts` | Audit/timeline only | Partner dispute producer missing | settlement, reason, submitted_by |
| `customer_funds.applied` | Payment application create/apply | Cash/payment application routes | Audit/timeline only | Payable eligibility consumer missing | cash_receipt, payment_application, invoice, amount |
| `contractor_payable.eligible` | No explicit equivalent | None found | None found | Pay-when-paid engine missing | payable item, eligible amount, source customer funds |
| `contractor_payable.approved` | Contractor payable approve | `contractor-payables.controller.ts` | Audit/timeline only | Funding consumer missing | payable, approval, hold status |
| `partner.payment.issued` | Payment batch/item status events | `payment-execution.controller.ts` | Audit/timeline only | Provider execution missing | payment item, provider ref, status |
| `assignment.closeout.completed` | Work order close partially | `production.controller.ts` | Audit/timeline only | Partner assignment closeout missing | assignment, open items, equipment return |
| `partner.performance.updated` | KPI/learning only | KPI/learning routes | Dashboards | Partner scorecard producer missing | period, score inputs, internal visibility |

Event conventions: existing write actions should use `executeWriteAction` so event, payload, system action, and audit log are committed together. Idempotency should use the `events.idempotency_key` column from `012_events_actions_approvals_audit.sql`, especially for offline/mobile production and evidence submissions.

## 13. Financial Boundary Analysis

- Production: `production_records` records what was performed. It must not become billable or payable without QC and billable/settlement steps.
- QC: `qc_reviews` and production QC status decide accepted, rejected, or correction-required quantities.
- Billable: `billable_items` in `031_billable_contract_foundation.sql` preserve customer-chargeable status after QC. Partner users should not see customer billing rates.
- Settlement: `settlements` and `settlement_items` approve financial commitments and support customer/prime review/dispute states. Settlement is not payment.
- Contractor Payable: `contractor_payables` and `contractor_payable_items` represent approved money-out obligations to the Partner company/capacity provider. Contractor Payable is not payment.
- Customer cash: `cash_receipts` and `payment_applications` in `034_cash_application_contract_foundation.sql` record customer money received and applied. These are not Partner payments.
- Partner payment: `payment_batches` and `payment_items` in `038_payment_execution_contract_foundation.sql` represent payment execution status. Actual bank/provider execution is not implemented.
- retainage: settlement and payable models have retainage fields. Retainage should remain a holdback/eligibility concept until released.
- deductions: settlement/payable item types include deductions, chargebacks, corrections, and adjustments. These should be canonical financial facts, not PDF-only notes.
- disputes: settlement/payable models include dispute states. Partner dispute window/deemed acceptance still needs Partner-facing workflow fields.
- pay-when-paid linkage:
  - Current models support the two chains but do not explicitly connect cleared customer funds to pro-rata Partner payment eligibility.
  - Add an eligibility projection/allocation linking `payment_applications` to `contractor_payable_items` or equivalent. This projection should derive eligible amounts without collapsing customer cash into Partner payment.
- Priority Passport boundary:
  - No Priority Passport implementation was found in inspected files.
  - Priority Passport should not be accounting system of record. Store only safe metadata such as provider reference, setup status, last four where appropriate, and payment status callbacks.

## 14. Document Generation and E-Sign Architecture

- structured data:
  - Canonical facts must remain on Organization, CapacityProvider, Contact, WorkOrder, RateSchedule, EquipmentAssignment, Crew, Worker, ComplianceDocument, Production, QC, Settlement, ContractorPayable, and Payment records.
- template version:
  - MISSING. No document template/version model was found.
- generated PDF:
  - PARTIALLY SUPPORTED only by `files`/`file_links` metadata in `015_files_file_links.sql`.
  - No generated document route/service was found.
- signature workflow:
  - MISSING. No e-sign request, signer identity, signer role, signed timestamp, signature status, or vendor integration was found.
- immutable artifact:
  - MISSING as a document concept. `files.checksum` can support integrity, but there is no executed artifact model or supersession chain.
- audit trail:
  - PARTIALLY SUPPORTED through `audit_logs` and `events`.
- required principle:
  - Structured object -> template version -> generated document -> signature request -> executed immutable artifact -> canonical object status transition.
- vendor:
  - Do not select a vendor in P0. If no e-sign system exists, define an integration boundary that can support signer identity, signer role, signed timestamp, full audit evidence, immutable artifact hash, superseded versions, and file access authorization.

## 15. Security, Privacy, and Tenancy Analysis

- cross-tenant isolation: PARTIALLY SUPPORTED. Tenant IDs and global guards exist, and migration `016_tenant_fk_hardening.sql` hardens tenant foreign keys. This still needs external Partner route tests.
- cross-Partner isolation inside a tenant: PARTIALLY SUPPORTED. `user_roles.scope_type` supports organization/project/contractor scopes, but Partner-specific server-side scope enforcement was not found.
- organization-scoped access: PARTIALLY SUPPORTED. `PermissionGuard` accepts scoped headers, but external users must not be trusted to choose scope through headers.
- sensitive worker PII: MISSING. Worker schema lacks home address, driver license, emergency contact, background/drug status, and restricted evidence.
- driver license data: MISSING. Should be restricted fields with verification status and limited display.
- home address data: MISSING. Should be restricted and hidden from most internal roles.
- emergency contacts: MISSING. Should be restricted to safety/authorized operations roles.
- headshots: MISSING. Store as restricted file category with controlled downloads.
- background-check evidence: MISSING. Prefer status/reference and restricted evidence, not broad report storage.
- drug-screen evidence: MISSING. Prefer verification status and restricted evidence.
- W-9/EIN data: PARTIALLY SUPPORTED as compliance document type, but restricted file and tax field handling are missing.
- insurance documents: PARTIALLY SUPPORTED as compliance document type; structured coverage/endorsement fields are missing.
- banking/payment-provider references: MISSING. Do not store full banking details in normal app tables.
- signed agreements: MISSING as immutable signed artifacts.
- project/customer confidential information: PARTIALLY SUPPORTED internally; Partner-specific filtering is missing.
- private-property photos: PARTIALLY SUPPORTED as production evidence metadata; file access authorization is missing.
- access credentials and file URLs: MISSING. Existing `production_evidence.file_url`/`source_url` fields can be unsafe if exposed directly.
- audit logging: PARTIALLY SUPPORTED through `audit_logs`; sensitive file access audit is missing.
- data retention: UNSAFE TO INFER. No retention policy implementation was found.
- file-download authorization: MISSING. No material file download/signed URL controller was found.
- recommendation:
  - Add restricted file categories for W-9, COI, signed agreements, driver license, background check, drug screen, headshot, incident evidence, and private-property photos.
  - Add redaction/display rules for Partner, foreman, internal ops, finance, safety, and site admin views.
  - Add audit events for sensitive field and file access.

## 16. Offline / Mobile Readiness Analysis

- Daily JSA: MISSING. No first-class JSA object, no offline draft/submit queue, and no before-production gate were found.
- Daily Production: PARTIALLY SUPPORTED. Production routes and UI exist, but field/mobile and offline guarantees are missing.
- photo/evidence upload: PARTIALLY SUPPORTED. Evidence metadata exists, but binary upload, compression, queueing, retry, and signed file access were not found.
- Incident reporting: MISSING. No incident domain object or mobile flow found.
- Correction response: PARTIALLY SUPPORTED. QC/production correction states exist, but Partner response/offline workflow is missing.
- existing PWA/offline capability: MISSING. No service worker/offline queue/IndexedDB submission system was found in the inspected web app.
- draft support: PARTIALLY SUPPORTED in production statuses, but browser offline drafts are missing.
- retry behavior: MISSING.
- upload queueing: MISSING.
- idempotent submissions: PARTIALLY SUPPORTED at database event schema level through `events.idempotency_key`, but current write helper does not populate idempotency.
- duplicate prevention: PARTIALLY SUPPORTED for server transactions; missing client submission UUIDs for offline.
- timestamp handling: PARTIALLY SUPPORTED through production/evidence timestamps.
- GPS/location support: PARTIALLY SUPPORTED through production/evidence latitude/longitude fields.
- photo compression: MISSING.
- poor-connectivity behavior: MISSING.
- conflict resolution: MISSING.
- foreman certification: MISSING.

## 17. Reporting and Performance Architecture

- Partner dashboard:
  - Should source readiness from readiness snapshots, assigned work from WorkOrders, compliance from ComplianceDocuments/CapacityRecords, production from Production/QC/Billable, settlements from Settlements/ContractorPayables, and payment status from PaymentItems.
  - No Partner dashboard exists.
- internal dashboard:
  - Existing dashboard routes and web pages exist under `apps/web/app/dashboards/*` and `apps/api/src/routes/dashboards.controller.ts`.
  - Add Partner Operations dashboard using existing KPI/reporting patterns.
- scorecard automation:
  - Current `kpis` and `learning` migrations provide general metrics foundation.
  - Internal Partner performance snapshot is missing.
- KPI sources:
  - Production volume: `production_records`.
  - Acceptance rate: `qc_reviews` and production status.
  - Safety: future JSA/incident records.
  - Documentation: production evidence, compliance docs, closeout package status.
  - Reliability: due-time compliance and mobilization/attendance.
  - Equipment readiness: equipment assignment/inspection records.
  - Financial status: settlements, contractor payables, payment items.
- data freshness:
  - Event-driven recalculation is preferred.
  - Worker consumers are currently minimal, so first implementation may need synchronous recalculation plus future worker jobs.

## 18. Anti-Duplication Decisions

- objects that must be reused:
  - `organizations`
  - `contacts`
  - `capacity_providers`
  - `crews`
  - `workers`
  - `equipment`
  - `compliance_documents`
  - `capacity_records`
  - `projects`
  - `work_orders`
  - `rate_schedules`
  - `rate_codes`
  - `production_records`
  - `production_evidence`
  - `qc_reviews`
  - `billable_items`
  - `settlements`
  - `settlement_items`
  - `contractor_payables`
  - `contractor_payable_items`
  - `cash_receipts`
  - `payment_applications`
  - `payment_batches`
  - `payment_items`
  - `files`
  - `file_links`
  - `events`
  - `audit_logs`
  - `workflow_tasks`
- tables/routes that must not be duplicated:
  - Do not create duplicate Partner copies of Project, WorkOrder, Crew, Worker, Equipment, Production, QC, Settlement, ContractorPayable, or Payment.
  - Do not create generic `partner_forms`, `partner_submissions`, `partner_documents`, or `onboarding_answers` as the primary record of business facts.
- forms that become workflows:
  - MSA, Work Order/rate schedule, vehicle agreement, crew packet, JSA, production report, settlement statement, incident report, corrective action notice, mobilization checklist, W-9/payment setup, insurance checklist, closeout, and performance evaluation.
- PDFs that become generated artifacts:
  - Executed legal documents, weekly settlement statements, NTPs, incident reports, correction notices, and closeout releases.
  - PDFs must be immutable artifacts derived from structured data, not the database.

## 19. Recommended Implementation Sprints

- P1 - Partner domain and organization-scoped access
  - Reuse Organization/CapacityProvider and establish server-side Partner scope foundation.
- P2 - Partner authentication/personas/permissions
  - Add Partner Owner/Admin and Partner Foreman personas and permission keys.
- P3 - Company/W-9/payment/insurance compliance
  - Add restricted compliance/payment profile handling.
- P4 - Crews/workers/credentials
  - Add reusable worker credential and crew readiness structure.
- P5 - Agreements/Work Orders/vehicle assignment
  - Link Partner assignment, WorkOrder/rate schedule, vehicle custody, and agreement artifacts.
- P6 - Mobilization readiness
  - Add readiness engine, blockers, warnings, overrides, NTP, and production-start authorization.
- P7 - Partner Portal shell/dashboard
  - Add external shell after permissions and scope enforcement are tested.
- P8 - JSA and daily production
  - Add mobile-ready JSA, production submission, evidence metadata, idempotency.
- P9 - QC/corrections/incidents
  - Add Partner correction response, incident reporting, and notifications.
- P10 - Settlement/Contractor Payable financial view
  - Add Partner settlement statements, dispute window, funding eligibility visibility.
- P11 - Closeout/performance
  - Add assignment closeout and internal Partner scorecard.
- P12 - PDF generation/e-sign/offline hardening
  - Add template/version/signature/artifact system and offline upload hardening.

## 20. Recommended First Coding Sprint

Smallest safe vertical slice after P0: P1 - Partner domain and organization-scoped access.

- exact schema scope:
  - Add only the minimal Organization/CapacityProvider-linked Partner profile and server-side Partner membership/scope records if existing `user_roles.scope_type` cannot safely bind external users without trusted headers.
  - No new Partner company table.
  - No production, settlement, payment, JSA, document generation, or e-sign schema.
- API scope:
  - Internal-only Partner domain read/write endpoints or service methods for creating/linking Partner profile to existing Organization/CapacityProvider.
  - Scope resolver tests for own organization versus other organization.
  - No external Partner Portal routes yet if persona permissions are not complete.
- permission scope:
  - Define internal Partner Operations permissions and external permission placeholders only as needed for access tests.
  - Partner users must not approve themselves, view rates/margins, or access other Partner data.
- event scope:
  - Emit partner profile/application lifecycle events through existing write-action pattern.
  - Include tenant, organization, capacity_provider, actor, and idempotency where write actions may repeat.
- UI scope:
  - None, or internal-only read screen if needed for verification. No external portal shell.
- tests/smokes:
  - Migration/schema smoke.
  - Permission/scope denial tests for cross-Partner access.
  - Audit/event creation regression for partner lifecycle write.
  - No production, settlement, payment, or document UI tests.
- excluded scope:
  - Partner login UX, JSA, production submission, file upload, worker PII, agreements/e-sign, payment setup, settlement statements, offline support.
- acceptance criteria:
  - A Partner company is represented by Organization plus CapacityProvider.
  - External-scoped access cannot cross organizations.
  - No duplicate Partner company, worker, crew, equipment, project, work order, production, settlement, or payable tables are introduced.
  - Sensitive/internal finance fields remain inaccessible to Partner scopes.

## 21. Risks and Open Questions

- Existing permission scope can be header-driven. External Partner routes must resolve organization scope server-side from authenticated membership, not from client headers.
- File storage is metadata-only in inspected code. Sensitive documents and field photos need authorization, categories, signed access, and access audit before external exposure.
- Worker PII and credential structure are missing. Adding these fields without privacy rules would create risk.
- Offline-first support is not present. Field production/JSA workflows should not launch without idempotency, queueing, retry, timestamp, GPS, and duplicate prevention.
- Pay-when-paid requires explicit eligibility allocation from customer payment applications to contractor payable items.
- Agreement/e-sign/PDF generation is missing. Legal workflows cannot be represented safely by generic uploads alone.
- Worker/background job infrastructure is minimal. Expiration, readiness, funding eligibility, and scorecard recalculation need either synchronous recalculation or new worker consumers.

## 22. Required Business Confirmations

- Confirm whether Partner Owner and Partner Admin are one role in first release or two separate roles.
- Confirm whether Partner Foreman may upload worker credential evidence, or only Partner Admin may do that.
- Confirm whether any individual Partner worker needs a login in first release. Repository audit does not require it.
- Confirm the exact payment provider boundary for Priority Passport or any replacement provider before storing payment profile metadata.
- Confirm which insurance coverage fields must be stored structurally: general liability, auto, umbrella, workers compensation, additional insured, waiver of subrogation, primary/non-contributory, limits, policy numbers, carrier, expiration.
- Confirm whether Partner settlement statement acceptance is explicit click-to-accept, deemed accepted after 10 calendar days, or both.
- Confirm whether vehicle assignment applies only to Sync-rented vehicles or also Partner-owned equipment used on a Sync Work Order.

## 23. GO / NO-GO Recommendation

- GO for starting P1 only.
- NO-GO for building the external Partner Portal UI or field production workflows before P1/P2 access controls are complete.
- blockers for full Partner Portal:
  - missing Partner personas/permissions
  - missing server-side organization-scoped external access
  - missing sensitive file authorization
  - missing worker credential/PII model
  - missing vehicle custody/allocation model
  - missing JSA and incident domain objects
  - missing document generation/e-sign architecture
  - missing pay-when-paid eligibility linkage
  - missing offline/mobile submission foundation
- required prerequisites:
  - approve Organization plus CapacityProvider as canonical Partner model
  - approve first external personas
  - approve P1 scope and access testing bar
  - define sensitive document categories and financial visibility redactions

## 24. Files Inspected

- `package.json`
- `apps/api/package.json`
- `apps/web/package.json`
- `apps/worker/package.json`
- `packages/auth/package.json`
- `packages/database/package.json`
- `packages/events/package.json`
- `packages/permissions/package.json`
- `packages/shared/package.json`
- `packages/ui/package.json`
- `packages/workflows/package.json`
- `packages/auth/src/index.ts`
- `packages/permissions/src/index.ts`
- `packages/shared/src/write-action.ts`
- `packages/shared/src/audit.ts`
- `packages/events/src/index.ts`
- `packages/workflows/src/index.ts`
- `apps/worker/src/index.ts`
- `apps/worker/README.md`
- `apps/api/src/modules/app.module.ts`
- `apps/api/src/security/authenticated.guard.ts`
- `apps/api/src/security/permission.guard.ts`
- `apps/api/src/security/public.decorator.ts`
- `apps/api/src/routes/auth.controller.ts`
- `apps/api/src/routes/organizations.controller.ts`
- `apps/api/src/routes/contacts.controller.ts`
- `apps/api/src/routes/account-onboarding.controller.ts`
- `apps/api/src/routes/capacity.controller.ts`
- `apps/api/src/routes/coverage.controller.ts`
- `apps/api/src/routes/project-handoffs.controller.ts`
- `apps/api/src/routes/projects.controller.ts`
- `apps/api/src/routes/production.controller.ts`
- `apps/api/src/routes/billable-items.controller.ts`
- `apps/api/src/routes/settlements.controller.ts`
- `apps/api/src/routes/contractor-payables.controller.ts`
- `apps/api/src/routes/payment-execution.controller.ts`
- `apps/api/src/routes/workflows.controller.ts`
- `apps/api/src/routes/dashboards.controller.ts`
- `apps/web/app/api/syncos/[...path]/route.ts`
- `apps/web/app/operator-navigation.tsx`
- `apps/web/app/intelligence/organizations/organization-workspace.tsx`
- `apps/web/app/intelligence/account-onboarding/account-onboarding-workbench.tsx`
- `apps/web/app/opportunities/coverage/coverage-planning-workspace.tsx`
- `apps/web/app/projects/*`
- `apps/web/app/work-orders/work-order-workspace.tsx`
- `apps/web/app/production/production-workspace.tsx`
- `apps/web/app/qc/*`
- `apps/web/app/billable/*`
- `apps/web/app/settlements/*`
- `apps/web/app/invoices/*`
- `apps/web/app/cash/*`
- `apps/web/app/collections/*`
- `apps/web/app/contractor-payables/*`
- `apps/web/app/payments/*`
- `apps/web/app/dashboards/*`
- `packages/database/migrations/001_tenants_users_roles_permissions.sql`
- `packages/database/migrations/002_territories_organizations.sql`
- `packages/database/migrations/003_contacts_relationships.sql`
- `packages/database/migrations/007_capacity_providers_crews_workers_equipment.sql`
- `packages/database/migrations/008_compliance_documents_capacity_records.sql`
- `packages/database/migrations/009_projects_work_orders_production.sql`
- `packages/database/migrations/010_contracts_rates_settlements_invoices_payments.sql`
- `packages/database/migrations/012_events_actions_approvals_audit.sql`
- `packages/database/migrations/013_workflows_tasks_escalations.sql`
- `packages/database/migrations/014_kpis_learning.sql`
- `packages/database/migrations/015_files_file_links.sql`
- `packages/database/migrations/016_tenant_fk_hardening.sql`
- `packages/database/migrations/024_coverage_planning_contract_foundation.sql`
- `packages/database/migrations/026_project_handoff_contract_foundation.sql`
- `packages/database/migrations/027_project_backend_contract_hardening.sql`
- `packages/database/migrations/028_work_order_contract_hardening.sql`
- `packages/database/migrations/029_production_contract_hardening.sql`
- `packages/database/migrations/030_qc_review_contract_foundation.sql`
- `packages/database/migrations/031_billable_contract_foundation.sql`
- `packages/database/migrations/032_settlement_contract_foundation.sql`
- `packages/database/migrations/033_invoice_contract_foundation.sql`
- `packages/database/migrations/034_cash_application_contract_foundation.sql`
- `packages/database/migrations/035_collections_contract_foundation.sql`
- `packages/database/migrations/036_contractor_payable_contract_foundation.sql`
- `packages/database/migrations/037_payroll_contract_foundation.sql`
- `packages/database/migrations/038_payment_execution_contract_foundation.sql`
- `packages/database/migrations/039_bank_reconciliation_contract_foundation.sql`
- `packages/database/migrations/040_accounting_export_contract_foundation.sql`
- `packages/database/migrations/041_account_onboarding_contract_foundation.sql`
- `docs/product/account-onboarding-backend-contract.md`
- `docs/product/coverage-planning-product-contract.md`
- `docs/product/work-order-backend-contract.md`
- `docs/product/production-backend-contract.md`
- `docs/product/production-workspace-product-contract.md`
- `docs/product/qc-workspace-product-contract.md`
- `docs/product/billable-workspace-product-contract.md`
- `docs/product/settlement-workspace-product-contract.md`
- `docs/product/cash-application-workspace-product-contract.md`
- `docs/product/contractor-payable-workspace-product-contract.md`
- `docs/product/payment-execution-workspace-product-contract.md`
- `tests/e2e/fixtures/personas.ts`
- `tests/e2e/personas/minimum-personas.spec.ts`
- `tests/e2e/route-matrix.spec.ts`
- `tests/e2e/boundaries/boundary-copy.spec.ts`
- `tests/regression.test.js`
