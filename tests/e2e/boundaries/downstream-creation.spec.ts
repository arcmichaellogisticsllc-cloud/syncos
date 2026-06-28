import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { readE2EManifest } from "../helpers/manifest";
import { captureBoundaryCounts, expectBoundaryUnchanged } from "../helpers/boundary-assertions";
import { expectRouteHealthy } from "../helpers/page-assertions";
import {
  accountingExportForbidden,
  bankReconciliationForbidden,
  cashForbidden,
  collectionsForbidden,
  invoiceForbidden,
  paymentExecutionForbidden,
  productionForbidden,
} from "../fixtures/boundary-matrix";

const manifest = readE2EManifest();

test.describe("Forbidden downstream creation boundaries", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  const cases = [
    ["production inspection", manifest.records.productionRecord.route, /Production/i, productionForbidden],
    ["invoice inspection", manifest.records.invoice.route, /Invoice/i, invoiceForbidden],
    ["cash receipt inspection", manifest.records.cashReceipt.route, /Cash/i, cashForbidden],
    ["collections inspection", manifest.records.collectionCase.route, /Collection/i, collectionsForbidden],
    ["payment execution inspection", manifest.records.paymentBatch.route, /Payment/i, paymentExecutionForbidden],
    ["bank reconciliation inspection", manifest.records.bankTransaction.route, /Bank/i, bankReconciliationForbidden],
    ["accounting export inspection", manifest.records.accountingExportBatch.route, /Accounting/i, accountingExportForbidden],
  ] as const;

  for (const [label, route, expected, tables] of cases) {
    test(`${label} creates no forbidden downstream objects`, async ({ page }) => {
      // Runs after sustained load in the certification suite; triple timeout
      test.slow();
      const before = await captureBoundaryCounts(manifest.tenant.id, [...tables]);
      await expectRouteHealthy(page, route, expected.source);
      await expectBoundaryUnchanged(manifest.tenant.id, before, label);
    });
  }
});
