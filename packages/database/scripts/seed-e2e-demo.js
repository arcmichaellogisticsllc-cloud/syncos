const { Client } = require("pg");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const namespace = "syncos-browser-e2e-cedar-ridge";
const tenantId = uuid("tenant:arc-syncos-demo");

const ids = Object.freeze({
  tenant: tenantId,
  territoryNorth: uuid("territory:cedar-ridge-north"),
  territorySouth: uuid("territory:cedar-ridge-south"),
  orgCustomer: uuid("org:cedar-ridge-utility-authority"),
  orgStakeholder: uuid("org:cedar-ridge-broadband-office"),
  orgProvider: uuid("org:blue-splice-fiber-services"),
  orgInternal: uuid("org:arc-syncos-demo-operations"),
  contactDana: uuid("contact:dana-lewis"),
  contactMorgan: uuid("contact:morgan-ellis"),
  contactLuis: uuid("contact:luis-moreno"),
  provider: uuid("capacity-provider:blue-splice"),
  crew: uuid("crew:blue-splice-crew-a"),
  worker: uuid("worker:alex-rivera"),
  contract: uuid("contract:cedar-ridge-phase-1"),
  rateSchedule: uuid("rate-schedule:cedar-ridge-phase-1"),
  rateCode: uuid("rate-code:fiber-foot"),
  signal: uuid("signal:cedar-ridge-rfp"),
  signalEvidence: uuid("signal-evidence:cedar-ridge-rfp"),
  relationshipMap: uuid("relationship-map:cedar-ridge-access-map"),
  relationshipPath: uuid("relationship-path:cedar-ridge-access-path"),
  candidate: uuid("candidate:cedar-ridge-phase-1"),
  candidateSignal: uuid("candidate-signal:cedar-ridge-phase-1"),
  opportunity: uuid("opportunity:cedar-ridge-phase-1"),
  coveragePlan: uuid("coverage-plan:cedar-ridge-phase-1"),
  coverageRequirement: uuid("coverage-requirement:cedar-ridge-phase-1"),
  coverageSource: uuid("coverage-source:cedar-ridge-phase-1"),
  projectHandoff: uuid("project-handoff:cedar-ridge-phase-1"),
  project: uuid("project:cedar-ridge-phase-1"),
  workOrder: uuid("work-order:wo-cr-001"),
  productionRecord: uuid("production:prd-cr-001"),
  productionEvidence: uuid("production-evidence:prd-cr-001"),
  qcReview: uuid("qc:qc-cr-001"),
  billableItem: uuid("billable:bill-cr-001"),
  settlement: uuid("settlement:set-cr-001"),
  settlementItem: uuid("settlement-item:set-cr-001"),
  invoice: uuid("invoice:inv-cr-001"),
  invoiceItem: uuid("invoice-item:inv-cr-001"),
  cashReceipt: uuid("cash-receipt:rcpt-cr-001"),
  paymentApplication: uuid("payment-application:payapp-cr-001"),
  collectionCase: uuid("collection-case:coll-cr-001"),
  collectionAction: uuid("collection-action:coll-cr-001"),
  contractorPayable: uuid("contractor-payable:cpay-cr-001"),
  contractorPayableItem: uuid("contractor-payable-item:cpay-cr-001"),
  payrollRun: uuid("payroll-run:pr-cr-001"),
  payrollItem: uuid("payroll-item:pr-cr-001"),
  paymentBatch: uuid("payment-batch:pb-cr-001"),
  contractorPaymentItem: uuid("payment-item:contractor:pb-cr-001"),
  payrollPaymentItem: uuid("payment-item:payroll:pb-cr-001"),
  bankAccount: uuid("bank-account:arc-operating"),
  bankTransaction: uuid("bank-transaction:btx-cr-001"),
  reconciliationMatch: uuid("reconciliation-match:rm-cr-001"),
  accountingExportBatch: uuid("accounting-export-batch:aex-cr-001"),
  accountingExportItemInvoice: uuid("accounting-export-item:invoice"),
  accountingExportItemCash: uuid("accounting-export-item:cash"),
  accountingExportItemPayment: uuid("accounting-export-item:payment"),
  accountingExportItemBank: uuid("accounting-export-item:bank"),
});

const actionIds = Object.freeze({
  // Production action state records
  prodDraft: uuid("action-production-draft"),
  prodSubmitted: uuid("action-production-submitted"),
  prodUnderReview: uuid("action-production-under-review"),
  prodCorrectionRequested: uuid("action-production-correction-requested"),
  prodApprovedNotMarked: uuid("action-production-approved-not-marked"),
  prodVoid: uuid("action-production-void"),
  // QC action state records
  qcPending: uuid("action-qc-pending"),
  qcInReview: uuid("action-qc-in-review"),
  qcCorrectionRequested: uuid("action-qc-correction-requested"),
  qcVoid: uuid("action-qc-void"),
  // Billable action state records
  billableDraft: uuid("action-billable-draft"),
  billableOnHold: uuid("action-billable-on-hold"),
  billableDisputed: uuid("action-billable-disputed"),
  billableVoid: uuid("action-billable-void"),
  // Settlement action state records
  settlementDraft: uuid("action-settlement-draft"),
  settlementItemDraft: uuid("action-settlement-item-draft"),
  settlementUnderReview: uuid("action-settlement-under-review"),
  settlementApproved: uuid("action-settlement-approved"),
  settlementApprovedItem: uuid("action-settlement-approved-item"),
  settlementDisputed: uuid("action-settlement-disputed"),
  settlementDisputedItem: uuid("action-settlement-disputed-item"),
  settlementVoid: uuid("action-settlement-void"),
  // Invoice action state records
  invoiceDraft: uuid("action-invoice-draft"),
  invoiceItemDraft: uuid("action-invoice-item-draft"),
  invoiceUnderReview: uuid("action-invoice-under-review"),
  invoiceApproved: uuid("action-invoice-approved"),
  invoiceDisputed: uuid("action-invoice-disputed"),
  invoiceVoid: uuid("action-invoice-void"),
  // Cash Application action state records
  cashReceiptUnapplied: uuid("action-cash-receipt-unapplied"),
  cashReceiptVoidTarget: uuid("action-cash-receipt-void-target"),
  cashReceiptVoid: uuid("action-cash-receipt-void"),
  paymentApplicationApplied: uuid("action-payment-application-applied"),
  paymentApplicationVoid: uuid("action-payment-application-void"),
  // Collections action state records
  collectionCaseOpen: uuid("action-collection-case-open"),
  collectionCaseClosed: uuid("action-collection-case-closed"),
  collectionActionPlanned: uuid("action-collection-action-planned"),
  collectionActionCompleted: uuid("action-collection-action-completed"),
  // Contractor Payable action state records
  cpayDraft: uuid("action-cpay-draft"),
  cpayItemDraft: uuid("action-cpay-item-draft"),
  cpayUnderReview: uuid("action-cpay-under-review"),
  cpayApproved: uuid("action-cpay-approved"),
  cpayDisputed: uuid("action-cpay-disputed"),
  cpayVoid: uuid("action-cpay-void"),
  // Payroll action state records
  payrollDraft: uuid("action-payroll-draft"),
  payrollItemDraft: uuid("action-payroll-item-draft"),
  payrollUnderReview: uuid("action-payroll-under-review"),
  payrollApproved: uuid("action-payroll-approved"),
  payrollDisputed: uuid("action-payroll-disputed"),
  payrollVoid: uuid("action-payroll-void"),
  // Payment Batch action state records
  paymentBatchDraft: uuid("action-payment-batch-draft"),
  paymentBatchUnderReview: uuid("action-payment-batch-under-review"),
  paymentBatchApproved: uuid("action-payment-batch-approved"),
  paymentBatchScheduled: uuid("action-payment-batch-scheduled"),
  paymentBatchExecutionSubmitted: uuid("action-payment-batch-execution-submitted"),
  paymentBatchVoidTarget: uuid("action-payment-batch-void-target"),
  paymentBatchVoid: uuid("action-payment-batch-void"),
  paymentItemDraft: uuid("action-payment-item-draft"),
  // Bank Reconciliation action state records
  bankAccountArchivable: uuid("action-bank-account-archivable"),
  bankTxnUnmatchedDebit: uuid("action-bank-txn-unmatched-debit"),
  bankTxnUnmatchedCredit: uuid("action-bank-txn-unmatched-credit"),
  bankTxnExceptionNone: uuid("action-bank-txn-exception-none"),
  bankTxnExceptionOpen: uuid("action-bank-txn-exception-open"),
  bankTxnIgnorable: uuid("action-bank-txn-ignorable"),
  reconMatchProposed: uuid("action-recon-match-proposed"),
  // Accounting Export action state records
  aexDraft: uuid("action-aex-draft"),
  aexItemDraft: uuid("action-aex-item-draft"),
  aexGenerated: uuid("action-aex-generated"),
  aexUnderReview: uuid("action-aex-under-review"),
  aexSubmitted: uuid("action-aex-submitted"),
  aexCancelable: uuid("action-aex-cancelable"),
  aexVoid: uuid("action-aex-void"),
  // New action IDs for blocked test resolution
  cpayItemUnderReview: uuid("action-cpay-item-under-review"),
  payrollItemUnderReview: uuid("action-payroll-item-under-review"),
  paymentItemUnderReview: uuid("action-payment-item-under-review"),
  aexItemUnderReview: uuid("action-aex-item-under-review"),
  bankReconPaymentBatch: uuid("action-bank-recon-payment-batch"),
  prodCorrectionEvidence: uuid("action-prod-correction-evidence"),
});

const personas = [
  ["system-admin", "System Admin", "e2e.system.admin@syncos.test", "E2E System Admin", ["*"]],
  ["growth-operator", "Growth Operator", "e2e.growth.operator@syncos.test", "E2E Growth Operator", ["signal.", "signal_evidence.", "signal_entity.", "organization.", "contact.", "relationship_map.", "relationship_path.", "opportunity_candidate.", "candidate_signal.", "opportunity.read", "opportunity.create", "opportunity.update", "opportunity.submit_review"]],
  ["ops-manager", "Operations / Project Manager", "e2e.ops.manager@syncos.test", "E2E Ops Manager", ["opportunity.read", "coverage_plan.", "coverage_requirement.", "coverage_source.", "coverage_gap.", "project_handoff.", "project.", "work_order.", "production.read", "production.create", "production.update", "production.submit", "production_evidence."]],
  ["field-supervisor", "Field Supervisor", "e2e.field.supervisor@syncos.test", "E2E Field Supervisor", ["project.read", "work_order.read", "production.", "production_evidence.", "qc_review.read"]],
  ["qc-reviewer", "QC Reviewer", "e2e.qc.reviewer@syncos.test", "E2E QC Reviewer", ["production.read", "production_evidence.read", "qc_review."]],
  ["finance-user", "Billing / Finance User", "e2e.finance.user@syncos.test", "E2E Finance User", ["billable_item.", "settlement.", "settlement_item.", "invoice.", "invoice_item.", "cash_receipt.", "payment_application.", "collection_case.", "collection_action."]],
  ["collections-specialist", "Collections Specialist", "e2e.collections.specialist@syncos.test", "E2E Collections Specialist", ["invoice.read", "cash_receipt.read", "payment_application.read", "collection_case.", "collection_action."]],
  ["payables-payroll-admin", "Payables / Payroll Admin", "e2e.payables.payroll.admin@syncos.test", "E2E Payables Payroll Admin", ["contractor_payable.", "contractor_payable_item.", "payroll_run.", "payroll_item.", "payment_batch.read", "payment_batch.create", "payment_batch.update", "payment_batch.add_item", "payment_batch.submit_review", "payment_batch.start_review", "payment_item.read", "payment_item.create", "payment_item.update"]],
  ["accounting-manager", "Accounting Manager", "e2e.accounting.manager@syncos.test", "E2E Accounting Manager", ["bank_account.", "bank_transaction.", "reconciliation_match.", "accounting_export_batch.", "accounting_export_item.", "invoice.read", "cash_receipt.read", "payment_application.read", "payment_batch.read"]],
  ["read-only-auditor", "Read-Only Auditor", "e2e.readonly.auditor@syncos.test", "E2E Read Only Auditor", [".read"]],
  ["qc-manager", "QC Manager", "e2e.qc.manager@syncos.test", "E2E QC Manager", ["production.", "production_record.", "qc.", "qc_review.", "production_evidence."]],
  ["billing-manager", "Billing Manager", "e2e.billing.manager@syncos.test", "E2E Billing Manager", ["invoice.", "invoice_item.", "billable_item."]],
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await seedTenant(client);
    await seedPersonas(client);
    await seedCanonicalRecords(client);
    await seedActionStateRecords(client);
    await client.query("COMMIT");
    writeManifest();
    console.log("E2E Cedar Ridge demo seed completed");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function seedTenant(client) {
  await upsert(client, "tenants", {
    id: ids.tenant,
    name: "ARC SyncOS Demo Tenant",
    slug: "arc-syncos-demo",
    status: "active",
  });
}

async function seedPersonas(client) {
  const allPermissions = await client.query("SELECT key FROM permissions ORDER BY key");
  const permissionKeys = allPermissions.rows.map((row) => row.key);
  for (const [slug, roleName, email, displayName, families] of personas) {
    const userId = uuid(`persona-user:${slug}`);
    const tenantUserId = uuid(`tenant-user:${slug}`);
    const roleId = uuid(`persona-role:${slug}`);
    await upsert(client, "users", { id: userId, email, display_name: displayName, status: "active" });
    await upsert(client, "tenant_users", { id: tenantUserId, tenant_id: ids.tenant, user_id: userId, status: "active" });
    await upsert(client, "roles", { id: roleId, tenant_id: ids.tenant, name: roleName, description: `Browser E2E ${roleName}`, system_key: `e2e_${slug.replace(/-/g, "_")}` });
    const selected = families.includes("*") ? permissionKeys : permissionKeys.filter((key) => families.some((family) => family.startsWith(".") ? key.endsWith(family) : family.endsWith(".") ? key.startsWith(family) : key === family));
    if (!selected.includes("signal.read") && permissionKeys.includes("signal.read")) selected.push("signal.read");
    for (const key of selected) {
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT $1, $2, id FROM permissions WHERE key = $3
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [ids.tenant, roleId, key],
      );
    }
    await client.query(
      `INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type)
       VALUES ($1, $2, $3, 'tenant')
       ON CONFLICT (tenant_user_id, role_id, scope_type, scope_id) DO NOTHING`,
      [ids.tenant, tenantUserId, roleId],
    );
  }
}

async function seedCanonicalRecords(client) {
  const admin = uuid("persona-user:system-admin");
  await upsert(client, "territories", { id: ids.territoryNorth, tenant_id: ids.tenant, name: "Cedar Ridge North", code: "CR-N", status: "active" });
  await upsert(client, "territories", { id: ids.territorySouth, tenant_id: ids.tenant, name: "Cedar Ridge South", code: "CR-S", status: "active" });
  await upsert(client, "organizations", { id: ids.orgCustomer, tenant_id: ids.tenant, territory_id: ids.territoryNorth, name: "Cedar Ridge Utility Authority", type: "customer", actor_roles: ["work_creator", "cash_controller"], status: "qualified" });
  await upsert(client, "organizations", { id: ids.orgStakeholder, tenant_id: ids.tenant, territory_id: ids.territoryNorth, name: "Cedar Ridge Broadband Office", type: "government_agency", actor_roles: ["work_influencer", "regulatory_public_actor"], status: "active" });
  await upsert(client, "organizations", { id: ids.orgProvider, tenant_id: ids.tenant, territory_id: ids.territorySouth, name: "Blue Splice Fiber Services", type: "subcontractor", actor_roles: ["capacity_provider"], status: "active" });
  await upsert(client, "organizations", { id: ids.orgInternal, tenant_id: ids.tenant, territory_id: ids.territoryNorth, name: "ARC SyncOS Demo Operations", type: "internal_company", actor_roles: ["work_distributor", "work_validator"], status: "active" });
  await upsert(client, "contacts", { id: ids.contactDana, tenant_id: ids.tenant, organization_id: ids.orgCustomer, first_name: "Dana", last_name: "Lewis", full_name: "Dana Lewis", title: "Program Manager", email: "dana.lewis@cedarridge.test", verification_status: "verified", status: "verified" });
  await upsert(client, "contacts", { id: ids.contactMorgan, tenant_id: ids.tenant, organization_id: ids.orgStakeholder, first_name: "Morgan", last_name: "Ellis", full_name: "Morgan Ellis", title: "Broadband Office Contact", email: "morgan.ellis@cedarridge.test", verification_status: "verified", status: "relationship_active" });
  await upsert(client, "contacts", { id: ids.contactLuis, tenant_id: ids.tenant, organization_id: ids.orgProvider, first_name: "Luis", last_name: "Moreno", full_name: "Luis Moreno", title: "Crew Coordinator", email: "luis.moreno@bluesplice.test", verification_status: "verified", status: "engaged" });
  await upsert(client, "capacity_providers", { id: ids.provider, tenant_id: ids.tenant, organization_id: ids.orgProvider, primary_contact_id: ids.contactLuis, name: "Blue Splice Fiber Services", provider_type: "subcontractor", verification_status: "verified", contract_status: "contracted", status: "activated" });
  await upsert(client, "crews", { id: ids.crew, tenant_id: ids.tenant, capacity_provider_id: ids.provider, name: "Blue Splice Crew A", crew_type: "trench", status: "active" });
  await upsert(client, "workers", { id: ids.worker, tenant_id: ids.tenant, capacity_provider_id: ids.provider, crew_id: ids.crew, first_name: "Alex", last_name: "Rivera", status: "active" });
  await upsert(client, "signals", { id: ids.signal, tenant_id: ids.tenant, signal_type: "procurement", signal_category: "rfp", title: "Cedar Ridge Fiber Expansion RFP Discovered", description: "Public RFP discovered for Cedar Ridge Phase 1 fiber expansion.", source_name: "Cedar Ridge Procurement", status: "verified", confidence: 92, confidence_score: 92, source_type: "procurement_source", trust_level: "verified", owner_user_id: admin, date_discovered: "2026-01-05", estimated_value: 10000, estimated_scope: "1,000 feet underground fiber Segment A", work_type: "fiber", verified_by: admin, verified_at: "2026-01-05T12:00:00Z" });
  await upsert(client, "signal_evidence", { id: ids.signalEvidence, tenant_id: ids.tenant, signal_id: ids.signal, evidence_type: "procurement_notice", summary: "Cedar Ridge RFP notice", description: "Seeded procurement evidence for Browser E2E.", status: "active", trust_level: "verified", created_by: admin });
  await upsert(client, "signal_entities", { id: uuid("signal-entity:customer"), tenant_id: ids.tenant, signal_id: ids.signal, entity_type: "organization", entity_id: ids.orgCustomer, is_primary: true, linked_by: admin });
  await upsert(client, "relationship_maps", { id: ids.relationshipMap, tenant_id: ids.tenant, name: "Cedar Ridge Access Map", root_entity_type: "organization", root_entity_id: ids.orgInternal, target_organization_id: ids.orgCustomer, target_contact_id: ids.contactDana, target_object_type: "opportunity", target_object_id: ids.opportunity, status: "identified_path" });
  await upsert(client, "relationship_paths", { id: ids.relationshipPath, tenant_id: ids.tenant, relationship_map_id: ids.relationshipMap, source_entity_type: "contact", source_entity_id: ids.contactMorgan, target_entity_type: "contact", target_entity_id: ids.contactDana, from_contact_id: ids.contactMorgan, to_contact_id: ids.contactDana, strength_score: 78, confidence_score: 85, rank: 1, status: "active", score: 82, path: [{ contact: "Morgan Ellis" }, { contact: "Dana Lewis" }] });
  await upsert(client, "opportunity_candidates", { id: ids.candidate, tenant_id: ids.tenant, organization_id: ids.orgCustomer, territory_id: ids.territoryNorth, title: "Cedar Ridge Phase 1 Candidate", name: "Cedar Ridge Phase 1 Candidate", work_type: "fiber", owner_user_id: admin, evidence_summary: "RFP with relationship access and provider capacity.", status: "converted_to_opportunity", score: 88, confidence_score: 90, relationship_access_score: 82, capacity_fit_score: 86, strategic_fit_score: 85, risk_score: 20 });
  await upsert(client, "candidate_signals", { id: ids.candidateSignal, tenant_id: ids.tenant, candidate_id: ids.candidate, signal_id: ids.signal, contribution_score: 90, status: "active" });
  await upsert(client, "opportunities", { id: ids.opportunity, tenant_id: ids.tenant, candidate_id: ids.candidate, organization_id: ids.orgCustomer, territory_id: ids.territoryNorth, owner_user_id: admin, title: "Cedar Ridge Phase 1 Fiber Build", work_type: "fiber", evidence_summary: "Canonical Browser E2E opportunity.", scope_summary: "Underground fiber Segment A.", next_action: "Proceed to coverage planning.", stage: "awarded", status: "awarded", estimated_value: 10000, signal_strength_score: 90, relationship_access_score: 82, capacity_fit_score: 86, margin_potential_score: 75, strategic_fit_score: 85, payment_risk_score: 22, pursuit_score: 86, recommendation: "Priority Pursuit" });
  await upsert(client, "contracts", { id: ids.contract, tenant_id: ids.tenant, organization_id: ids.orgCustomer, opportunity_id: ids.opportunity, name: "Cedar Ridge Phase 1 Contract", contract_number: "CON-CR-001", contract_type: "customer", payment_terms_days: 30, status: "active" });
  await upsert(client, "rate_schedules", { id: ids.rateSchedule, tenant_id: ids.tenant, contract_id: ids.contract, organization_id: ids.orgCustomer, name: "Cedar Ridge Phase 1 Rates", effective_date: "2026-01-01", status: "active" });
  await upsert(client, "rate_codes", { id: ids.rateCode, tenant_id: ids.tenant, rate_schedule_id: ids.rateSchedule, code: "FIBER-FT", description: "Underground fiber foot", unit: "feet", unit_type: "feet", amount: 10, customer_rate: 10, contractor_rate: 7, margin_amount: 3, margin_percent: 30, status: "active" });

  await upsert(client, "coverage_plans", { id: ids.coveragePlan, tenant_id: ids.tenant, opportunity_id: ids.opportunity, status: "approved_for_handoff", coverage_readiness_score: 91, capacity_readiness_score: 88, compliance_readiness_score: 86, economic_readiness_score: 82, coverage_readiness_band: "ready_for_handoff", operations_owner_user_id: admin, approved_for_handoff_by: admin, approved_for_handoff_at: "2026-01-08T12:00:00Z", approval_note: "Seeded coverage approved for E2E.", created_by: admin, updated_by: admin });
  await upsert(client, "coverage_requirements", { id: ids.coverageRequirement, tenant_id: ids.tenant, coverage_plan_id: ids.coveragePlan, work_type: "underground", territory_id: ids.territoryNorth, quantity: 1000, unit: "feet", required_crew_type: "trench", required_start_date: "2026-01-15", required_end_date: "2026-01-19", production_rate_assumption: 250, notes: "Segment A", created_by: admin, updated_by: admin });
  await upsert(client, "coverage_sources", { id: ids.coverageSource, tenant_id: ids.tenant, coverage_plan_id: ids.coveragePlan, coverage_requirement_id: ids.coverageRequirement, source_type: "approved_subcontractor", organization_id: ids.orgProvider, capacity_provider_id: ids.provider, crew_id: ids.crew, covered_quantity: 1000, unit: "feet", confidence_score: 88, commitment_status: "committed", estimated_cost: 7000, expected_margin_amount: 3000, expected_margin_percent: 30, margin_confidence: "high", notes: "Blue Splice Crew A committed.", created_by: admin, updated_by: admin });
  await upsert(client, "project_handoffs", { id: ids.projectHandoff, tenant_id: ids.tenant, opportunity_id: ids.opportunity, coverage_plan_id: ids.coveragePlan, status: "project_created", handoff_readiness_score: 92, handoff_readiness_band: "ready_for_project", operations_owner_user_id: admin, project_manager_user_id: admin, field_supervisor_user_id: admin, customer_organization_id: ids.orgCustomer, prime_organization_id: ids.orgInternal, territory_id: ids.territoryNorth, work_type: "fiber", scope_summary: "Cedar Ridge Phase 1 Segment A.", location_summary: "Cedar Ridge North", expected_start_date: "2026-01-15", expected_end_date: "2026-01-19", handoff_notes: "Seeded handoff.", approved_by: admin, approved_at: "2026-01-09T12:00:00Z", created_project_by: admin, created_project_at: "2026-01-10T12:00:00Z", created_by: admin, updated_by: admin });
  await upsert(client, "projects", { id: ids.project, tenant_id: ids.tenant, opportunity_id: ids.opportunity, customer_organization_id: ids.orgCustomer, name: "Cedar Ridge Phase 1 Fiber Build", status: "active", source_opportunity_id: ids.opportunity, source_coverage_plan_id: ids.coveragePlan, source_project_handoff_id: ids.projectHandoff, territory_id: ids.territoryNorth, work_type: "fiber", scope_summary: "Underground fiber Segment A.", location_summary: "Cedar Ridge North", operations_owner_user_id: admin, project_manager_user_id: admin, expected_start_date: "2026-01-15", expected_end_date: "2026-01-19" });
  await client.query("UPDATE project_handoffs SET project_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [ids.project, ids.projectHandoff, ids.tenant]);
  await upsert(client, "work_orders", { id: ids.workOrder, tenant_id: ids.tenant, project_id: ids.project, assigned_capacity_provider_id: ids.provider, assigned_crew_id: ids.crew, title: "WO-CR-001 Underground Fiber Segment A", work_type: "underground", location_description: "Cedar Ridge Segment A", expected_units: 1000, unit_type: "feet", status: "in_progress" });
  await upsert(client, "production_records", { id: ids.productionRecord, tenant_id: ids.tenant, project_id: ids.project, work_order_id: ids.workOrder, capacity_provider_id: ids.provider, crew_id: ids.crew, foreman_user_id: admin, submitted_by_user_id: admin, production_date: "2026-01-16", quantity_submitted: 1000, unit_type: "feet", quantity: 1000, unit: "feet", accepted_quantity: 1000, accepted_by: admin, accepted_at: "2026-01-16T18:00:00Z", approved_quantity: 1000, approved_by: admin, approved_at: "2026-01-16T19:00:00Z", rate_code_id: ids.rateCode, billable_status: "billable", status: "approved" });
  await upsert(client, "production_evidence", { id: ids.productionEvidence, tenant_id: ids.tenant, production_record_id: ids.productionRecord, evidence_type: "daily_report", summary: "PRD-CR-001 Daily Production Segment A", description: "Seeded Browser E2E production evidence.", status: "active" });
  await upsert(client, "qc_reviews", { id: ids.qcReview, tenant_id: ids.tenant, production_record_id: ids.productionRecord, work_order_id: ids.workOrder, project_id: ids.project, review_type: "internal_qc", review_status: "approved", reviewer_user_id: admin, reviewed_at: "2026-01-17T12:00:00Z", claimed_quantity: 1000, approved_quantity: 1000, rejected_quantity: 0, correction_required_quantity: 0, billable_candidate_quantity: 1000, unit: "feet", evidence_status: "sufficient", location_status: "valid", documentation_status: "sufficient", production_status: "valid", review_notes: "QC-CR-001 Internal QC Segment A", created_by: admin, updated_by: admin });
  await upsert(client, "billable_items", { id: ids.billableItem, tenant_id: ids.tenant, project_id: ids.project, work_order_id: ids.workOrder, production_record_id: ids.productionRecord, qc_review_id: ids.qcReview, customer_organization_id: ids.orgCustomer, capacity_provider_id: ids.provider, crew_id: ids.crew, status: "ready_for_settlement", readiness_status: "ready_for_settlement", readiness_score: 95, readiness_band: "ready_for_settlement", approved_quantity: 1000, billable_quantity: 1000, held_quantity: 0, unit: "feet", rate_code_id: ids.rateCode, rate_description: "BILL-CR-001 Segment A Billable", unit_rate: 10, rate_source: "contract_rate", rate_confidence: "confirmed", estimated_billable_amount: 10000, net_billable_amount: 10000, customer_acceptance_status: "accepted", billing_package_status: "ready", documentation_status: "ready", created_by: admin, updated_by: admin });
  await upsert(client, "settlements", { id: ids.settlement, tenant_id: ids.tenant, contract_id: ids.contract, customer_organization_id: ids.orgCustomer, capacity_provider_id: ids.provider, billing_period_start: "2026-01-15", billing_period_end: "2026-01-19", gross_amount: 10000, net_amount: 10000, total_amount: 10000, status: "invoice_ready", settlement_number: "SET-CR-001", settlement_type: "customer_billable", readiness_status: "ready_for_approval", readiness_score: 95, readiness_band: "ready_for_approval", project_id: ids.project, work_order_id: ids.workOrder, settlement_period_start: "2026-01-15", settlement_period_end: "2026-01-19", gross_billable_amount: 10000, contractor_payable_amount: 7000, net_settlement_amount: 10000, estimated_margin_amount: 3000, estimated_margin_percent: 30, invoice_ready: true, payable_ready: true, approved_by: admin, approved_at: "2026-01-18T12:00:00Z", created_by: admin, updated_by: admin });
  await upsert(client, "settlement_items", { id: ids.settlementItem, tenant_id: ids.tenant, settlement_id: ids.settlement, production_record_id: ids.productionRecord, rate_code_id: ids.rateCode, quantity: 1000, unit_rate: 10, gross_amount: 10000, amount: 10000, description: "SET-CR-001 Cedar Ridge Settlement", status: "invoice_ready", billable_item_id: ids.billableItem, project_id: ids.project, work_order_id: ids.workOrder, qc_review_id: ids.qcReview, customer_organization_id: ids.orgCustomer, capacity_provider_id: ids.provider, crew_id: ids.crew, item_type: "customer_billable", unit: "feet", net_amount: 10000, contractor_rate: 7, contractor_payable_amount: 7000, margin_amount: 3000, margin_percent: 30, billing_package_status: "ready", documentation_status: "ready", customer_acceptance_status: "accepted", created_by: admin, updated_by: admin });
  await upsert(client, "invoices", { id: ids.invoice, tenant_id: ids.tenant, organization_id: ids.orgCustomer, settlement_id: ids.settlement, invoice_number: "INV-CR-001", invoice_date: "2026-01-20", due_date: "2026-02-19", invoice_amount: 10000, status: "partially_paid_later", total_amount: 10000, customer_organization_id: ids.orgCustomer, project_id: ids.project, invoice_type: "standard", approval_status: "approved", delivery_status: "sent", cash_application_status: "partially_applied_later", payment_terms: "net_30", billing_period_start: "2026-01-15", billing_period_end: "2026-01-19", subtotal_amount: 10000, original_amount: 10000, paid_amount: 4000, balance_amount: 6000, currency: "USD", payment_status: "partially_paid", collection_status: "in_collection", approved_by: admin, approved_at: "2026-01-20T12:00:00Z", sent_by: admin, sent_at: "2026-01-20T13:00:00Z", created_by: admin, updated_by: admin });
  await upsert(client, "invoice_items", { id: ids.invoiceItem, tenant_id: ids.tenant, invoice_id: ids.invoice, settlement_id: ids.settlement, settlement_item_id: ids.settlementItem, billable_item_id: ids.billableItem, qc_review_id: ids.qcReview, production_record_id: ids.productionRecord, work_order_id: ids.workOrder, project_id: ids.project, customer_organization_id: ids.orgCustomer, item_type: "customer_billable", status: "invoiced", description: "INV-CR-001 Cedar Ridge Invoice", quantity: 1000, unit: "feet", unit_rate: 10, gross_amount: 10000, net_amount: 10000, created_by: admin, updated_by: admin });
  await upsert(client, "cash_receipts", { id: ids.cashReceipt, tenant_id: ids.tenant, receipt_number: "RCPT-CR-001", customer_organization_id: ids.orgCustomer, payer_name: "Cedar Ridge Utility Authority", payment_date: "2026-01-25", payment_method: "ach", payment_reference: "ACH-CR-001", external_transaction_id: "EXT-CR-001", gross_received_amount: 4000, applied_amount: 4000, unapplied_amount: 0, currency: "USD", receipt_status: "fully_applied", deposit_status: "deposited_later", reconciliation_status: "reconciled_later", source_type: "manual", notes: "Cedar Ridge partial payment.", created_by: admin, updated_by: admin });
  await upsert(client, "payment_applications", { id: ids.paymentApplication, tenant_id: ids.tenant, cash_receipt_id: ids.cashReceipt, invoice_id: ids.invoice, customer_organization_id: ids.orgCustomer, applied_amount: 4000, application_date: "2026-01-25", application_status: "applied", application_type: "partial_payment", note: "PAYAPP-CR-001 Cedar Ridge Partial Application", created_by: admin, updated_by: admin });
  await upsert(client, "collection_cases", { id: ids.collectionCase, tenant_id: ids.tenant, invoice_id: ids.invoice, customer_organization_id: ids.orgCustomer, case_number: "COLL-CR-001", case_status: "open", collection_priority: "medium", risk_level: "medium", aging_bucket: "1_30", dispute_status: "none", escalation_status: "none", writeoff_review_status: "not_ready", assigned_owner_user_id: admin, balance_at_open: 6000, current_balance: 6000, original_invoice_amount: 10000, last_payment_amount: 4000, last_payment_at: "2026-01-25T12:00:00Z", next_action_type: "payment_reminder", notes: "Cedar Ridge Balance Follow-Up", created_by: admin, updated_by: admin });
  await upsert(client, "collection_actions", { id: ids.collectionAction, tenant_id: ids.tenant, collection_case_id: ids.collectionCase, invoice_id: ids.invoice, customer_organization_id: ids.orgCustomer, action_type: "payment_reminder", action_status: "planned", action_date: "2026-01-26", actor_user_id: admin, contact_id: ids.contactDana, contact_method: "email", note: "Follow up on remaining Cedar Ridge invoice balance.", created_by: admin, updated_by: admin });
  await upsert(client, "contractor_payables", { id: ids.contractorPayable, tenant_id: ids.tenant, payable_number: "CPAY-CR-001", payable_type: "subcontractor", payable_party_type: "capacity_provider", status: "payment_ready", approval_status: "approved", payment_readiness_status: "ready_for_payment", payment_status: "not_paid", capacity_provider_id: ids.provider, crew_id: ids.crew, vendor_organization_id: ids.orgProvider, project_id: ids.project, settlement_id: ids.settlement, pay_cycle_start: "2026-01-15", pay_cycle_end: "2026-01-19", due_date: "2026-01-31", gross_payable_amount: 7000, net_payable_amount: 7000, compliance_status: "ready", tax_document_status: "ready", approved_by: admin, approved_at: "2026-01-21T12:00:00Z", created_by: admin, updated_by: admin });
  await upsert(client, "contractor_payable_items", { id: ids.contractorPayableItem, tenant_id: ids.tenant, contractor_payable_id: ids.contractorPayable, settlement_id: ids.settlement, settlement_item_id: ids.settlementItem, billable_item_id: ids.billableItem, qc_review_id: ids.qcReview, production_record_id: ids.productionRecord, work_order_id: ids.workOrder, project_id: ids.project, capacity_provider_id: ids.provider, crew_id: ids.crew, item_type: "subcontractor_production", status: "payment_ready", description: "CPAY-CR-001 Blue Splice Payable", quantity: 1000, unit: "feet", contractor_rate: 7, gross_payable_amount: 7000, net_payable_amount: 7000, compliance_status: "ready", tax_document_status: "ready", created_by: admin, updated_by: admin });
  await upsert(client, "payroll_runs", { id: ids.payrollRun, tenant_id: ids.tenant, payroll_run_number: "PR-CR-001", payroll_run_type: "regular", status: "payroll_ready", approval_status: "approved", payroll_readiness_status: "ready_for_payroll", payroll_cycle: "weekly", payroll_period_start: "2026-01-15", payroll_period_end: "2026-01-19", pay_date: "2026-01-26", territory_id: ids.territoryNorth, project_id: ids.project, crew_id: ids.crew, gross_pay_amount: 1200, net_pay_amount: 1200, item_count: 1, worker_count: 1, compliance_status: "ready", tax_document_status: "ready", approved_by: admin, approved_at: "2026-01-22T12:00:00Z", created_by: admin, updated_by: admin });
  await upsert(client, "payroll_items", { id: ids.payrollItem, tenant_id: ids.tenant, payroll_run_id: ids.payrollRun, worker_id: ids.worker, crew_id: ids.crew, project_id: ids.project, work_order_id: ids.workOrder, production_record_id: ids.productionRecord, source_type: "manual", earning_type: "regular", status: "payroll_ready", worker_classification: "w2_employee", work_date: "2026-01-16", hours_regular: 40, rate_regular: 30, gross_pay_amount: 1200, net_pay_amount: 1200, compliance_status: "ready", tax_document_status: "ready", description: "Alex Rivera weekly payroll.", created_by: admin, updated_by: admin });
  await upsert(client, "payment_batches", { id: ids.paymentBatch, tenant_id: ids.tenant, payment_batch_number: "PB-CR-001", batch_type: "mixed_later", payment_method: "manual", status: "executed_later", approval_status: "approved", execution_status: "executed_later", scheduled_payment_date: "2026-01-27", submitted_at: "2026-01-27T10:00:00Z", submitted_by: admin, executed_at: "2026-01-27T12:00:00Z", execution_reference: "PB-CR-001-MANUAL", item_count: 2, total_payment_amount: 8200, currency: "USD", approved_by: admin, approved_at: "2026-01-26T12:00:00Z", notes: "Status-only E2E payment execution batch.", created_by: admin, updated_by: admin });
  await upsert(client, "payment_items", { id: ids.contractorPaymentItem, tenant_id: ids.tenant, payment_batch_id: ids.paymentBatch, source_type: "contractor_payable", contractor_payable_id: ids.contractorPayable, contractor_payable_item_id: ids.contractorPayableItem, payee_type: "capacity_provider", capacity_provider_id: ids.provider, crew_id: ids.crew, payee_name: "Blue Splice Fiber Services", payment_method: "manual", payment_amount: 7000, currency: "USD", payment_date: "2026-01-27", execution_status: "executed_later", execution_reference: "PB-CR-001-CPAY", status: "executed_later", notes: "Status-only contractor payment item.", created_by: admin, updated_by: admin });
  await upsert(client, "payment_items", { id: ids.payrollPaymentItem, tenant_id: ids.tenant, payment_batch_id: ids.paymentBatch, source_type: "payroll", payroll_run_id: ids.payrollRun, payroll_item_id: ids.payrollItem, payee_type: "worker", worker_id: ids.worker, payee_name: "Alex Rivera", payment_method: "manual", payment_amount: 1200, currency: "USD", payment_date: "2026-01-27", execution_status: "executed_later", execution_reference: "PB-CR-001-PR", status: "executed_later", notes: "Status-only payroll payment item.", created_by: admin, updated_by: admin });
  await upsert(client, "bank_accounts", { id: ids.bankAccount, tenant_id: ids.tenant, account_name: "ARC Operating Account", account_type: "operating", institution_name: "ARC Demo Bank", masked_account_number: "****1234", routing_last4: "6789", currency: "USD", status: "active", opening_balance: 25000, current_balance_snapshot: 20800, last_statement_date: "2026-01-31", last_reconciled_at: "2026-01-31T12:00:00Z", notes: "Masked data only.", created_by: admin, updated_by: admin });
  await upsert(client, "bank_transactions", { id: ids.bankTransaction, tenant_id: ids.tenant, bank_account_id: ids.bankAccount, transaction_date: "2026-01-27", posted_date: "2026-01-28", direction: "debit", amount: 8200, currency: "USD", description: "BTX-CR-001 Manual Bank Clearing", bank_reference: "BANK-CR-001", external_transaction_id: "BTX-CR-001", payment_method: "manual", transaction_type: "payment_out", reconciliation_status: "matched", cleared_status: "cleared", exception_status: "none", source_type: "manual", notes: "Manual bank truth for status-only payment execution.", created_by: admin, updated_by: admin });
  await upsert(client, "reconciliation_matches", { id: ids.reconciliationMatch, tenant_id: ids.tenant, bank_transaction_id: ids.bankTransaction, match_type: "payment_batch", matched_object_type: "payment_batch", matched_object_id: ids.paymentBatch, payment_batch_id: ids.paymentBatch, matched_amount: 8200, match_confidence: "exact", match_status: "approved", match_reason: "RM-CR-001 Bank Match", variance_amount: 0, reviewed_by: admin, reviewed_at: "2026-01-28T12:00:00Z", approved_by: admin, approved_at: "2026-01-28T13:00:00Z", notes: "Approved E2E reconciliation match.", created_by: admin, updated_by: admin });
  await upsert(client, "accounting_export_batches", { id: ids.accountingExportBatch, tenant_id: ids.tenant, export_batch_number: "AEX-CR-001", export_type: "mixed_later", target_system: "manual_export", export_format: "manual_summary", status: "approved", approval_status: "approved", export_status: "generated", period_start: "2026-01-01", period_end: "2026-01-31", item_count: 4, total_debit_amount: 8200, total_credit_amount: 14000, total_amount: 22200, currency: "USD", generated_file_reference: "metadata-only:AEX-CR-001", error_count: 0, retry_count: 0, notes: "AEX-CR-001 Accounting Export", created_by: admin, updated_by: admin });
  await upsert(client, "accounting_export_items", { id: ids.accountingExportItemInvoice, tenant_id: ids.tenant, accounting_export_batch_id: ids.accountingExportBatch, source_object_type: "invoice", source_object_id: ids.invoice, invoice_id: ids.invoice, export_item_type: "receivable", export_status: "generated", mapping_status: "mapped", target_account_code: "1200", target_account_name: "Accounts Receivable", target_entity_reference: "Cedar Ridge Utility Authority", debit_amount: 10000, amount: 10000, currency: "USD", memo: "Cedar Ridge invoice", transaction_date: "2026-01-20", created_by: admin, updated_by: admin });
  await upsert(client, "accounting_export_items", { id: ids.accountingExportItemCash, tenant_id: ids.tenant, accounting_export_batch_id: ids.accountingExportBatch, source_object_type: "cash_receipt", source_object_id: ids.cashReceipt, cash_receipt_id: ids.cashReceipt, export_item_type: "cash_receipt", export_status: "generated", mapping_status: "mapped", target_account_code: "1000", target_account_name: "Operating Cash", target_entity_reference: "Cedar Ridge Utility Authority", credit_amount: 4000, amount: 4000, currency: "USD", memo: "Cedar Ridge partial cash receipt", transaction_date: "2026-01-25", created_by: admin, updated_by: admin });
  await upsert(client, "accounting_export_items", { id: ids.accountingExportItemPayment, tenant_id: ids.tenant, accounting_export_batch_id: ids.accountingExportBatch, source_object_type: "payment_batch", source_object_id: ids.paymentBatch, payment_batch_id: ids.paymentBatch, export_item_type: "payment", export_status: "generated", mapping_status: "mapped", target_account_code: "2000", target_account_name: "Payables Clearing", target_entity_reference: "Blue Splice Fiber Services", credit_amount: 8200, amount: 8200, currency: "USD", memo: "Cedar Ridge payment execution status", transaction_date: "2026-01-27", created_by: admin, updated_by: admin });
  await upsert(client, "accounting_export_items", { id: ids.accountingExportItemBank, tenant_id: ids.tenant, accounting_export_batch_id: ids.accountingExportBatch, source_object_type: "reconciliation_match", source_object_id: ids.reconciliationMatch, bank_transaction_id: ids.bankTransaction, reconciliation_match_id: ids.reconciliationMatch, export_item_type: "reconciliation", export_status: "generated", mapping_status: "mapped", target_account_code: "1000", target_account_name: "Operating Cash", credit_amount: 8200, amount: 8200, currency: "USD", memo: "Cedar Ridge bank reconciliation match", transaction_date: "2026-01-28", created_by: admin, updated_by: admin });
  await client.query("UPDATE billable_items SET settlement_item_id = $1, invoice_item_id = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4", [ids.settlementItem, ids.invoiceItem, ids.billableItem, ids.tenant]);
  await client.query("UPDATE settlement_items SET invoice_item_id = $1, payable_item_id = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4", [ids.invoiceItem, ids.contractorPayableItem, ids.settlementItem, ids.tenant]);
  await client.query("UPDATE contractor_payable_items SET payment_item_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [ids.contractorPaymentItem, ids.contractorPayableItem, ids.tenant]);
  await client.query("UPDATE payroll_items SET payment_item_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [ids.payrollPaymentItem, ids.payrollItem, ids.tenant]);
}

async function seedActionStateRecords(client) {
  const admin = uuid("persona-user:system-admin");
  const t = ids.tenant;

  // ── Production action state records ──────────────────────────────────────
  const prodBase = { tenant_id: t, project_id: ids.project, work_order_id: ids.workOrder, capacity_provider_id: ids.provider, crew_id: ids.crew, foreman_user_id: admin, production_date: "2026-02-01", quantity_submitted: 800, unit_type: "feet", quantity: 800, unit: "feet", rate_code_id: ids.rateCode, created_by: admin, updated_by: admin };
  await upsert(client, "production_records", { ...prodBase, id: actionIds.prodDraft, production_notes: "E2E Action Production Submittable", status: "draft", billable_status: "not_billable" });
  await upsert(client, "production_records", { ...prodBase, id: actionIds.prodSubmitted, production_notes: "E2E Action Production Review Startable", status: "submitted", submitted_by_user_id: admin, billable_status: "not_billable" });
  await upsert(client, "production_records", { ...prodBase, id: actionIds.prodUnderReview, production_notes: "E2E Action Production Approvable", status: "under_review", submitted_by_user_id: admin, billable_status: "not_billable" });
  await upsert(client, "production_records", { ...prodBase, id: actionIds.prodCorrectionRequested, production_notes: "E2E Action Production Correctable", status: "correction_required", submitted_by_user_id: admin, billable_status: "not_billable", correction_required_at: "2026-01-31T12:00:00Z" });
  await upsert(client, "production_evidence", { id: actionIds.prodCorrectionEvidence, tenant_id: t, production_record_id: actionIds.prodCorrectionRequested, evidence_type: "daily_report", summary: "E2E Action Production Correction Evidence", description: "Seeded after correction_required_at for mark-corrected certification.", status: "active" });
  await upsert(client, "production_records", { ...prodBase, id: actionIds.prodApprovedNotMarked, production_notes: "E2E Action Production Billable Markable", status: "approved", accepted_quantity: 800, accepted_by: admin, accepted_at: "2026-02-01T18:00:00Z", approved_quantity: 800, approved_by: admin, approved_at: "2026-02-01T19:00:00Z", billable_status: "not_billable" });
  await upsert(client, "production_records", { ...prodBase, id: actionIds.prodVoid, production_notes: "E2E Action Production Archivable", status: "voided", submitted_by_user_id: admin, billable_status: "not_billable" });

  // ── QC action state records ───────────────────────────────────────────────
  const qcBase = { tenant_id: t, production_record_id: ids.productionRecord, work_order_id: ids.workOrder, project_id: ids.project, review_type: "internal_qc", claimed_quantity: 800, unit: "feet", evidence_status: "sufficient", location_status: "valid", documentation_status: "sufficient", production_status: "valid", created_by: admin, updated_by: admin };
  await upsert(client, "qc_reviews", { ...qcBase, id: actionIds.qcPending, review_notes: "E2E Action QC Startable", review_status: "pending" });
  await upsert(client, "qc_reviews", { ...qcBase, id: actionIds.qcInReview, review_notes: "E2E Action QC Approvable", review_status: "in_review", reviewer_user_id: admin });
  await upsert(client, "qc_reviews", { ...qcBase, id: actionIds.qcCorrectionRequested, review_notes: "E2E Action QC Correctable", review_status: "correction_required", reviewer_user_id: admin });
  await upsert(client, "qc_reviews", { ...qcBase, id: actionIds.qcVoid, review_notes: "E2E Action QC Archivable", review_status: "voided" });

  // ── Billable action state records ─────────────────────────────────────────
  const billBase = { tenant_id: t, project_id: ids.project, work_order_id: ids.workOrder, production_record_id: ids.productionRecord, qc_review_id: ids.qcReview, customer_organization_id: ids.orgCustomer, capacity_provider_id: ids.provider, crew_id: ids.crew, approved_quantity: 800, billable_quantity: 800, held_quantity: 0, unit: "feet", rate_code_id: ids.rateCode, unit_rate: 10, rate_source: "contract_rate", rate_confidence: "confirmed", estimated_billable_amount: 8000, net_billable_amount: 8000, customer_acceptance_status: "accepted", billing_package_status: "ready", documentation_status: "ready", created_by: admin, updated_by: admin };
  await upsert(client, "billable_items", { ...billBase, id: actionIds.billableDraft, rate_description: "E2E Action Billable Recalculatable", status: "candidate", readiness_status: "not_ready", readiness_score: 40, readiness_band: "not_ready" });
  await upsert(client, "billable_items", { ...billBase, id: actionIds.billableOnHold, rate_description: "E2E Action Billable Releasable", status: "held", readiness_status: "needs_review", readiness_score: 60, readiness_band: "ready_with_warning" });
  await upsert(client, "billable_items", { ...billBase, id: actionIds.billableDisputed, rate_description: "E2E Action Billable Dispute Resolvable", status: "disputed", readiness_status: "blocked", readiness_score: 20, readiness_band: "not_ready" });
  await upsert(client, "billable_items", { ...billBase, id: actionIds.billableVoid, rate_description: "E2E Action Billable Archivable", status: "voided", readiness_status: "not_ready", readiness_score: 0, readiness_band: "not_ready" });

  // ── Settlement action state records ───────────────────────────────────────
  const setBase = { tenant_id: t, contract_id: ids.contract, customer_organization_id: ids.orgCustomer, capacity_provider_id: ids.provider, billing_period_start: "2026-02-01", billing_period_end: "2026-02-07", gross_amount: 8000, net_amount: 8000, total_amount: 8000, settlement_type: "customer_billable", project_id: ids.project, settlement_period_start: "2026-02-01", settlement_period_end: "2026-02-07", gross_billable_amount: 8000, contractor_payable_amount: 5600, net_settlement_amount: 8000, estimated_margin_amount: 2400, estimated_margin_percent: 30, created_by: admin, updated_by: admin };
  await upsert(client, "settlements", { ...setBase, id: actionIds.settlementDraft, settlement_number: "SET-ACT-001", status: "draft", readiness_status: "not_ready", readiness_score: 40, readiness_band: "not_ready", invoice_ready: false, payable_ready: false });
  await upsert(client, "settlement_items", { id: actionIds.settlementItemDraft, tenant_id: t, settlement_id: actionIds.settlementDraft, production_record_id: ids.productionRecord, rate_code_id: ids.rateCode, quantity: 800, unit_rate: 10, gross_amount: 8000, amount: 8000, description: "E2E Action Settlement Item Draft", status: "draft", project_id: ids.project, work_order_id: ids.workOrder, qc_review_id: ids.qcReview, customer_organization_id: ids.orgCustomer, capacity_provider_id: ids.provider, crew_id: ids.crew, item_type: "customer_billable", unit: "feet", net_amount: 8000, contractor_rate: 7, contractor_payable_amount: 5600, margin_amount: 2400, margin_percent: 30, billing_package_status: "ready", documentation_status: "ready", customer_acceptance_status: "accepted", created_by: admin, updated_by: admin });
  await upsert(client, "settlements", { ...setBase, id: actionIds.settlementUnderReview, settlement_number: "SET-ACT-002", status: "under_review", readiness_status: "ready_for_approval", readiness_score: 88, readiness_band: "ready_for_approval", invoice_ready: false, payable_ready: false });
  await upsert(client, "settlements", { ...setBase, id: actionIds.settlementApproved, settlement_number: "SET-ACT-003", status: "approved", readiness_status: "ready_for_approval", readiness_score: 95, readiness_band: "ready_for_approval", invoice_ready: false, payable_ready: false, approved_by: admin, approved_at: "2026-02-05T12:00:00Z" });
  await upsert(client, "settlement_items", { id: actionIds.settlementApprovedItem, tenant_id: t, settlement_id: actionIds.settlementApproved, item_type: "customer_billable", status: "approved", quantity: 800, unit_rate: 10, gross_amount: 8000, amount: 8000, net_amount: 8000, description: "E2E Action Settlement Approved Item", billing_package_status: "ready", documentation_status: "ready", customer_acceptance_status: "not_required", created_by: admin, updated_by: admin });
  await upsert(client, "settlements", { ...setBase, id: actionIds.settlementDisputed, settlement_number: "SET-ACT-004", status: "disputed", readiness_status: "blocked", readiness_score: 20, readiness_band: "not_ready", invoice_ready: false, payable_ready: false });
  await upsert(client, "settlement_items", { id: actionIds.settlementDisputedItem, tenant_id: t, settlement_id: actionIds.settlementDisputed, item_type: "customer_billable", status: "disputed", quantity: 800, unit_rate: 10, gross_amount: 8000, amount: 8000, net_amount: 8000, description: "E2E Action Settlement Disputed Item", billing_package_status: "ready", documentation_status: "ready", customer_acceptance_status: "not_required", created_by: admin, updated_by: admin });
  await upsert(client, "settlements", { ...setBase, id: actionIds.settlementVoid, settlement_number: "SET-ACT-005", status: "voided", readiness_status: "not_ready", readiness_score: 0, readiness_band: "not_ready", invoice_ready: false, payable_ready: false });

  // ── Invoice action state records ──────────────────────────────────────────
  const invBase = { tenant_id: t, organization_id: ids.orgCustomer, customer_organization_id: ids.orgCustomer, project_id: ids.project, invoice_type: "standard", payment_terms: "net_30", currency: "USD", billing_period_start: "2026-02-01", billing_period_end: "2026-02-07", subtotal_amount: 8000, total_amount: 8000, original_amount: 8000, invoice_amount: 8000, paid_amount: 0, balance_amount: 8000, payment_status: "unpaid", created_by: admin, updated_by: admin };
  await upsert(client, "invoices", { ...invBase, id: actionIds.invoiceDraft, settlement_id: actionIds.settlementApproved, invoice_number: "INV-ACT-001", invoice_date: "2026-02-05", due_date: "2026-03-07", status: "draft", approval_status: "not_submitted", delivery_status: "not_sent" });
  await upsert(client, "invoice_items", { id: actionIds.invoiceItemDraft, tenant_id: t, invoice_id: actionIds.invoiceDraft, settlement_id: actionIds.settlementApproved, billable_item_id: ids.billableItem, qc_review_id: ids.qcReview, production_record_id: ids.productionRecord, work_order_id: ids.workOrder, project_id: ids.project, customer_organization_id: ids.orgCustomer, item_type: "customer_billable", status: "invoiced", description: "E2E Action Invoice Item Draft", quantity: 800, unit: "feet", unit_rate: 10, gross_amount: 8000, net_amount: 8000, created_by: admin, updated_by: admin });
  await upsert(client, "invoices", { ...invBase, id: actionIds.invoiceUnderReview, settlement_id: actionIds.settlementApproved, invoice_number: "INV-ACT-002", invoice_date: "2026-02-05", due_date: "2026-03-07", status: "under_review", approval_status: "pending", delivery_status: "not_sent" });
  await upsert(client, "invoices", { ...invBase, id: actionIds.invoiceApproved, settlement_id: actionIds.settlementApproved, invoice_number: "INV-ACT-003", invoice_date: "2026-02-05", due_date: "2026-03-07", status: "approved", approval_status: "approved", delivery_status: "not_sent", approved_by: admin, approved_at: "2026-02-05T14:00:00Z" });
  await upsert(client, "invoices", { ...invBase, id: actionIds.invoiceDisputed, settlement_id: actionIds.settlementApproved, invoice_number: "INV-ACT-004", invoice_date: "2026-02-05", due_date: "2026-03-07", status: "disputed", approval_status: "approved", delivery_status: "sent", approved_by: admin, approved_at: "2026-02-05T14:00:00Z", sent_by: admin, sent_at: "2026-02-05T15:00:00Z" });
  await upsert(client, "invoices", { ...invBase, id: actionIds.invoiceVoid, settlement_id: actionIds.settlementApproved, invoice_number: "INV-ACT-005", invoice_date: "2026-02-05", due_date: "2026-03-07", status: "voided", approval_status: "withdrawn", delivery_status: "not_sent" });

  // ── Cash Application action state records ─────────────────────────────────
  const crBase = { tenant_id: t, customer_organization_id: ids.orgCustomer, payer_name: "Cedar Ridge Utility Authority", payment_date: "2026-02-10", payment_method: "ach", currency: "USD", source_type: "manual", created_by: admin, updated_by: admin };
  await upsert(client, "cash_receipts", { ...crBase, id: actionIds.cashReceiptUnapplied, receipt_number: "RCPT-ACT-001", notes: "E2E Action Cash Receipt Apply Ready", payment_reference: "ACH-ACT-001", external_transaction_id: "EXT-ACT-001", gross_received_amount: 3000, applied_amount: 0, unapplied_amount: 3000, receipt_status: "received", deposit_status: "deposited_later", reconciliation_status: "not_reconciled" });
  await upsert(client, "cash_receipts", { ...crBase, id: actionIds.cashReceiptVoidTarget, receipt_number: "RCPT-ACT-002", notes: "E2E Action Cash Receipt Voidable", payment_reference: "ACH-ACT-002", external_transaction_id: "EXT-ACT-002", gross_received_amount: 1000, applied_amount: 0, unapplied_amount: 1000, receipt_status: "received", deposit_status: "deposited_later", reconciliation_status: "not_reconciled" });
  await upsert(client, "cash_receipts", { ...crBase, id: actionIds.cashReceiptVoid, receipt_number: "RCPT-ACT-003", notes: "E2E Action Cash Receipt Archivable", payment_reference: "ACH-ACT-003", external_transaction_id: "EXT-ACT-003", gross_received_amount: 500, applied_amount: 0, unapplied_amount: 0, receipt_status: "voided", deposit_status: "not_deposited", reconciliation_status: "not_reconciled" });
  await upsert(client, "payment_applications", { id: actionIds.paymentApplicationApplied, tenant_id: t, cash_receipt_id: actionIds.cashReceiptUnapplied, invoice_id: actionIds.invoiceApproved, customer_organization_id: ids.orgCustomer, applied_amount: 1000, application_date: "2026-02-10", application_status: "applied", application_type: "partial_payment", note: "E2E Action Payment Application Voidable", created_by: admin, updated_by: admin });
  await upsert(client, "payment_applications", { id: actionIds.paymentApplicationVoid, tenant_id: t, cash_receipt_id: actionIds.cashReceiptVoidTarget, invoice_id: actionIds.invoiceApproved, customer_organization_id: ids.orgCustomer, applied_amount: 500, application_date: "2026-02-10", application_status: "voided", application_type: "partial_payment", note: "E2E Action Payment Application Archivable", created_by: admin, updated_by: admin });

  // ── Collections action state records ──────────────────────────────────────
  await upsert(client, "collection_cases", { id: actionIds.collectionCaseOpen, tenant_id: t, invoice_id: actionIds.invoiceApproved, customer_organization_id: ids.orgCustomer, case_number: "COLL-ACT-001", case_status: "open", collection_priority: "medium", risk_level: "medium", aging_bucket: "1_30", dispute_status: "none", escalation_status: "none", writeoff_review_status: "not_ready", assigned_owner_user_id: admin, balance_at_open: 8000, current_balance: 8000, original_invoice_amount: 8000, last_payment_amount: 0, next_action_type: "payment_reminder", notes: "E2E Action Collection Case Assignable", created_by: admin, updated_by: admin });
  await upsert(client, "collection_cases", { id: actionIds.collectionCaseClosed, tenant_id: t, invoice_id: actionIds.invoiceDisputed, customer_organization_id: ids.orgCustomer, case_number: "COLL-ACT-002", case_status: "closed", collection_priority: "low", risk_level: "low", aging_bucket: "1_30", dispute_status: "none", escalation_status: "none", writeoff_review_status: "not_ready", assigned_owner_user_id: admin, balance_at_open: 2000, current_balance: 2000, original_invoice_amount: 8000, last_payment_amount: 0, notes: "E2E Action Collection Case Archivable", created_by: admin, updated_by: admin });
  await upsert(client, "collection_actions", { id: actionIds.collectionActionPlanned, tenant_id: t, collection_case_id: actionIds.collectionCaseOpen, invoice_id: actionIds.invoiceApproved, customer_organization_id: ids.orgCustomer, action_type: "payment_reminder", action_status: "planned", action_date: "2026-02-12", actor_user_id: admin, contact_id: ids.contactDana, contact_method: "email", note: "E2E Action Collection Action Completable", created_by: admin, updated_by: admin });
  await upsert(client, "collection_actions", { id: actionIds.collectionActionCompleted, tenant_id: t, collection_case_id: actionIds.collectionCaseOpen, invoice_id: actionIds.invoiceApproved, customer_organization_id: ids.orgCustomer, action_type: "internal_note", action_status: "completed", action_date: "2026-02-11", actor_user_id: admin, note: "E2E Action Collection Action Cancelable", completed_at: "2026-02-11T15:00:00Z", created_by: admin, updated_by: admin });

  // ── Contractor Payable action state records ────────────────────────────────
  const cpBase = { tenant_id: t, payable_type: "subcontractor", payable_party_type: "capacity_provider", capacity_provider_id: ids.provider, crew_id: ids.crew, vendor_organization_id: ids.orgProvider, project_id: ids.project, settlement_id: ids.settlement, pay_cycle_start: "2026-02-01", pay_cycle_end: "2026-02-07", due_date: "2026-02-28", gross_payable_amount: 5600, net_payable_amount: 5600, compliance_status: "ready", tax_document_status: "ready", created_by: admin, updated_by: admin };
  await upsert(client, "contractor_payables", { ...cpBase, id: actionIds.cpayDraft, payable_number: "CPAY-ACT-001", status: "draft", approval_status: "pending", payment_readiness_status: "not_ready", payment_status: "not_paid" });
  await upsert(client, "contractor_payable_items", { id: actionIds.cpayItemDraft, tenant_id: t, contractor_payable_id: actionIds.cpayDraft, settlement_id: ids.settlement, settlement_item_id: ids.settlementItem, billable_item_id: ids.billableItem, qc_review_id: ids.qcReview, production_record_id: ids.productionRecord, work_order_id: ids.workOrder, project_id: ids.project, capacity_provider_id: ids.provider, crew_id: ids.crew, item_type: "subcontractor_production", status: "draft", description: "E2E Action Contractor Payable Item Editable", quantity: 800, unit: "feet", contractor_rate: 7, gross_payable_amount: 5600, net_payable_amount: 5600, compliance_status: "ready", tax_document_status: "ready", created_by: admin, updated_by: admin });
  await upsert(client, "contractor_payables", { ...cpBase, id: actionIds.cpayUnderReview, payable_number: "CPAY-ACT-002", status: "under_review", approval_status: "pending", payment_readiness_status: "not_ready", payment_status: "not_paid" });
  await upsert(client, "contractor_payable_items", { id: actionIds.cpayItemUnderReview, tenant_id: t, contractor_payable_id: actionIds.cpayUnderReview, settlement_id: ids.settlement, settlement_item_id: ids.settlementItem, billable_item_id: ids.billableItem, qc_review_id: ids.qcReview, production_record_id: ids.productionRecord, work_order_id: ids.workOrder, project_id: ids.project, capacity_provider_id: ids.provider, crew_id: ids.crew, item_type: "subcontractor_production", status: "draft", description: "E2E Action Contractor Payable Under Review Item", quantity: 800, unit: "feet", contractor_rate: 7, gross_payable_amount: 5600, net_payable_amount: 5600, compliance_status: "ready", tax_document_status: "ready", created_by: admin, updated_by: admin });
  await upsert(client, "contractor_payables", { ...cpBase, id: actionIds.cpayApproved, payable_number: "CPAY-ACT-003", status: "approved", approval_status: "approved", payment_readiness_status: "not_ready", payment_status: "not_paid", approved_by: admin, approved_at: "2026-02-06T12:00:00Z" });
  await upsert(client, "contractor_payables", { ...cpBase, id: actionIds.cpayDisputed, payable_number: "CPAY-ACT-004", status: "disputed", approval_status: "pending", payment_readiness_status: "not_ready", payment_status: "not_paid" });
  await upsert(client, "contractor_payables", { ...cpBase, id: actionIds.cpayVoid, payable_number: "CPAY-ACT-005", status: "voided", approval_status: "withdrawn", payment_readiness_status: "not_ready", payment_status: "not_paid" });

  // ── Payroll action state records ───────────────────────────────────────────
  const prBase = { tenant_id: t, payroll_run_type: "regular", payroll_cycle: "weekly", payroll_period_start: "2026-02-01", payroll_period_end: "2026-02-07", pay_date: "2026-02-14", territory_id: ids.territoryNorth, project_id: ids.project, crew_id: ids.crew, gross_pay_amount: 960, net_pay_amount: 960, item_count: 1, worker_count: 1, compliance_status: "ready", tax_document_status: "ready", created_by: admin, updated_by: admin };
  await upsert(client, "payroll_runs", { ...prBase, id: actionIds.payrollDraft, payroll_run_number: "PR-ACT-001", status: "draft", approval_status: "pending", payroll_readiness_status: "not_ready" });
  await upsert(client, "payroll_items", { id: actionIds.payrollItemDraft, tenant_id: t, payroll_run_id: actionIds.payrollDraft, worker_id: ids.worker, crew_id: ids.crew, project_id: ids.project, work_order_id: ids.workOrder, production_record_id: ids.productionRecord, source_type: "manual", earning_type: "regular", status: "draft", worker_classification: "w2_employee", work_date: "2026-02-03", hours_regular: 32, rate_regular: 30, gross_pay_amount: 960, net_pay_amount: 960, compliance_status: "ready", tax_document_status: "ready", description: "E2E Action Payroll Item Editable", created_by: admin, updated_by: admin });
  await upsert(client, "payroll_runs", { ...prBase, id: actionIds.payrollUnderReview, payroll_run_number: "PR-ACT-002", status: "under_review", approval_status: "pending", payroll_readiness_status: "not_ready" });
  await upsert(client, "payroll_items", { id: actionIds.payrollItemUnderReview, tenant_id: t, payroll_run_id: actionIds.payrollUnderReview, worker_id: ids.worker, crew_id: ids.crew, project_id: ids.project, work_order_id: ids.workOrder, production_record_id: ids.productionRecord, source_type: "manual", earning_type: "regular", status: "draft", worker_classification: "w2_employee", work_date: "2026-02-03", hours_regular: 32, rate_regular: 30, gross_pay_amount: 960, net_pay_amount: 960, compliance_status: "ready", tax_document_status: "ready", description: "E2E Action Payroll Under Review Item", created_by: admin, updated_by: admin });
  await upsert(client, "payroll_runs", { ...prBase, id: actionIds.payrollApproved, payroll_run_number: "PR-ACT-003", status: "approved", approval_status: "approved", payroll_readiness_status: "not_ready", approved_by: admin, approved_at: "2026-02-07T12:00:00Z" });
  await upsert(client, "payroll_runs", { ...prBase, id: actionIds.payrollDisputed, payroll_run_number: "PR-ACT-004", status: "disputed", approval_status: "pending", payroll_readiness_status: "not_ready" });
  await upsert(client, "payroll_runs", { ...prBase, id: actionIds.payrollVoid, payroll_run_number: "PR-ACT-005", status: "voided", approval_status: "withdrawn", payroll_readiness_status: "not_ready" });

  // ── Payment Batch action state records ────────────────────────────────────
  const pbBase = { tenant_id: t, payment_method: "manual", item_count: 0, total_payment_amount: 0, currency: "USD", created_by: admin, updated_by: admin };
  await upsert(client, "payment_batches", { ...pbBase, id: actionIds.paymentBatchDraft, payment_batch_number: "PB-ACT-001", batch_type: "mixed_later", status: "draft", approval_status: "pending", execution_status: "not_submitted", notes: "E2E Action Payment Batch Add Contractor Payable Ready" });
  await upsert(client, "payment_batches", { ...pbBase, id: actionIds.paymentBatchUnderReview, payment_batch_number: "PB-ACT-002", batch_type: "mixed_later", status: "under_review", approval_status: "pending", execution_status: "not_submitted", item_count: 1, notes: "E2E Action Payment Batch Approvable" });
  await upsert(client, "payment_items", { id: actionIds.paymentItemUnderReview, tenant_id: t, payment_batch_id: actionIds.paymentBatchUnderReview, source_type: "contractor_payable", contractor_payable_id: ids.contractorPayable, payee_type: "capacity_provider", capacity_provider_id: ids.provider, payee_name: "Blue Splice Fiber Services", payment_method: "manual", payment_amount: 2000, currency: "USD", payment_date: "2026-02-15", execution_status: "not_submitted", status: "draft", notes: "E2E Action Payment Batch Under Review Item", created_by: admin, updated_by: admin });
  await upsert(client, "payment_batches", { ...pbBase, id: actionIds.paymentBatchApproved, payment_batch_number: "PB-ACT-003", batch_type: "mixed_later", status: "approved", approval_status: "approved", execution_status: "not_submitted", notes: "E2E Action Payment Batch Schedulable", approved_by: admin, approved_at: "2026-02-08T12:00:00Z" });
  await upsert(client, "payment_batches", { ...pbBase, id: actionIds.paymentBatchScheduled, payment_batch_number: "PB-ACT-004", batch_type: "mixed_later", status: "scheduled", approval_status: "approved", execution_status: "ready_for_execution", scheduled_payment_date: "2026-02-15", notes: "E2E Action Payment Batch Submit Execution Ready", approved_by: admin, approved_at: "2026-02-08T12:00:00Z" });
  await upsert(client, "payment_batches", { ...pbBase, id: actionIds.paymentBatchExecutionSubmitted, payment_batch_number: "PB-ACT-005", batch_type: "mixed_later", status: "submitted", approval_status: "approved", execution_status: "ready_for_execution", scheduled_payment_date: "2026-02-15", submitted_at: "2026-02-15T09:00:00Z", submitted_by: admin, notes: "E2E Action Payment Batch Executable", approved_by: admin, approved_at: "2026-02-08T12:00:00Z" });
  await upsert(client, "payment_batches", { ...pbBase, id: actionIds.paymentBatchVoidTarget, payment_batch_number: "PB-ACT-006", batch_type: "mixed_later", status: "draft", approval_status: "pending", execution_status: "not_submitted", notes: "E2E Action Payment Batch Voidable" });
  await upsert(client, "payment_batches", { ...pbBase, id: actionIds.paymentBatchVoid, payment_batch_number: "PB-ACT-007", batch_type: "mixed_later", status: "voided", approval_status: "withdrawn", execution_status: "cancelled", notes: "E2E Action Payment Batch Archivable" });
  await upsert(client, "payment_batches", { ...pbBase, id: actionIds.bankReconPaymentBatch, payment_batch_number: "PB-ACT-008", batch_type: "mixed_later", status: "executed_later", approval_status: "approved", execution_status: "executed_later", scheduled_payment_date: "2026-02-10", submitted_at: "2026-02-10T09:00:00Z", submitted_by: admin, executed_at: "2026-02-10T12:00:00Z", execution_reference: "PB-ACT-008-MANUAL", total_payment_amount: 5600, approved_by: admin, approved_at: "2026-02-09T12:00:00Z", notes: "E2E Action Bank Recon Payment Batch Match Target" });
  await upsert(client, "payment_items", { id: actionIds.paymentItemDraft, tenant_id: t, payment_batch_id: actionIds.paymentBatchDraft, source_type: "contractor_payable", contractor_payable_id: ids.contractorPayable, payee_type: "capacity_provider", capacity_provider_id: ids.provider, payee_name: "Blue Splice Fiber Services", payment_method: "manual", payment_amount: 2000, currency: "USD", payment_date: "2026-02-15", execution_status: "not_submitted", status: "draft", notes: "E2E Action Payment Item Editable", created_by: admin, updated_by: admin });

  // ── Bank Reconciliation action state records ───────────────────────────────
  await upsert(client, "bank_accounts", { id: actionIds.bankAccountArchivable, tenant_id: t, account_name: "E2E Action Bank Account Archivable", account_type: "operating", institution_name: "ARC Demo Bank Secondary", masked_account_number: "****5678", routing_last4: "1111", currency: "USD", status: "inactive", opening_balance: 0, notes: "Action state bank account for archive test.", created_by: admin, updated_by: admin });
  const btBase = { tenant_id: t, bank_account_id: ids.bankAccount, payment_method: "manual", cleared_status: "cleared", source_type: "manual", created_by: admin, updated_by: admin };
  await upsert(client, "bank_transactions", { ...btBase, id: actionIds.bankTxnUnmatchedDebit, transaction_date: "2026-02-10", posted_date: "2026-02-11", direction: "debit", amount: 5600, currency: "USD", description: "E2E Action Bank Transaction Match Payment Batch Ready", bank_reference: "BANK-ACT-001", external_transaction_id: "BTX-ACT-001", transaction_type: "payment_out", reconciliation_status: "unreconciled", exception_status: "none" });
  await upsert(client, "bank_transactions", { ...btBase, id: actionIds.bankTxnUnmatchedCredit, transaction_date: "2026-02-12", posted_date: "2026-02-13", direction: "credit", amount: 3000, currency: "USD", description: "E2E Action Bank Transaction Match Cash Receipt Ready", bank_reference: "BANK-ACT-002", external_transaction_id: "BTX-ACT-002", transaction_type: "deposit_in", reconciliation_status: "unreconciled", exception_status: "none" });
  await upsert(client, "bank_transactions", { ...btBase, id: actionIds.bankTxnExceptionNone, transaction_date: "2026-02-14", posted_date: "2026-02-15", direction: "debit", amount: 200, currency: "USD", description: "E2E Action Bank Transaction Exception Openable", bank_reference: "BANK-ACT-003", external_transaction_id: "BTX-ACT-003", transaction_type: "payment_out", reconciliation_status: "unreconciled", exception_status: "none" });
  await upsert(client, "bank_transactions", { ...btBase, id: actionIds.bankTxnExceptionOpen, transaction_date: "2026-02-14", posted_date: "2026-02-15", direction: "debit", amount: 150, currency: "USD", description: "E2E Action Bank Transaction Exception Resolvable", bank_reference: "BANK-ACT-004", external_transaction_id: "BTX-ACT-004", transaction_type: "payment_out", reconciliation_status: "unreconciled", exception_status: "open", exception_reason: "Amount mismatch" });
  await upsert(client, "bank_transactions", { ...btBase, id: actionIds.bankTxnIgnorable, transaction_date: "2026-02-14", posted_date: "2026-02-15", direction: "credit", amount: 50, currency: "USD", description: "E2E Action Bank Transaction Ignorable", bank_reference: "BANK-ACT-005", external_transaction_id: "BTX-ACT-005", transaction_type: "fee", reconciliation_status: "unreconciled", exception_status: "none" });
  await upsert(client, "reconciliation_matches", { id: actionIds.reconMatchProposed, tenant_id: t, bank_transaction_id: actionIds.bankTxnUnmatchedDebit, match_type: "payment_batch", matched_object_type: "payment_batch", matched_object_id: ids.paymentBatch, payment_batch_id: ids.paymentBatch, matched_amount: 5600, match_confidence: "high", match_status: "proposed", match_reason: "E2E Action Reconciliation Match Reviewable", variance_amount: 0, notes: "Action state proposed reconciliation match.", created_by: admin, updated_by: admin });

  // ── Accounting Export action state records ────────────────────────────────
  const aexBase = { tenant_id: t, target_system: "manual_export", export_format: "manual_summary", period_start: "2026-02-01", period_end: "2026-02-28", item_count: 0, total_debit_amount: 0, total_credit_amount: 0, total_amount: 0, currency: "USD", error_count: 0, retry_count: 0, created_by: admin, updated_by: admin };
  await upsert(client, "accounting_export_batches", { ...aexBase, id: actionIds.aexDraft, export_batch_number: "AEX-ACT-001", export_type: "mixed_later", status: "draft", approval_status: "pending", export_status: "not_generated", notes: "E2E Action Accounting Export Add Item Ready" });
  await upsert(client, "accounting_export_items", { id: actionIds.aexItemDraft, tenant_id: t, accounting_export_batch_id: actionIds.aexDraft, source_object_type: "invoice", source_object_id: ids.invoice, invoice_id: ids.invoice, export_item_type: "receivable", export_status: "pending", mapping_status: "mapped", target_account_code: "1200", target_account_name: "Accounts Receivable", target_entity_reference: "Cedar Ridge Utility Authority", debit_amount: 8000, amount: 8000, currency: "USD", memo: "E2E Action Accounting Export Item Editable", transaction_date: "2026-02-05", created_by: admin, updated_by: admin });
  await upsert(client, "accounting_export_batches", { ...aexBase, id: actionIds.aexGenerated, export_batch_number: "AEX-ACT-002", export_type: "mixed_later", status: "generated", approval_status: "pending", export_status: "generated", generated_file_reference: "metadata-only:AEX-ACT-002", notes: "E2E Action Accounting Export Mark Submitted Ready" });
  await upsert(client, "accounting_export_batches", { ...aexBase, id: actionIds.aexUnderReview, export_batch_number: "AEX-ACT-003", export_type: "mixed_later", status: "under_review", approval_status: "pending", export_status: "generated", generated_file_reference: "metadata-only:AEX-ACT-003", item_count: 1, notes: "E2E Action Accounting Export Approvable" });
  await upsert(client, "accounting_export_items", { id: actionIds.aexItemUnderReview, tenant_id: t, accounting_export_batch_id: actionIds.aexUnderReview, source_object_type: "invoice", source_object_id: ids.invoice, invoice_id: ids.invoice, export_item_type: "receivable", export_status: "pending", mapping_status: "mapped", target_account_code: "1200", target_account_name: "Accounts Receivable", target_entity_reference: "Cedar Ridge Utility Authority", debit_amount: 8000, amount: 8000, currency: "USD", memo: "E2E Action AEX Under Review Item", transaction_date: "2026-02-05", created_by: admin, updated_by: admin });
  await upsert(client, "accounting_export_batches", { ...aexBase, id: actionIds.aexSubmitted, export_batch_number: "AEX-ACT-004", export_type: "mixed_later", status: "submitted_later", approval_status: "approved", export_status: "submitted_later", generated_file_reference: "metadata-only:AEX-ACT-004", approved_by: admin, approved_at: "2026-02-20T12:00:00Z", notes: "E2E Action Accounting Export Mark Accepted Ready" });
  await upsert(client, "accounting_export_batches", { ...aexBase, id: actionIds.aexCancelable, export_batch_number: "AEX-ACT-005", export_type: "mixed_later", status: "draft", approval_status: "pending", export_status: "not_generated", notes: "E2E Action Accounting Export Cancelable" });
  await upsert(client, "accounting_export_batches", { ...aexBase, id: actionIds.aexVoid, export_batch_number: "AEX-ACT-006", export_type: "mixed_later", status: "archived", approval_status: "withdrawn", export_status: "cancelled", notes: "E2E Action Accounting Export Archivable" });
}

async function upsert(client, table, row) {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([key]) => key);
  const values = entries.map(([key, value]) => isJsonbField(key) && value !== null ? JSON.stringify(value) : value);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const updates = columns.filter((column) => column !== "id").map((column) => `${column} = EXCLUDED.${column}`);
  await client.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})
     ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
    values,
  );
}

function isJsonbField(key) {
  return ["metadata", "path", "override_reasons", "warnings", "blockers"].includes(key);
}

function uuid(value) {
  const hash = crypto.createHash("sha1").update(`${namespace}:${value}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function writeManifest() {
  const records = {
    tenant: { id: ids.tenant, name: "ARC SyncOS Demo Tenant" },
    personas: Object.fromEntries(personas.map(([slug, roleName, email]) => [slug, { userId: uuid(`persona-user:${slug}`), email, roleName }])),
    records: {
      signal: route("Signal", ids.signal, "Cedar Ridge Fiber Expansion RFP Discovered", "/intelligence/signals/:id", "growth-operator"),
      organization: route("Organization", ids.orgCustomer, "Cedar Ridge Utility Authority", "/intelligence/organizations/:id", "growth-operator"),
      contact: route("Contact", ids.contactDana, "Dana Lewis", "/intelligence/contacts/:id", "growth-operator"),
      relationshipMap: route("Relationship Map", ids.relationshipMap, "Cedar Ridge Access Map", "/intelligence/relationship-maps/:id", "growth-operator"),
      opportunityCandidate: route("Opportunity Candidate", ids.candidate, "Cedar Ridge Phase 1 Candidate", "/opportunities/candidates/:id", "growth-operator"),
      opportunity: route("Opportunity", ids.opportunity, "Cedar Ridge Phase 1 Fiber Build", "/opportunities/:id", "growth-operator"),
      coveragePlan: route("Coverage Plan", ids.coveragePlan, "Cedar Ridge Phase 1 Coverage Plan", "/opportunities/coverage/:id", "ops-manager"),
      projectHandoff: route("Project Handoff", ids.projectHandoff, "Cedar Ridge Phase 1 Handoff", "/project-handoffs/:id", "ops-manager"),
      project: route("Project", ids.project, "Cedar Ridge Phase 1 Fiber Build", "/projects/:id", "ops-manager"),
      workOrder: route("Work Order", ids.workOrder, "WO-CR-001 Underground Fiber Segment A", "/work-orders/:id", "ops-manager"),
      productionRecord: route("Production Record", ids.productionRecord, "PRD-CR-001 Daily Production Segment A", "/production/:id", "field-supervisor"),
      qcReview: route("QC Review", ids.qcReview, "QC-CR-001 Internal QC Segment A", "/qc/:id", "qc-reviewer"),
      billableItem: route("Billable Item", ids.billableItem, "BILL-CR-001 Segment A Billable", "/billable/:id", "finance-user"),
      settlement: route("Settlement", ids.settlement, "SET-CR-001 Cedar Ridge Settlement", "/settlements/:id", "finance-user"),
      invoice: route("Invoice", ids.invoice, "INV-CR-001 Cedar Ridge Invoice", "/invoices/:id", "finance-user"),
      cashReceipt: route("Cash Receipt", ids.cashReceipt, "RCPT-CR-001 Cedar Ridge Partial Payment", "/cash/receipts/:id", "finance-user"),
      paymentApplication: route("Payment Application", ids.paymentApplication, "PAYAPP-CR-001 Cedar Ridge Partial Application", "/payment-applications/:id", "finance-user"),
      collectionCase: route("Collection Case", ids.collectionCase, "COLL-CR-001 Cedar Ridge Balance Follow-Up", "/collections/:id", "collections-specialist"),
      collectionAction: route("Collection Action", ids.collectionAction, "COLL-CR-001 Payment Reminder", "/collection-actions/:id", "collections-specialist"),
      contractorPayable: route("Contractor Payable", ids.contractorPayable, "CPAY-CR-001 Blue Splice Payable", "/contractor-payables/:id", "payables-payroll-admin"),
      payrollRun: route("Payroll Run", ids.payrollRun, "PR-CR-001 Weekly Payroll", "/payroll/:id", "payables-payroll-admin"),
      paymentBatch: route("Payment Batch", ids.paymentBatch, "PB-CR-001 Payment Batch", "/payments/:id", "payables-payroll-admin"),
      paymentItem: route("Payment Item", ids.contractorPaymentItem, "PB-CR-001 Contractor Payment Item", "/payment-items/:id", "payables-payroll-admin"),
      bankAccount: route("Bank Account", ids.bankAccount, "ARC Operating Account", "/bank-reconciliation/accounts/:id", "accounting-manager"),
      bankTransaction: route("Bank Transaction", ids.bankTransaction, "BTX-CR-001 Manual Bank Clearing", "/bank-reconciliation/transactions/:id", "accounting-manager"),
      reconciliationMatch: route("Reconciliation Match", ids.reconciliationMatch, "RM-CR-001 Bank Match", "/reconciliation-matches/:id", "accounting-manager"),
      accountingExportBatch: route("Accounting Export Batch", ids.accountingExportBatch, "AEX-CR-001 Accounting Export", "/accounting-exports/:id", "accounting-manager"),
      accountingExportItem: route("Accounting Export Item", ids.accountingExportItemInvoice, "AEX-CR-001 Invoice Export Item", "/accounting-export-items/:id", "accounting-manager"),
    },
    actionStates: {
      // Production
      prodDraft: actionIds.prodDraft,
      prodSubmitted: actionIds.prodSubmitted,
      prodUnderReview: actionIds.prodUnderReview,
      prodCorrectionRequested: actionIds.prodCorrectionRequested,
      prodApprovedNotMarked: actionIds.prodApprovedNotMarked,
      prodVoid: actionIds.prodVoid,
      // QC
      qcPending: actionIds.qcPending,
      qcInReview: actionIds.qcInReview,
      qcCorrectionRequested: actionIds.qcCorrectionRequested,
      qcVoid: actionIds.qcVoid,
      // Billable
      billableDraft: actionIds.billableDraft,
      billableOnHold: actionIds.billableOnHold,
      billableDisputed: actionIds.billableDisputed,
      billableVoid: actionIds.billableVoid,
      // Settlement
      settlementDraft: actionIds.settlementDraft,
      settlementItemDraft: actionIds.settlementItemDraft,
      settlementUnderReview: actionIds.settlementUnderReview,
      settlementApproved: actionIds.settlementApproved,
      settlementDisputed: actionIds.settlementDisputed,
      settlementVoid: actionIds.settlementVoid,
      // Invoice
      invoiceDraft: actionIds.invoiceDraft,
      invoiceItemDraft: actionIds.invoiceItemDraft,
      invoiceUnderReview: actionIds.invoiceUnderReview,
      invoiceApproved: actionIds.invoiceApproved,
      invoiceDisputed: actionIds.invoiceDisputed,
      invoiceVoid: actionIds.invoiceVoid,
      // Cash Application
      cashReceiptUnapplied: actionIds.cashReceiptUnapplied,
      cashReceiptVoidTarget: actionIds.cashReceiptVoidTarget,
      cashReceiptVoid: actionIds.cashReceiptVoid,
      paymentApplicationApplied: actionIds.paymentApplicationApplied,
      paymentApplicationVoid: actionIds.paymentApplicationVoid,
      // Collections
      collectionCaseOpen: actionIds.collectionCaseOpen,
      collectionCaseClosed: actionIds.collectionCaseClosed,
      collectionActionPlanned: actionIds.collectionActionPlanned,
      collectionActionCompleted: actionIds.collectionActionCompleted,
      // Contractor Payable
      cpayDraft: actionIds.cpayDraft,
      cpayItemDraft: actionIds.cpayItemDraft,
      cpayUnderReview: actionIds.cpayUnderReview,
      cpayApproved: actionIds.cpayApproved,
      cpayDisputed: actionIds.cpayDisputed,
      cpayVoid: actionIds.cpayVoid,
      // Payroll
      payrollDraft: actionIds.payrollDraft,
      payrollItemDraft: actionIds.payrollItemDraft,
      payrollUnderReview: actionIds.payrollUnderReview,
      payrollApproved: actionIds.payrollApproved,
      payrollDisputed: actionIds.payrollDisputed,
      payrollVoid: actionIds.payrollVoid,
      // Payment Batch
      paymentBatchDraft: actionIds.paymentBatchDraft,
      paymentBatchUnderReview: actionIds.paymentBatchUnderReview,
      paymentBatchApproved: actionIds.paymentBatchApproved,
      paymentBatchScheduled: actionIds.paymentBatchScheduled,
      paymentBatchExecutionSubmitted: actionIds.paymentBatchExecutionSubmitted,
      paymentBatchVoidTarget: actionIds.paymentBatchVoidTarget,
      paymentBatchVoid: actionIds.paymentBatchVoid,
      paymentItemDraft: actionIds.paymentItemDraft,
      // Bank Reconciliation
      bankAccountArchivable: actionIds.bankAccountArchivable,
      bankTxnUnmatchedDebit: actionIds.bankTxnUnmatchedDebit,
      bankTxnUnmatchedCredit: actionIds.bankTxnUnmatchedCredit,
      bankTxnExceptionNone: actionIds.bankTxnExceptionNone,
      bankTxnExceptionOpen: actionIds.bankTxnExceptionOpen,
      bankTxnIgnorable: actionIds.bankTxnIgnorable,
      reconMatchProposed: actionIds.reconMatchProposed,
      bankReconPaymentBatch: actionIds.bankReconPaymentBatch,
      // Accounting Export
      aexDraft: actionIds.aexDraft,
      aexItemDraft: actionIds.aexItemDraft,
      aexGenerated: actionIds.aexGenerated,
      aexUnderReview: actionIds.aexUnderReview,
      aexSubmitted: actionIds.aexSubmitted,
      aexCancelable: actionIds.aexCancelable,
      aexVoid: actionIds.aexVoid,
    },
  };
  const out = path.join(__dirname, "../../../tests/e2e/fixtures/e2e-demo-records.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(records, null, 2)}\n`);
}

function route(type, id, name, routePattern, persona) {
  return { objectType: type, id, name, route: routePattern.replace(":id", id), routePattern, recommendedPersona: persona };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
