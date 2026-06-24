import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { readE2EManifest } from "../helpers/manifest";
import { expectAuditAllowed, expectAuditDenied, expectTimelineReadable } from "../helpers/timeline";

const manifest = readE2EManifest();

test.describe("Representative timeline and audit certification", () => {
  test("system admin can read representative timelines", async ({ request }) => {
    await expectTimelineReadable(request, personas.systemAdmin.storageState, `/invoices/${manifest.records.invoice.id}/timeline`);
    await expectTimelineReadable(request, personas.systemAdmin.storageState, `/payment-batches/${manifest.records.paymentBatch.id}/timeline`);
    await expectTimelineReadable(request, personas.systemAdmin.storageState, `/bank-transactions/${manifest.records.bankTransaction.id}/timeline`);
    await expectTimelineReadable(request, personas.systemAdmin.storageState, `/accounting-export-batches/${manifest.records.accountingExportBatch.id}/timeline`);
  });

  test("audit is visible to system admin and denied to read-only auditor where not granted", async ({ request }) => {
    await expectAuditAllowed(request, personas.systemAdmin.storageState, `/invoices/${manifest.records.invoice.id}/audit-summary`);
    await expectAuditAllowed(request, personas.systemAdmin.storageState, `/payment-batches/${manifest.records.paymentBatch.id}/audit-summary`);
    await expectAuditAllowed(request, personas.systemAdmin.storageState, `/bank-transactions/${manifest.records.bankTransaction.id}/audit-summary`);
    await expectAuditAllowed(request, personas.systemAdmin.storageState, `/accounting-export-batches/${manifest.records.accountingExportBatch.id}/audit-summary`);
    await expectAuditDenied(request, personas.opsManager.storageState, `/accounting-export-batches/${manifest.records.accountingExportBatch.id}/audit-summary`);
  });
});
