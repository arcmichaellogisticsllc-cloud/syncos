import { actionStatesByKey } from "./action-states";

export const modalMatrix = [
  {
    domain: "Payment Execution",
    route: actionStatesByKey.paymentBatchExecutionSubmitted.route,
    expectedText: "PB-ACT-005",
    action: /Mark Executed/i,
    title: /Mark Executed/i,
    requiredFields: [/Execution Reference/i, /Execution Note/i],
    boundaryCopy: /does not confirm bank clearing|executed_later status only/i,
  },
  {
    domain: "Bank Reconciliation",
    route: actionStatesByKey.bankTxnExceptionNone.route,
    expectedText: "BTX-ACT-003",
    action: /Open Exception/i,
    title: /Open Exception/i,
    requiredFields: [/Exception Reason/i],
    boundaryCopy: /does not create payment execution|invoice balance/i,
  },
  {
    domain: "Accounting Export",
    route: actionStatesByKey.aexDraft.route,
    expectedText: "AEX-ACT-001",
    action: /Generate/i,
    title: /generate/i,
    requiredFields: [/Generate Note/i],
    boundaryCopy: /does not call QuickBooks|post GL|mutate source/i,
  },
  {
    domain: "Accounting Export",
    route: actionStatesByKey.aexGenerated.route,
    expectedText: "AEX-ACT-002",
    action: /Mark Submitted/i,
    title: /mark submitted/i,
    requiredFields: [/External Batch Reference|Submit Note/i],
    boundaryCopy: /does not call an external accounting API/i,
  },
];
