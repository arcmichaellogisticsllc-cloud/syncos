import { readE2EManifest } from "../helpers/manifest";

const records = readE2EManifest().records;

export const modalMatrix = [
  {
    domain: "Payment Execution",
    route: records.paymentBatch.route,
    expectedText: "PB-CR-001",
    action: /Mark Executed/i,
    title: /Mark Executed/i,
    requiredFields: [/Execution Reference/i, /Execution Note/i],
    boundaryCopy: /does not confirm bank clearing|executed_later status only/i,
  },
  {
    domain: "Bank Reconciliation",
    route: records.bankTransaction.route,
    expectedText: "BTX-CR-001",
    action: /Open Exception/i,
    title: /Open Exception/i,
    requiredFields: [/Exception Reason/i],
    boundaryCopy: /does not create payment execution|invoice balance/i,
  },
  {
    domain: "Accounting Export",
    route: records.accountingExportBatch.route,
    expectedText: "AEX-CR-001",
    action: /Generate/i,
    title: /generate/i,
    requiredFields: [/Generate Note/i],
    boundaryCopy: /does not call QuickBooks|post GL|mutate source/i,
  },
  {
    domain: "Accounting Export",
    route: records.accountingExportBatch.route,
    expectedText: "AEX-CR-001",
    action: /Mark Submitted/i,
    title: /mark submitted/i,
    requiredFields: [/External Batch Reference|Submit Note/i],
    boundaryCopy: /does not call an external accounting API/i,
  },
];
