import { test, expect } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { readE2EManifest } from "../helpers/manifest";
import { withDb } from "../helpers/db";
import { expectRouteHealthy } from "../helpers/page-assertions";

const manifest = readE2EManifest();

test.describe("Source mutation boundaries", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  test("bank reconciliation inspection does not alter invoice balance fields", async ({ page }) => {
    const before = await invoiceSnapshot();
    await expectRouteHealthy(page, manifest.records.bankTransaction.route, "Bank");
    const after = await invoiceSnapshot();
    expect(after).toEqual(before);
  });

  test("accounting export inspection does not alter source invoice or payment batch status", async ({ page }) => {
    const before = await sourceSnapshot();
    await expectRouteHealthy(page, manifest.records.accountingExportBatch.route, "Accounting");
    const after = await sourceSnapshot();
    expect(after).toEqual(before);
  });

  test("collections inspection does not alter invoice balance fields", async ({ page }) => {
    const before = await invoiceSnapshot();
    await expectRouteHealthy(page, manifest.records.collectionCase.route, "Collection");
    const after = await invoiceSnapshot();
    expect(after).toEqual(before);
  });
});

async function invoiceSnapshot() {
  return withDb(async (client) => {
    const result = await client.query("SELECT status, paid_amount, balance_amount, collection_status, cash_application_status FROM invoices WHERE id = $1", [manifest.records.invoice.id]);
    return result.rows[0];
  });
}

async function sourceSnapshot() {
  return withDb(async (client) => {
    const invoice = await client.query("SELECT status, paid_amount, balance_amount, updated_at FROM invoices WHERE id = $1", [manifest.records.invoice.id]);
    const payment = await client.query("SELECT status, approval_status, execution_status, updated_at FROM payment_batches WHERE id = $1", [manifest.records.paymentBatch.id]);
    const bank = await client.query("SELECT reconciliation_status, exception_status, updated_at FROM bank_transactions WHERE id = $1", [manifest.records.bankTransaction.id]);
    return { invoice: invoice.rows[0], payment: payment.rows[0], bank: bank.rows[0] };
  });
}
