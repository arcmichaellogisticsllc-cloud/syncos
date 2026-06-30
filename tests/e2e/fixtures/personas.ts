export type E2EPersona = {
  slug: string;
  email: string;
  storageState: string;
  expectedPermissionHint: string;
};

export const personas: Record<string, E2EPersona> = {
  systemAdmin: {
    slug: "system-admin",
    email: "e2e.system.admin@syncos.test",
    storageState: "tests/e2e/.auth/system-admin.json",
    expectedPermissionHint: "admin.manage_users",
  },
  growthOperator: {
    slug: "growth-operator",
    email: "e2e.growth.operator@syncos.test",
    storageState: "tests/e2e/.auth/growth-operator.json",
    expectedPermissionHint: "signal.read",
  },
  opsManager: {
    slug: "ops-manager",
    email: "e2e.ops.manager@syncos.test",
    storageState: "tests/e2e/.auth/ops-manager.json",
    expectedPermissionHint: "project.read",
  },
  fieldSupervisor: {
    slug: "field-supervisor",
    email: "e2e.field.supervisor@syncos.test",
    storageState: "tests/e2e/.auth/field-supervisor.json",
    expectedPermissionHint: "production.read",
  },
  qcReviewer: {
    slug: "qc-reviewer",
    email: "e2e.qc.reviewer@syncos.test",
    storageState: "tests/e2e/.auth/qc-reviewer.json",
    expectedPermissionHint: "qc_review.read",
  },
  financeUser: {
    slug: "finance-user",
    email: "e2e.finance.user@syncos.test",
    storageState: "tests/e2e/.auth/finance-user.json",
    expectedPermissionHint: "invoice.read",
  },
  collectionsSpecialist: {
    slug: "collections-specialist",
    email: "e2e.collections.specialist@syncos.test",
    storageState: "tests/e2e/.auth/collections-specialist.json",
    expectedPermissionHint: "collection_case.read",
  },
  payablesPayrollAdmin: {
    slug: "payables-payroll-admin",
    email: "e2e.payables.payroll.admin@syncos.test",
    storageState: "tests/e2e/.auth/payables-payroll-admin.json",
    expectedPermissionHint: "contractor_payable.read",
  },
  accountingManager: {
    slug: "accounting-manager",
    email: "e2e.accounting.manager@syncos.test",
    storageState: "tests/e2e/.auth/accounting-manager.json",
    expectedPermissionHint: "bank_account.read",
  },
  readOnlyAuditor: {
    slug: "read-only-auditor",
    email: "e2e.readonly.auditor@syncos.test",
    storageState: "tests/e2e/.auth/read-only-auditor.json",
    expectedPermissionHint: ".read",
  },
  qcManager: {
    slug: "qc-manager",
    email: "e2e.qc.manager@syncos.test",
    storageState: "tests/e2e/.auth/qc-manager.json",
    expectedPermissionHint: "qc_review.start",
  },
  billingManager: {
    slug: "billing-manager",
    email: "e2e.billing.manager@syncos.test",
    storageState: "tests/e2e/.auth/billing-manager.json",
    expectedPermissionHint: "invoice.submit_review",
  },
};

export const personaList = Object.values(personas);
