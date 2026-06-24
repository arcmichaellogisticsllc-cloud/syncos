import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { installStoredSession } from "../helpers/auth";
import { readE2EManifest } from "../helpers/manifest";
import { expectBoundaryCopy, expectSeededDetailHydrated } from "../helpers/detail-hydration";

const manifest = readE2EManifest();

const sharedHints = ["Cedar Ridge", "Cedar Ridge Phase 1 Fiber Build", "Cedar Ridge Utility Authority"];

const copyChecks = [
  [manifest.records.productionRecord, "Production", /does not create settlement|does not create finance|billable/i],
  [manifest.records.qcReview, "QC", /does not create settlement|billable/i],
  [manifest.records.billableItem, "Billable", /does not create settlement|ready for settlement/i],
  [manifest.records.settlement, "Settlement", /does not create invoice|invoice ready/i],
  [manifest.records.invoice, "Invoice", /does not create cash|ready for cash/i],
  [manifest.records.cashReceipt, "Cash", /does not update invoice|Payment Application/i],
  [manifest.records.collectionCase, "Collection", /does not create cash|payment application|invoice balance/i],
  [manifest.records.contractorPayable, "Contractor", /does not send payment|payment ready/i],
  [manifest.records.payrollRun, "Payroll", /does not send payment|tax|payroll provider/i],
  [manifest.records.paymentBatch, "Payment", /does not move money|status-only|bank transaction/i],
  [manifest.records.bankTransaction, "Bank", /does not create payment execution|invoice balance|money movement/i],
  [manifest.records.accountingExportBatch, "Accounting", /does not call QuickBooks|post GL|mutate source/i],
] as const;

test.describe("Boundary placeholder and copy certification", () => {
  test.setTimeout(90_000);
  test.use({ storageState: personas.systemAdmin.storageState });

  for (const [record, expectedText, copy] of copyChecks) {
    test(`${expectedText} boundary copy is visible`, async ({ page }) => {
      await page.goto("/");
      await installStoredSession(page, personas.systemAdmin.storageState);
      await expectSeededDetailHydrated(page, record.route, record, [record.name.split(" ")[0], ...sharedHints]);
      await expectBoundaryCopy(page, copy);
    });
  }
});
