import { readE2EManifest } from "../helpers/manifest";

const manifest = readE2EManifest();

const keys = [
  "signal",
  "organization",
  "contact",
  "relationshipMap",
  "opportunityCandidate",
  "opportunity",
  "coveragePlan",
  "project",
  "workOrder",
  "productionRecord",
  "qcReview",
  "billableItem",
  "settlement",
  "invoice",
  "cashReceipt",
  "paymentApplication",
  "collectionCase",
  "collectionAction",
  "contractorPayable",
  "payrollRun",
  "paymentBatch",
  "paymentItem",
  "bankAccount",
  "bankTransaction",
  "reconciliationMatch",
  "accountingExportBatch",
  "accountingExportItem",
] as const;

const sharedHints = [
  "Cedar Ridge Phase 1 Fiber Build",
  "WO-CR-001 Underground Fiber Segment A",
  "Cedar Ridge Utility Authority",
];

const extraHints: Partial<Record<(typeof keys)[number], string[]>> = {
  productionRecord: ["Blue Splice Fiber Services", "Blue Splice Crew A", "Approved", "Billable"],
  billableItem: ["Ready For Settlement", "$10,000.00", "Accepted"],
};

export const detailCheckpoints = keys.map((key) => ({
  key,
  ...manifest.records[key],
  hints: [manifest.records[key].name, manifest.records[key].id, manifest.records[key].objectType, ...sharedHints, ...(extraHints[key] ?? [])],
}));
