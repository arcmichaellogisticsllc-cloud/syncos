import fs from "node:fs";
import path from "node:path";

type ManifestRecord = {
  id: string;
  name: string;
  objectType: string;
  route: string;
  recommendedPersona: string;
};

type Manifest = {
  records: Record<string, ManifestRecord>;
};

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")) as Manifest;

export type RouteMatrixEntry = {
  group: string;
  route: string;
  requiredPersona: string;
  expectedText: string;
  seededObjectKey?: keyof Manifest["records"];
  status: "must-test" | "optional" | "future";
  screenshotRequired: boolean;
  notes: string;
};

const idRoute = (group: string, key: keyof Manifest["records"], expectedText?: string): RouteMatrixEntry => ({
  group,
  route: manifest.records[key].route,
  requiredPersona: manifest.records[key].recommendedPersona,
  expectedText: expectedText ?? manifest.records[key].objectType,
  seededObjectKey: key,
  status: "must-test",
  screenshotRequired: false,
  notes: `Seeded ${manifest.records[key].name}`,
});

const route = (group: string, pathName: string, expectedText: string, requiredPersona = "system-admin"): RouteMatrixEntry => ({
  group,
  route: pathName,
  requiredPersona,
  expectedText,
  status: "must-test",
  screenshotRequired: false,
  notes: "Non-ID route",
});

export const routeMatrix: RouteMatrixEntry[] = [
  route("Growth / Intelligence", "/intelligence", "Intelligence"),
  route("Growth / Intelligence", "/intelligence/signals", "Signals"),
  idRoute("Growth / Intelligence", "signal"),
  route("Growth / Intelligence", "/intelligence/organizations", "Organizations"),
  route("Growth / Intelligence", "/intelligence/organizations/new", "Organizations"),
  idRoute("Growth / Intelligence", "organization"),
  route("Growth / Intelligence", `${manifest.records.organization.route}/edit`, "Organizations"),
  route("Growth / Intelligence", "/intelligence/contacts", "Contacts"),
  route("Growth / Intelligence", "/intelligence/contacts/new", "Contacts"),
  idRoute("Growth / Intelligence", "contact"),
  route("Growth / Intelligence", `${manifest.records.contact.route}/edit`, "Contacts"),
  route("Growth / Intelligence", "/intelligence/relationship-maps", "Relationship"),
  route("Growth / Intelligence", "/intelligence/relationship-maps/new", "Relationship"),
  idRoute("Growth / Intelligence", "relationshipMap"),
  route("Growth / Intelligence", `${manifest.records.relationshipMap.route}/edit`, "Relationship"),
  route("Opportunity / Coverage", "/opportunities", "Opportunities"),
  route("Opportunity / Coverage", "/opportunities/candidates", "Candidate"),
  route("Opportunity / Coverage", "/opportunities/candidates/new", "Candidate"),
  idRoute("Opportunity / Coverage", "opportunityCandidate"),
  route("Opportunity / Coverage", `${manifest.records.opportunityCandidate.route}/edit`, "Candidate"),
  route("Opportunity / Coverage", "/opportunities/pipeline", "Pipeline"),
  route("Opportunity / Coverage", "/opportunities/new", "Opportunity"),
  idRoute("Opportunity / Coverage", "opportunity"),
  route("Opportunity / Coverage", `${manifest.records.opportunity.route}/edit`, "Opportunity"),
  route("Opportunity / Coverage", "/opportunities/coverage", "Coverage"),
  route("Opportunity / Coverage", "/opportunities/coverage/new", "Coverage"),
  idRoute("Opportunity / Coverage", "coveragePlan", "Coverage"),
  route("Opportunity / Coverage", `${manifest.records.coveragePlan.route}/edit`, "Coverage"),
  route("Execution", "/projects", "Projects"),
  idRoute("Execution", "project"),
  route("Execution", `${manifest.records.project.route}/edit`, "Projects"),
  route("Execution", "/work-orders", "Work Order"),
  route("Execution", "/work-orders/new", "Work Order"),
  idRoute("Execution", "workOrder"),
  route("Execution", `${manifest.records.workOrder.route}/edit`, "Work Order"),
  route("Execution", "/production", "Production"),
  route("Execution", "/production/new", "Production"),
  idRoute("Execution", "productionRecord", "Production"),
  route("Execution", `${manifest.records.productionRecord.route}/edit`, "Production"),
  route("Execution", "/qc", "QC"),
  route("Execution", "/qc/new", "QC"),
  idRoute("Execution", "qcReview", "QC"),
  route("Execution", `${manifest.records.qcReview.route}/edit`, "QC"),
  route("Revenue", "/billable", "Billable"),
  route("Revenue", "/billable/new", "Billable"),
  idRoute("Revenue", "billableItem", "Billable"),
  route("Revenue", `${manifest.records.billableItem.route}/edit`, "Billable"),
  route("Revenue", "/settlements", "Settlement"),
  route("Revenue", "/settlements/new", "Settlement"),
  idRoute("Revenue", "settlement", "Settlement"),
  route("Revenue", `${manifest.records.settlement.route}/edit`, "Settlement"),
  route("Revenue", "/invoices", "Invoice"),
  route("Revenue", "/invoices/new", "Invoice"),
  idRoute("Revenue", "invoice", "Invoice"),
  route("Revenue", `${manifest.records.invoice.route}/edit`, "Invoice"),
  route("Revenue", "/cash", "Cash"),
  route("Revenue", "/cash/receipts/new", "Cash"),
  idRoute("Revenue", "cashReceipt", "Cash"),
  route("Revenue", `${manifest.records.cashReceipt.route}/edit`, "Cash"),
  route("Revenue", "/payment-applications", "Payment Application"),
  idRoute("Revenue", "paymentApplication", "Payment Application"),
  route("Revenue", "/collections", "Collections"),
  route("Revenue", "/collections/new", "Collections"),
  idRoute("Revenue", "collectionCase", "Collection"),
  route("Revenue", `${manifest.records.collectionCase.route}/edit`, "Collections"),
  route("Revenue", "/collection-actions", "Collection"),
  idRoute("Revenue", "collectionAction", "Collection"),
  route("Cost / Labor", "/contractor-payables", "Contractor"),
  route("Cost / Labor", "/contractor-payables/new", "Contractor"),
  idRoute("Cost / Labor", "contractorPayable", "Contractor"),
  route("Cost / Labor", `${manifest.records.contractorPayable.route}/edit`, "Contractor"),
  route("Cost / Labor", "/payroll", "Payroll"),
  route("Cost / Labor", "/payroll/new", "Payroll"),
  idRoute("Cost / Labor", "payrollRun", "Payroll"),
  route("Cost / Labor", `${manifest.records.payrollRun.route}/edit`, "Payroll"),
  route("Cost / Labor", "/payments", "Payment"),
  route("Cost / Labor", "/payments/new", "Payment"),
  idRoute("Cost / Labor", "paymentBatch", "Payment"),
  route("Cost / Labor", `${manifest.records.paymentBatch.route}/edit`, "Payment"),
  idRoute("Cost / Labor", "paymentItem", "Payment"),
  route("Verification / Accounting", "/bank-reconciliation", "Bank Reconciliation"),
  route("Verification / Accounting", "/bank-reconciliation/accounts/new", "Bank"),
  idRoute("Verification / Accounting", "bankAccount", "Bank"),
  route("Verification / Accounting", `${manifest.records.bankAccount.route}/edit`, "Bank"),
  route("Verification / Accounting", "/bank-reconciliation/transactions/new", "Bank"),
  idRoute("Verification / Accounting", "bankTransaction", "Bank"),
  route("Verification / Accounting", `${manifest.records.bankTransaction.route}/edit`, "Bank"),
  idRoute("Verification / Accounting", "reconciliationMatch", "Reconciliation"),
  route("Verification / Accounting", "/accounting-exports", "Accounting"),
  route("Verification / Accounting", "/accounting-exports/new", "Accounting"),
  idRoute("Verification / Accounting", "accountingExportBatch", "Accounting"),
  route("Verification / Accounting", `${manifest.records.accountingExportBatch.route}/edit`, "Accounting"),
  idRoute("Verification / Accounting", "accountingExportItem", "Accounting"),
];
