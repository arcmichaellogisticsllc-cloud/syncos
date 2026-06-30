import { test, expect, type Page } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { installStoredSession } from "../helpers/auth";
import { openAction, expectModal, submitModal } from "../helpers/modal";
import { expectRouteHealthy } from "../helpers/page-assertions";
import { withDb } from "../helpers/db";
import { captureBoundaryCounts, expectBoundaryUnchanged } from "../helpers/boundary-assertions";
import { readE2EManifest } from "../helpers/manifest";

/**
 * Full-modal submit certification: for each action state, loads the route,
 * opens the action modal, fills required fields, submits, asserts:
 *  1. Modal closes (submit succeeded with no client-side error)
 *  2. Backend DB reflects the expected state mutation
 *  3. Forbidden downstream tables are unchanged
 *
 * Section ordering preserves cross-test record dependencies:
 *  - Bank recon match tests run before Cash and Payment Execution sections
 *    (bankTxnUnmatchedDebit uses bankReconPaymentBatch; bankTxnUnmatchedCredit
 *     uses cashReceiptUnapplied; neither should be mutated beforehand)
 *  - Cash apply invoice test runs before Invoice section
 *    (cashReceiptUnapplied:Apply uses invoiceApproved while it is still "approved")
 *  - Item-level recalculate tests (settlementItemDraft, cpayItemDraft,
 *    payrollItemDraft) run before their parent submit-review tests
 *  - Item-level archive tests (paymentItemDraft, aexItemDraft) run after their
 *    parent submit-review tests (submit-review requires active items)
 */

const manifest = readE2EManifest();
const TENANT_ID = manifest.tenant.id;
const s = manifest.actionStates as Record<string, string>;
const p = manifest.personas as Record<string, { userId: string }>;

const COLLECTIONS_SPECIALIST_USER_ID = p["collections-specialist"].userId;
const PAYMENT_BATCH_SCHEDULED_ID = s.paymentBatchScheduled;
const BANK_RECON_PAYMENT_BATCH_ID = s.bankReconPaymentBatch;
const CASH_RECEIPT_UNAPPLIED_ID = s.cashReceiptUnapplied;
const INVOICE_APPROVED_ID = s.invoiceApproved;

async function fillArchiveReason(page: Page): Promise<void> {
  const field = page.getByLabel(/archive reason/i).first();
  await field.waitFor({ state: "visible", timeout: 5_000 });
  const tagName = await field.evaluate((el: Element) => el.tagName.toLowerCase());
  if (tagName === "select") {
    const options = await field.evaluate((el: Element) => {
      const sel = el as HTMLSelectElement;
      return Array.from(sel.options).map((o) => o.value).filter(Boolean);
    });
    if (options.length > 0) await field.selectOption(options[0]);
  } else {
    await field.fill("E2E certification archive");
  }
}

test.describe("Action-state full submit certification", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  // ── Recalculate / item-level tests (must run before parent submit mutates state) ──

  test("[Billable] billableDraft: Recalculate Readiness submits without mutation", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/billable/${s.billableDraft}`, "billable");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Recalculate/i);
    await expectModal(page, /Recalculate Readiness/i);
    await submitModal(page);
    await expectBoundaryUnchanged(TENANT_ID, before, "billableDraft-recalculate");
  });

  test("[Settlement] settlementItemDraft: Recalculate Readiness submits without mutation", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/settlements/${s.settlementDraft}`, "settlement");
    const before = await captureBoundaryCounts(TENANT_ID, ["invoices", "payment_batches", "payroll_runs", "cash_receipts", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Recalculate Readiness/i);
    await expectModal(page, /Recalculate Readiness/i);
    await submitModal(page);
    await expectBoundaryUnchanged(TENANT_ID, before, "settlementItemDraft-recalculate");
  });

  test("[Contractor Payable] cpayItemDraft: Recalculate Totals submits without mutation", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/contractor-payables/${s.cpayDraft}`, "contractor");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Recalculate Totals/i);
    await expectModal(page, /Recalculate Totals/i);
    await submitModal(page);
    await expectBoundaryUnchanged(TENANT_ID, before, "cpayItemDraft-recalculate");
  });

  test("[Payroll] payrollItemDraft: Recalculate Totals submits without mutation", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payroll/${s.payrollDraft}`, "payroll");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "contractor_payables", "accounting_export_batches"]);
    await openAction(page, /Recalculate Totals/i);
    await expectModal(page, /Recalculate Totals/i);
    await submitModal(page);
    await expectBoundaryUnchanged(TENANT_ID, before, "payrollItemDraft-recalculate");
  });

  // ── Production ────────────────────────────────────────────────────────────────

  test("[Production] prodDraft: Submit → status=submitted", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/production/${s.prodDraft}`, "production");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /^Submit$/i);
    await expectModal(page, /Submit/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM production_records WHERE id = $1 AND tenant_id = $2`, [s.prodDraft, TENANT_ID]));
    expect(row.rows[0].status, "production_records.status must be submitted").toBe("submitted");
    await expectBoundaryUnchanged(TENANT_ID, before, "prodDraft-submit");
  });

  test("[Production] prodSubmitted: Start Review → status=under_review", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.qcManager.storageState);
    await expectRouteHealthy(page, `/production/${s.prodSubmitted}`, "production");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Start Review/i);
    await expectModal(page, /Start Review/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM production_records WHERE id = $1 AND tenant_id = $2`, [s.prodSubmitted, TENANT_ID]));
    expect(row.rows[0].status, "production_records.status must be under_review").toBe("under_review");
    await expectBoundaryUnchanged(TENANT_ID, before, "prodSubmitted-start-review");
  });

  test("[Production] prodUnderReview: Approve → status=approved", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.qcManager.storageState);
    await expectRouteHealthy(page, `/production/${s.prodUnderReview}`, "production");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /^Approve$/i);
    await expectModal(page, /Approve/i);
    await page.getByLabel(/Approval note/i).first().fill("E2E certification approval");
    const qty = page.getByLabel(/Approved quantity/i).first();
    const existing = await qty.inputValue();
    if (!existing) await qty.fill("1");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM production_records WHERE id = $1 AND tenant_id = $2`, [s.prodUnderReview, TENANT_ID]));
    expect(row.rows[0].status, "production_records.status must be approved").toBe("approved");
    await expectBoundaryUnchanged(TENANT_ID, before, "prodUnderReview-approve");
  });

  test("[Production] prodCorrectionRequested: Mark Corrected → status=corrected", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.qcManager.storageState);
    await expectRouteHealthy(page, `/production/${s.prodCorrectionRequested}`, "production");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Mark Corrected/i);
    await expectModal(page, /Corrected/i);
    await page.getByLabel(/Correction note/i).first().fill("E2E certification correction");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM production_records WHERE id = $1 AND tenant_id = $2`, [s.prodCorrectionRequested, TENANT_ID]));
    expect(row.rows[0].status, "production_records.status must be corrected").toBe("corrected");
    await expectBoundaryUnchanged(TENANT_ID, before, "prodCorrectionRequested-mark-corrected");
  });

  test("[Production] prodApprovedNotMarked: Mark Billable → billable_status=billable", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.qcManager.storageState);
    await expectRouteHealthy(page, `/production/${s.prodApprovedNotMarked}`, "production");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Mark Billable/i);
    await expectModal(page, /Billable/i);
    const qty = page.getByLabel(/Billable quantity/i).first();
    const existing = await qty.inputValue();
    if (!existing) await qty.fill("1");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT billable_status FROM production_records WHERE id = $1 AND tenant_id = $2`, [s.prodApprovedNotMarked, TENANT_ID]));
    expect(row.rows[0].billable_status, "production_records.billable_status must be billable").toBe("billable");
    await expectBoundaryUnchanged(TENANT_ID, before, "prodApprovedNotMarked-mark-billable");
  });

  test("[Production] prodVoid: Archive → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/production/${s.prodVoid}`, "production");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive/i);
    await fillArchiveReason(page);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM production_records WHERE id = $1 AND tenant_id = $2`, [s.prodVoid, TENANT_ID]));
    expect(row.rows[0].status, "production_records.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "prodVoid-archive");
  });

  // ── QC ────────────────────────────────────────────────────────────────────────

  test("[QC] qcPending: Start Review → review_status=in_review", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.qcManager.storageState);
    await expectRouteHealthy(page, `/qc/${s.qcPending}`, "qc");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Start Review/i);
    await expectModal(page, /Start Review/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT review_status FROM qc_reviews WHERE id = $1 AND tenant_id = $2`, [s.qcPending, TENANT_ID]));
    expect(row.rows[0].review_status, "qc_reviews.review_status must be in_review").toBe("in_review");
    await expectBoundaryUnchanged(TENANT_ID, before, "qcPending-start-review");
  });

  test("[QC] qcInReview: Approve → review_status=approved", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.qcManager.storageState);
    await expectRouteHealthy(page, `/qc/${s.qcInReview}`, "qc");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /^Approve$/i);
    await expectModal(page, /Approve/i);
    await page.getByLabel(/Approval note/i).first().fill("E2E certification QC approval");
    const qty = page.getByLabel(/Approved quantity/i).first();
    const existing = await qty.inputValue();
    if (!existing) await qty.fill("1");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT review_status FROM qc_reviews WHERE id = $1 AND tenant_id = $2`, [s.qcInReview, TENANT_ID]));
    expect(row.rows[0].review_status, "qc_reviews.review_status must be approved").toBe("approved");
    await expectBoundaryUnchanged(TENANT_ID, before, "qcInReview-approve");
  });

  test("[QC] qcCorrectionRequested: Mark Corrected → review_status=corrected", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.qcManager.storageState);
    await expectRouteHealthy(page, `/qc/${s.qcCorrectionRequested}`, "qc");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Mark Corrected/i);
    await expectModal(page, /Mark Corrected/i);
    await page.getByLabel(/Correction note/i).first().fill("E2E certification QC correction");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT review_status FROM qc_reviews WHERE id = $1 AND tenant_id = $2`, [s.qcCorrectionRequested, TENANT_ID]));
    expect(row.rows[0].review_status, "qc_reviews.review_status must be corrected").toBe("corrected");
    await expectBoundaryUnchanged(TENANT_ID, before, "qcCorrectionRequested-mark-corrected");
  });

  test("[QC] qcVoid: Archive → review_status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/qc/${s.qcVoid}`, "qc");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive/i);
    await fillArchiveReason(page);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT review_status FROM qc_reviews WHERE id = $1 AND tenant_id = $2`, [s.qcVoid, TENANT_ID]));
    expect(row.rows[0].review_status, "qc_reviews.review_status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "qcVoid-archive");
  });

  // ── Billable ──────────────────────────────────────────────────────────────────

  test("[Billable] billableOnHold: Release Hold → status != held", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/billable/${s.billableOnHold}`, "billable");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Release Hold/i);
    await expectModal(page, /Release Hold/i);
    await page.getByLabel(/Release note/i).first().fill("E2E certification hold release");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM billable_items WHERE id = $1 AND tenant_id = $2`, [s.billableOnHold, TENANT_ID]));
    expect(row.rows[0].status, "billable_items.status must not be held after release").not.toBe("held");
    await expectBoundaryUnchanged(TENANT_ID, before, "billableOnHold-release-hold");
  });

  test("[Billable] billableDisputed: Resolve Dispute → status != disputed", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/billable/${s.billableDisputed}`, "billable");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Resolve Dispute/i);
    await expectModal(page, /Resolve Dispute/i);
    await page.getByLabel(/Resolution Note/i).first().fill("E2E certification dispute resolution");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM billable_items WHERE id = $1 AND tenant_id = $2`, [s.billableDisputed, TENANT_ID]));
    expect(row.rows[0].status, "billable_items.status must not be disputed after resolve").not.toBe("disputed");
    await expectBoundaryUnchanged(TENANT_ID, before, "billableDisputed-resolve-dispute");
  });

  test("[Billable] billableVoid: Archive → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/billable/${s.billableVoid}`, "billable");
    const before = await captureBoundaryCounts(TENANT_ID, ["settlements", "invoices", "payment_batches", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive/i);
    await fillArchiveReason(page);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM billable_items WHERE id = $1 AND tenant_id = $2`, [s.billableVoid, TENANT_ID]));
    expect(row.rows[0].status, "billable_items.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "billableVoid-archive");
  });

  // ── Bank Reconciliation ───────────────────────────────────────────────────────
  // NOTE: Bank recon match tests run here (before Cash and Payment Execution)
  // to ensure paymentBatchScheduled and cashReceiptUnapplied are in their
  // expected states when used as match targets.

  test("[Bank Recon] bankAccountArchivable: Archive → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/bank-reconciliation/accounts/${s.bankAccountArchivable}`, "bank");
    const before = await captureBoundaryCounts(TENANT_ID, ["accounting_export_batches", "accounting_export_items", "payment_applications", "reconciliation_matches"]);
    await openAction(page, /Archive Account/i);
    await expectModal(page, /Archive Bank Account/i);
    await fillArchiveReason(page);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM bank_accounts WHERE id = $1 AND tenant_id = $2`, [s.bankAccountArchivable, TENANT_ID]));
    expect(row.rows[0].status, "bank_accounts.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "bankAccountArchivable-archive");
  });

  test("[Bank Recon] bankTxnUnmatchedDebit: Match Payment Batch → reconciliation_status=matched", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/bank-reconciliation/transactions/${s.bankTxnUnmatchedDebit}`, "bank");
    const before = await captureBoundaryCounts(TENANT_ID, ["accounting_export_batches", "accounting_export_items", "payment_applications"]);
    await openAction(page, /Match Payment Batch/i);
    await expectModal(page, /Match Payment Batch/i);
    await page.getByLabel(/Payment Batch ID/i).first().fill(BANK_RECON_PAYMENT_BATCH_ID);
    await page.getByLabel(/Matched Amount/i).first().fill("5600");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT reconciliation_status FROM bank_transactions WHERE id = $1 AND tenant_id = $2`, [s.bankTxnUnmatchedDebit, TENANT_ID]));
    expect(["matched", "partially_matched"], `bank_transactions.reconciliation_status must reflect match`).toContain(row.rows[0].reconciliation_status);
    await expectBoundaryUnchanged(TENANT_ID, before, "bankTxnUnmatchedDebit-match-payment-batch");
  });

  test("[Bank Recon] bankTxnUnmatchedCredit: Match Cash Receipt → reconciliation_match created [deferred-fix]", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/bank-reconciliation/transactions/${s.bankTxnUnmatchedCredit}`, "bank");
    const before = await captureBoundaryCounts(TENANT_ID, ["accounting_export_batches", "accounting_export_items", "payment_applications"]);
    const matchCountBefore = await withDb((c) => c.query(`SELECT count(*)::int AS count FROM reconciliation_matches WHERE bank_transaction_id = $1 AND tenant_id = $2`, [s.bankTxnUnmatchedCredit, TENANT_ID]));
    await openAction(page, /Match Cash Receipt/i);
    await expectModal(page, /Match Cash Receipt/i);
    await page.getByLabel(/Cash Receipt ID/i).first().fill(CASH_RECEIPT_UNAPPLIED_ID);
    await page.getByLabel(/Matched Amount/i).first().fill("3000");
    await submitModal(page);
    const matchCountAfter = await withDb((c) => c.query(`SELECT count(*)::int AS count FROM reconciliation_matches WHERE bank_transaction_id = $1 AND tenant_id = $2`, [s.bankTxnUnmatchedCredit, TENANT_ID]));
    expect(matchCountAfter.rows[0].count, "reconciliation_matches count must increase after Match Cash Receipt").toBeGreaterThan(matchCountBefore.rows[0].count);
    await expectBoundaryUnchanged(TENANT_ID, before, "bankTxnUnmatchedCredit-match-cash-receipt");
  });

  test("[Bank Recon] bankTxnExceptionNone: Open Exception → exception_status=open", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/bank-reconciliation/transactions/${s.bankTxnExceptionNone}`, "bank");
    const before = await captureBoundaryCounts(TENANT_ID, ["accounting_export_batches", "accounting_export_items", "payment_applications"]);
    await openAction(page, /Open Exception/i);
    await expectModal(page, /Open Exception/i);
    await page.getByLabel(/Exception Reason/i).first().fill("E2E certification exception");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT exception_status FROM bank_transactions WHERE id = $1 AND tenant_id = $2`, [s.bankTxnExceptionNone, TENANT_ID]));
    expect(row.rows[0].exception_status, "bank_transactions.exception_status must be open").toBe("open");
    await expectBoundaryUnchanged(TENANT_ID, before, "bankTxnExceptionNone-open-exception");
  });

  test("[Bank Recon] bankTxnExceptionOpen: Resolve Exception → exception_status != open", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/bank-reconciliation/transactions/${s.bankTxnExceptionOpen}`, "bank");
    const before = await captureBoundaryCounts(TENANT_ID, ["accounting_export_batches", "accounting_export_items", "payment_applications"]);
    await openAction(page, /Resolve Exception/i);
    await expectModal(page, /Resolve Exception/i);
    await page.getByLabel(/Resolution Note/i).first().fill("E2E certification exception resolved");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT exception_status FROM bank_transactions WHERE id = $1 AND tenant_id = $2`, [s.bankTxnExceptionOpen, TENANT_ID]));
    expect(row.rows[0].exception_status, "bank_transactions.exception_status must not be open after resolve").not.toBe("open");
    await expectBoundaryUnchanged(TENANT_ID, before, "bankTxnExceptionOpen-resolve-exception");
  });

  test("[Bank Recon] bankTxnIgnorable: Ignore → reconciliation_status=ignored", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/bank-reconciliation/transactions/${s.bankTxnIgnorable}`, "bank");
    const before = await captureBoundaryCounts(TENANT_ID, ["accounting_export_batches", "accounting_export_items", "payment_applications"]);
    await openAction(page, /Ignore Transaction/i);
    await expectModal(page, /Ignore Transaction/i);
    await page.getByLabel(/Ignore Reason/i).first().fill("E2E certification ignore");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT reconciliation_status FROM bank_transactions WHERE id = $1 AND tenant_id = $2`, [s.bankTxnIgnorable, TENANT_ID]));
    expect(row.rows[0].reconciliation_status, "bank_transactions.reconciliation_status must be ignored").toBe("ignored");
    await expectBoundaryUnchanged(TENANT_ID, before, "bankTxnIgnorable-ignore");
  });

  test("[Bank Recon] reconMatchProposed: Review → match_status=reviewed", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/reconciliation-matches/${s.reconMatchProposed}`, "bank");
    const before = await captureBoundaryCounts(TENANT_ID, ["accounting_export_batches", "accounting_export_items", "payment_applications"]);
    await openAction(page, /^Review$/i);
    await expectModal(page, /Review Match/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT match_status FROM reconciliation_matches WHERE id = $1 AND tenant_id = $2`, [s.reconMatchProposed, TENANT_ID]));
    expect(row.rows[0].match_status, "reconciliation_matches.match_status must be reviewed").toBe("reviewed");
    await expectBoundaryUnchanged(TENANT_ID, before, "reconMatchProposed-review");
  });

  // ── Cash / Payment Application ─────────────────────────────────────────────────
  // NOTE: Cash tests run here before Invoice section to ensure invoiceApproved
  // is still in "approved" status when used as an Apply To Invoice target.

  test("[Cash] cashReceiptUnapplied: Apply To Invoice → payment_application created", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    // Invoice must be ready for cash application before applying; set it up here
    await withDb((c) => c.query(`UPDATE invoices SET cash_application_status = 'ready_for_cash_application' WHERE id = $1 AND tenant_id = $2`, [INVOICE_APPROVED_ID, TENANT_ID]));
    await expectRouteHealthy(page, `/cash/receipts/${CASH_RECEIPT_UNAPPLIED_ID}`, "cash");
    const before = await captureBoundaryCounts(TENANT_ID, ["payroll_runs", "contractor_payables", "bank_transactions", "accounting_export_batches"]);
    const appsBefore = await withDb((c) => c.query(`SELECT count(*)::int AS count FROM payment_applications WHERE cash_receipt_id = $1 AND tenant_id = $2`, [CASH_RECEIPT_UNAPPLIED_ID, TENANT_ID]));
    await openAction(page, /Apply.*Invoice|Apply Payment/i);
    await expectModal(page, /Apply.*Invoice/i);
    await page.getByLabel(/Invoice ID/i).first().fill(INVOICE_APPROVED_ID);
    await page.getByLabel(/Applied Amount/i).first().fill("100");
    await submitModal(page);
    const appsAfter = await withDb((c) => c.query(`SELECT count(*)::int AS count FROM payment_applications WHERE cash_receipt_id = $1 AND tenant_id = $2`, [CASH_RECEIPT_UNAPPLIED_ID, TENANT_ID]));
    expect(appsAfter.rows[0].count, "payment_applications count must increase after apply").toBeGreaterThan(appsBefore.rows[0].count);
    await expectBoundaryUnchanged(TENANT_ID, before, "cashReceiptUnapplied-apply-invoice");
  });

  test("[Cash] cashReceiptVoidTarget: Void → receipt_status=voided", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/cash/receipts/${s.cashReceiptVoidTarget}`, "cash");
    const before = await captureBoundaryCounts(TENANT_ID, ["payroll_runs", "contractor_payables", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /^Void$/i);
    await expectModal(page, /Void Receipt/i);
    await page.getByLabel(/Void Reason/i).first().fill("E2E certification void");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT receipt_status FROM cash_receipts WHERE id = $1 AND tenant_id = $2`, [s.cashReceiptVoidTarget, TENANT_ID]));
    expect(row.rows[0].receipt_status, "cash_receipts.receipt_status must be voided").toBe("voided");
    await expectBoundaryUnchanged(TENANT_ID, before, "cashReceiptVoidTarget-void");
  });

  test("[Cash] cashReceiptVoid: Archive → receipt_status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/cash/receipts/${s.cashReceiptVoid}`, "cash");
    const before = await captureBoundaryCounts(TENANT_ID, ["payroll_runs", "contractor_payables", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive Receipt/i);
    await page.getByLabel(/Archive Reason/i).first().fill("E2E certification archive");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT receipt_status FROM cash_receipts WHERE id = $1 AND tenant_id = $2`, [s.cashReceiptVoid, TENANT_ID]));
    expect(row.rows[0].receipt_status, "cash_receipts.receipt_status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "cashReceiptVoid-archive");
  });

  test("[Cash] paymentApplicationApplied: Void → application_status=voided", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payment-applications/${s.paymentApplicationApplied}`, "cash");
    const before = await captureBoundaryCounts(TENANT_ID, ["payroll_runs", "contractor_payables", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Void Application/i);
    await expectModal(page, /Void Payment Application/i);
    await page.getByLabel(/Void Reason/i).first().fill("E2E certification void");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT application_status FROM payment_applications WHERE id = $1 AND tenant_id = $2`, [s.paymentApplicationApplied, TENANT_ID]));
    expect(row.rows[0].application_status, "payment_applications.application_status must be voided").toBe("voided");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentApplicationApplied-void");
  });

  test("[Cash] paymentApplicationVoid: Archive → application_status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payment-applications/${s.paymentApplicationVoid}`, "cash");
    const before = await captureBoundaryCounts(TENANT_ID, ["payroll_runs", "contractor_payables", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Archive Application/i);
    await expectModal(page, /Archive Payment Application/i);
    await page.getByLabel(/Archive Reason/i).first().fill("E2E certification archive");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT application_status FROM payment_applications WHERE id = $1 AND tenant_id = $2`, [s.paymentApplicationVoid, TENANT_ID]));
    expect(row.rows[0].application_status, "payment_applications.application_status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentApplicationVoid-archive");
  });

  // ── Invoice ───────────────────────────────────────────────────────────────────
  // NOTE: Invoice tests run after Cash section. cashReceiptUnapplied:Apply uses
  // invoiceApproved while it is still "approved"; Mark Sent runs here afterward.

  test("[Invoice] invoiceDraft: Submit Review → status=ready_for_review", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.billingManager.storageState);
    await expectRouteHealthy(page, `/invoices/${s.invoiceDraft}`, "invoice");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Submit.*Review/i);
    await expectModal(page, /Submit Review/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM invoices WHERE id = $1 AND tenant_id = $2`, [s.invoiceDraft, TENANT_ID]));
    expect(row.rows[0].status, "invoices.status must be ready_for_review").toBe("ready_for_review");
    await expectBoundaryUnchanged(TENANT_ID, before, "invoiceDraft-submit-review");
  });

  test("[Invoice] invoiceItemDraft: Reject → approval_status=rejected", async ({ page }) => {
    // Reject has no invoice-status restriction (API) and the button is enabled for non-voided invoices (UI).
    // This test runs after invoiceDraft:Submit Review (invoice is now ready_for_review); Reject still works.
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/invoices/${s.invoiceDraft}`, "invoice");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /^Reject$/i);
    await expectModal(page, /Reject/i);
    await page.getByLabel(/Rejection Reason/i).first().fill("E2E certification invoice item rejection");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT approval_status FROM invoices WHERE id = $1 AND tenant_id = $2`, [s.invoiceDraft, TENANT_ID]));
    expect(row.rows[0].approval_status, "invoices.approval_status must be rejected").toBe("rejected");
    await expectBoundaryUnchanged(TENANT_ID, before, "invoiceItemDraft-reject");
  });

  test("[Invoice] invoiceUnderReview: Reject → status=rejected", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/invoices/${s.invoiceUnderReview}`, "invoice");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /^Reject$/i);
    await expectModal(page, /Reject/i);
    await page.getByLabel(/Rejection Reason/i).first().fill("E2E certification invoice rejection");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT approval_status FROM invoices WHERE id = $1 AND tenant_id = $2`, [s.invoiceUnderReview, TENANT_ID]));
    expect(row.rows[0].approval_status, "invoices.approval_status must be rejected after reject action").toBe("rejected");
    await expectBoundaryUnchanged(TENANT_ID, before, "invoiceUnderReview-reject");
  });

  test("[Invoice] invoiceApproved: Mark Sent → status=sent", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/invoices/${s.invoiceApproved}`, "invoice");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Mark Sent/i);
    await expectModal(page, /Mark Sent/i);
    await page.getByLabel(/Sent Note/i).first().fill("E2E certification invoice sent");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM invoices WHERE id = $1 AND tenant_id = $2`, [s.invoiceApproved, TENANT_ID]));
    expect(row.rows[0].status, "invoices.status must be sent").toBe("sent");
    await expectBoundaryUnchanged(TENANT_ID, before, "invoiceApproved-mark-sent");
  });

  test("[Invoice] invoiceDisputed: Resolve Dispute → status != disputed", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/invoices/${s.invoiceDisputed}`, "invoice");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Resolve Dispute/i);
    await expectModal(page, /Resolve Dispute/i);
    await page.getByLabel(/Resolution Note/i).first().fill("E2E certification invoice dispute resolution");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM invoices WHERE id = $1 AND tenant_id = $2`, [s.invoiceDisputed, TENANT_ID]));
    expect(row.rows[0].status, "invoices.status must not be disputed after resolve").not.toBe("disputed");
    await expectBoundaryUnchanged(TENANT_ID, before, "invoiceDisputed-resolve-dispute");
  });

  test("[Invoice] invoiceVoid: Archive → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/invoices/${s.invoiceVoid}`, "invoice");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive/i);
    await page.getByLabel(/Archive Reason/i).first().fill("E2E certification invoice archive");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM invoices WHERE id = $1 AND tenant_id = $2`, [s.invoiceVoid, TENANT_ID]));
    expect(row.rows[0].status, "invoices.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "invoiceVoid-archive");
  });

  // ── Settlement ────────────────────────────────────────────────────────────────

  test("[Settlement] settlementDraft: Submit Review → status=ready_for_review", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/settlements/${s.settlementDraft}`, "settlement");
    const before = await captureBoundaryCounts(TENANT_ID, ["invoices", "payment_batches", "payroll_runs", "cash_receipts", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Submit.*Review/i);
    await expectModal(page, /Submit Review/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM settlements WHERE id = $1 AND tenant_id = $2`, [s.settlementDraft, TENANT_ID]));
    expect(row.rows[0].status, "settlements.status must be ready_for_review").toBe("ready_for_review");
    await expectBoundaryUnchanged(TENANT_ID, before, "settlementDraft-submit-review");
  });

  test("[Settlement] settlementUnderReview: Reject → status=rejected", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/settlements/${s.settlementUnderReview}`, "settlement");
    const before = await captureBoundaryCounts(TENANT_ID, ["invoices", "payment_batches", "payroll_runs", "cash_receipts", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /^Reject$/i);
    await expectModal(page, /Reject/i);
    await page.getByLabel(/Rejection Reason/i).first().fill("E2E certification rejection");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM settlements WHERE id = $1 AND tenant_id = $2`, [s.settlementUnderReview, TENANT_ID]));
    expect(row.rows[0].status, "settlements.status must be rejected").toBe("rejected");
    await expectBoundaryUnchanged(TENANT_ID, before, "settlementUnderReview-reject");
  });

  test("[Settlement] settlementApproved: Mark Invoice Ready → invoice_ready", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/settlements/${s.settlementApproved}`, "settlement");
    const before = await captureBoundaryCounts(TENANT_ID, ["invoices", "payment_batches", "payroll_runs", "cash_receipts", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Mark Invoice Ready/i);
    await expectModal(page, /Mark Invoice Ready/i);
    await page.getByLabel(/Ready Note/i).first().fill("E2E certification invoice ready");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status, invoice_ready FROM settlements WHERE id = $1 AND tenant_id = $2`, [s.settlementApproved, TENANT_ID]));
    expect(
      row.rows[0].status === "invoice_ready" || row.rows[0].invoice_ready === true,
      "settlement must be invoice_ready after mark_invoice_ready",
    ).toBe(true);
    await expectBoundaryUnchanged(TENANT_ID, before, "settlementApproved-mark-invoice-ready");
  });

  test("[Settlement] settlementDisputed: Resolve Dispute → status != disputed", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/settlements/${s.settlementDisputed}`, "settlement");
    const before = await captureBoundaryCounts(TENANT_ID, ["invoices", "payment_batches", "payroll_runs", "cash_receipts", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /Resolve Dispute/i);
    await expectModal(page, /Resolve Dispute/i);
    await page.getByLabel(/Resolution Note/i).first().fill("E2E certification settlement dispute resolution");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM settlements WHERE id = $1 AND tenant_id = $2`, [s.settlementDisputed, TENANT_ID]));
    expect(row.rows[0].status, "settlements.status must not be disputed after resolve").not.toBe("disputed");
    await expectBoundaryUnchanged(TENANT_ID, before, "settlementDisputed-resolve-dispute");
  });

  test("[Settlement] settlementVoid: Archive → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/settlements/${s.settlementVoid}`, "settlement");
    const before = await captureBoundaryCounts(TENANT_ID, ["invoices", "payment_batches", "payroll_runs", "cash_receipts", "bank_transactions", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive/i);
    await page.getByLabel(/Archive Reason/i).first().fill("E2E certification settlement archive");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM settlements WHERE id = $1 AND tenant_id = $2`, [s.settlementVoid, TENANT_ID]));
    expect(row.rows[0].status, "settlements.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "settlementVoid-archive");
  });

  // ── Collections ───────────────────────────────────────────────────────────────

  test("[Collections] collectionCaseOpen: Assign Owner → assigned_owner_user_id set", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/collections/${s.collectionCaseOpen}`, "collections");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_applications", "accounting_export_batches"]);
    await openAction(page, /Assign Owner/i);
    await expectModal(page, /Assign Owner/i);
    await page.getByPlaceholder(/Assigned owner user ID/i).fill(COLLECTIONS_SPECIALIST_USER_ID);
    await page.getByLabel(/Assignment Note/i).first().fill("E2E certification owner assignment");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT assigned_owner_user_id FROM collection_cases WHERE id = $1 AND tenant_id = $2`, [s.collectionCaseOpen, TENANT_ID]));
    expect(row.rows[0].assigned_owner_user_id, "collection_cases.assigned_owner_user_id must be set").not.toBeNull();
    await expectBoundaryUnchanged(TENANT_ID, before, "collectionCaseOpen-assign-owner");
  });

  test("[Collections] collectionCaseClosed: Archive → case_status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/collections/${s.collectionCaseClosed}`, "collections");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_applications", "accounting_export_batches"]);
    await openAction(page, /Archive Case/i);
    await expectModal(page, /Archive Case/i);
    await fillArchiveReason(page);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT case_status FROM collection_cases WHERE id = $1 AND tenant_id = $2`, [s.collectionCaseClosed, TENANT_ID]));
    expect(row.rows[0].case_status, "collection_cases.case_status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "collectionCaseClosed-archive");
  });

  test("[Collections] collectionActionPlanned: Complete → action_status=completed", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/collection-actions/${s.collectionActionPlanned}`, "collections");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_applications", "accounting_export_batches"]);
    await openAction(page, /Complete Action/i);
    await expectModal(page, /Complete Action/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT action_status FROM collection_actions WHERE id = $1 AND tenant_id = $2`, [s.collectionActionPlanned, TENANT_ID]));
    expect(row.rows[0].action_status, "collection_actions.action_status must be completed").toBe("completed");
    await expectBoundaryUnchanged(TENANT_ID, before, "collectionActionPlanned-complete");
  });

  test("[Collections] collectionActionCompleted: Archive Action → action_status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/collection-actions/${s.collectionActionCompleted}`, "collections");
    const before = await captureBoundaryCounts(TENANT_ID, ["cash_receipts", "payment_applications", "accounting_export_batches"]);
    await openAction(page, /Archive Action/i);
    await expectModal(page, /Archive Action/i);
    await fillArchiveReason(page);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT action_status FROM collection_actions WHERE id = $1 AND tenant_id = $2`, [s.collectionActionCompleted, TENANT_ID]));
    expect(row.rows[0].action_status, "collection_actions.action_status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "collectionActionCompleted-archive");
  });

  // ── Contractor Payable ────────────────────────────────────────────────────────

  test("[Contractor Payable] cpayDraft: Submit Review → status=ready_for_review", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/contractor-payables/${s.cpayDraft}`, "contractor");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Submit.*Review/i);
    await expectModal(page, /Submit Review/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM contractor_payables WHERE id = $1 AND tenant_id = $2`, [s.cpayDraft, TENANT_ID]));
    expect(row.rows[0].status, "contractor_payables.status must be ready_for_review").toBe("ready_for_review");
    await expectBoundaryUnchanged(TENANT_ID, before, "cpayDraft-submit-review");
  });

  test("[Contractor Payable] cpayUnderReview: Approve → status=approved", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/contractor-payables/${s.cpayUnderReview}`, "contractor");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /^Approve$/i);
    await expectModal(page, /Approve.*Payable/i);
    await page.getByLabel(/Approval Note/i).first().fill("E2E certification approval");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM contractor_payables WHERE id = $1 AND tenant_id = $2`, [s.cpayUnderReview, TENANT_ID]));
    expect(row.rows[0].status, "contractor_payables.status must be approved").toBe("approved");
    await expectBoundaryUnchanged(TENANT_ID, before, "cpayUnderReview-approve");
  });

  test("[Contractor Payable] cpayApproved: Mark Payment Ready → payment_readiness_status=ready_for_payment", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/contractor-payables/${s.cpayApproved}`, "contractor");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Mark Payment Ready/i);
    await expectModal(page, /Mark Payment Ready/i);
    await page.getByLabel(/Ready Note/i).first().fill("E2E certification payment ready");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT payment_readiness_status FROM contractor_payables WHERE id = $1 AND tenant_id = $2`, [s.cpayApproved, TENANT_ID]));
    expect(row.rows[0].payment_readiness_status, "contractor_payables.payment_readiness_status must be ready_for_payment").toBe("ready_for_payment");
    await expectBoundaryUnchanged(TENANT_ID, before, "cpayApproved-mark-payment-ready");
  });

  test("[Contractor Payable] cpayDisputed: Resolve Dispute → status != disputed", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/contractor-payables/${s.cpayDisputed}`, "contractor");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /Resolve Dispute/i);
    await expectModal(page, /Resolve Dispute/i);
    await page.getByLabel(/Resolution Note/i).first().fill("E2E certification dispute resolution");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM contractor_payables WHERE id = $1 AND tenant_id = $2`, [s.cpayDisputed, TENANT_ID]));
    expect(row.rows[0].status, "contractor_payables.status must not be disputed after resolve").not.toBe("disputed");
    await expectBoundaryUnchanged(TENANT_ID, before, "cpayDisputed-resolve-dispute");
  });

  test("[Contractor Payable] cpayVoid: Archive → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/contractor-payables/${s.cpayVoid}`, "contractor");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "payroll_runs", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive.*Payable/i);
    await page.getByLabel(/Archive Reason/i).first().fill("E2E certification archive");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM contractor_payables WHERE id = $1 AND tenant_id = $2`, [s.cpayVoid, TENANT_ID]));
    expect(row.rows[0].status, "contractor_payables.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "cpayVoid-archive");
  });

  // ── Payroll ───────────────────────────────────────────────────────────────────

  test("[Payroll] payrollDraft: Submit Review → status=ready_for_review", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payroll/${s.payrollDraft}`, "payroll");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "contractor_payables", "accounting_export_batches"]);
    await openAction(page, /Submit.*Review/i);
    await expectModal(page, /Submit Review/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [s.payrollDraft, TENANT_ID]));
    expect(row.rows[0].status, "payroll_runs.status must be ready_for_review").toBe("ready_for_review");
    await expectBoundaryUnchanged(TENANT_ID, before, "payrollDraft-submit-review");
  });

  test("[Payroll] payrollUnderReview: Approve → status=approved", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payroll/${s.payrollUnderReview}`, "payroll");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "contractor_payables", "accounting_export_batches"]);
    await openAction(page, /^Approve$/i);
    await expectModal(page, /Approve Payroll/i);
    await page.getByLabel(/Approval Note/i).first().fill("E2E certification payroll approval");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [s.payrollUnderReview, TENANT_ID]));
    expect(row.rows[0].status, "payroll_runs.status must be approved").toBe("approved");
    await expectBoundaryUnchanged(TENANT_ID, before, "payrollUnderReview-approve");
  });

  test("[Payroll] payrollApproved: Mark Payroll Ready → payroll_readiness_status=ready_for_payroll", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payroll/${s.payrollApproved}`, "payroll");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "contractor_payables", "accounting_export_batches"]);
    await openAction(page, /Mark Payroll Ready/i);
    await expectModal(page, /Mark Payroll Ready/i);
    await page.getByLabel(/Ready Note/i).first().fill("E2E certification payroll ready");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT payroll_readiness_status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [s.payrollApproved, TENANT_ID]));
    expect(row.rows[0].payroll_readiness_status, "payroll_runs.payroll_readiness_status must be ready_for_payroll").toBe("ready_for_payroll");
    await expectBoundaryUnchanged(TENANT_ID, before, "payrollApproved-mark-payroll-ready");
  });

  test("[Payroll] payrollDisputed: Resolve Dispute → status != disputed", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payroll/${s.payrollDisputed}`, "payroll");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "contractor_payables", "accounting_export_batches"]);
    await openAction(page, /Resolve Dispute/i);
    await expectModal(page, /Resolve Dispute/i);
    await page.getByLabel(/Resolution Note/i).first().fill("E2E certification payroll dispute resolution");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [s.payrollDisputed, TENANT_ID]));
    expect(row.rows[0].status, "payroll_runs.status must not be disputed after resolve").not.toBe("disputed");
    await expectBoundaryUnchanged(TENANT_ID, before, "payrollDisputed-resolve-dispute");
  });

  test("[Payroll] payrollVoid: Archive → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payroll/${s.payrollVoid}`, "payroll");
    const before = await captureBoundaryCounts(TENANT_ID, ["payment_batches", "bank_transactions", "contractor_payables", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive Payroll/i);
    await page.getByLabel(/Archive Reason/i).first().fill("E2E certification archive");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [s.payrollVoid, TENANT_ID]));
    expect(row.rows[0].status, "payroll_runs.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "payrollVoid-archive");
  });

  // ── Payment Execution ─────────────────────────────────────────────────────────
  // NOTE: bankTxnUnmatchedDebit now matches against bankReconPaymentBatch (not
  // paymentBatchScheduled). paymentBatchScheduled is independently ready for
  // Submit Execution via its corrected execution_status seed.

  test("[Payment Execution] paymentBatchDraft: Submit Review → status=ready_for_review", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payments/${s.paymentBatchDraft}`, "payment");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await openAction(page, /Submit.*Review/i);
    await expectModal(page, /Submit Review/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payment_batches WHERE id = $1 AND tenant_id = $2`, [s.paymentBatchDraft, TENANT_ID]));
    expect(row.rows[0].status, "payment_batches.status must be ready_for_review").toBe("ready_for_review");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentBatchDraft-submit-review");
  });

  test("[Payment Execution] paymentItemDraft: Archive Item → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payment-items/${s.paymentItemDraft}`, "payment");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await openAction(page, /Archive Item/i);
    await expectModal(page, /Archive Payment Item/i);
    await fillArchiveReason(page);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payment_items WHERE id = $1 AND tenant_id = $2`, [s.paymentItemDraft, TENANT_ID]));
    expect(row.rows[0].status, "payment_items.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentItemDraft-archive");
  });

  test("[Payment Execution] paymentBatchUnderReview: Approve → status=approved", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payments/${s.paymentBatchUnderReview}`, "payment");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await openAction(page, /^Approve$/i);
    await expectModal(page, /Approve.*Batch/i);
    await page.getByLabel(/Approval Note/i).first().fill("E2E certification approval");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payment_batches WHERE id = $1 AND tenant_id = $2`, [s.paymentBatchUnderReview, TENANT_ID]));
    expect(row.rows[0].status, "payment_batches.status must be approved").toBe("approved");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentBatchUnderReview-approve");
  });

  test("[Payment Execution] paymentBatchApproved: Schedule → status=scheduled [deferred-fix]", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payments/${s.paymentBatchApproved}`, "payment");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await openAction(page, /^Schedule$/i);
    await expectModal(page, /Schedule/i);
    await page.getByLabel(/Scheduled Payment Date/i).first().fill("2026-12-15");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payment_batches WHERE id = $1 AND tenant_id = $2`, [s.paymentBatchApproved, TENANT_ID]));
    expect(row.rows[0].status, "payment_batches.status must be scheduled").toBe("scheduled");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentBatchApproved-schedule");
  });

  test("[Payment Execution] paymentBatchVoidTarget: Void → status=voided [deferred-fix]", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payments/${s.paymentBatchVoidTarget}`, "payment");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await openAction(page, /^Void$/i);
    await expectModal(page, /Void Payment Batch/i);
    await page.getByLabel(/Void Reason/i).first().fill("E2E certification void");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payment_batches WHERE id = $1 AND tenant_id = $2`, [s.paymentBatchVoidTarget, TENANT_ID]));
    expect(row.rows[0].status, "payment_batches.status must be voided").toBe("voided");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentBatchVoidTarget-void");
  });

  test("[Payment Execution] paymentBatchScheduled: Submit Execution → status=submitted", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payments/${PAYMENT_BATCH_SCHEDULED_ID}`, "payment");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await openAction(page, /Submit Execution/i);
    await expectModal(page, /Submit Execution/i);
    await page.getByLabel(/Submit Note/i).first().fill("E2E certification execution submission");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payment_batches WHERE id = $1 AND tenant_id = $2`, [PAYMENT_BATCH_SCHEDULED_ID, TENANT_ID]));
    expect(row.rows[0].status, "payment_batches.status must be submitted").toBe("submitted");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentBatchScheduled-submit-execution");
  });

  test("[Payment Execution] paymentBatchExecutionSubmitted: Mark Executed → status=executed_later", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payments/${s.paymentBatchExecutionSubmitted}`, "payment");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await openAction(page, /Mark Executed/i);
    await expectModal(page, /Mark Executed/i);
    await page.getByLabel(/Execution Reference/i).first().fill("E2E-EXEC-REF-001");
    await page.getByLabel(/Execution Note/i).first().fill("E2E certification executed");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payment_batches WHERE id = $1 AND tenant_id = $2`, [s.paymentBatchExecutionSubmitted, TENANT_ID]));
    expect(row.rows[0].status, "payment_batches.status must be executed_later").toBe("executed_later");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentBatchExecutionSubmitted-mark-executed");
  });

  test("[Payment Execution] paymentBatchVoid: Archive → status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/payments/${s.paymentBatchVoid}`, "payment");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await openAction(page, /^Archive$/i);
    await expectModal(page, /Archive.*Batch/i);
    await page.getByLabel(/Archive Reason/i).first().fill("E2E certification archive");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM payment_batches WHERE id = $1 AND tenant_id = $2`, [s.paymentBatchVoid, TENANT_ID]));
    expect(row.rows[0].status, "payment_batches.status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "paymentBatchVoid-archive");
  });

  // ── Accounting Export ─────────────────────────────────────────────────────────

  test("[Accounting Export] aexDraft: Submit Review → status=ready_for_review", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/accounting-exports/${s.aexDraft}`, "accounting");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "payment_batches", "payments", "ar_records"]);
    await openAction(page, /Submit Review/i);
    await expectModal(page, /Submit Review/i);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM accounting_export_batches WHERE id = $1 AND tenant_id = $2`, [s.aexDraft, TENANT_ID]));
    expect(row.rows[0].status, "accounting_export_batches.status must be ready_for_review").toBe("ready_for_review");
    await expectBoundaryUnchanged(TENANT_ID, before, "aexDraft-submit-review");
  });

  test("[Accounting Export] aexItemDraft: Archive Item → export_status=archived", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/accounting-export-items/${s.aexItemDraft}`, "accounting");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "payment_batches", "payments", "ar_records"]);
    await openAction(page, /Archive Item/i);
    await expectModal(page, /Archive Item/i);
    await fillArchiveReason(page);
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT export_status FROM accounting_export_items WHERE id = $1 AND tenant_id = $2`, [s.aexItemDraft, TENANT_ID]));
    expect(row.rows[0].export_status, "accounting_export_items.export_status must be archived").toBe("archived");
    await expectBoundaryUnchanged(TENANT_ID, before, "aexItemDraft-archive");
  });

  test("[Accounting Export] aexGenerated: Mark Submitted → export_status=submitted_later", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/accounting-exports/${s.aexGenerated}`, "accounting");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "payment_batches", "payments", "ar_records"]);
    await openAction(page, /Mark Submitted/i);
    await expectModal(page, /Mark Submitted/i);
    await page.getByLabel(/Submit Note/i).first().fill("E2E certification submission");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT export_status FROM accounting_export_batches WHERE id = $1 AND tenant_id = $2`, [s.aexGenerated, TENANT_ID]));
    expect(row.rows[0].export_status, "accounting_export_batches.export_status must be submitted_later").toBe("submitted_later");
    await expectBoundaryUnchanged(TENANT_ID, before, "aexGenerated-mark-submitted");
  });

  test("[Accounting Export] aexUnderReview: Approve → approval_status=approved", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/accounting-exports/${s.aexUnderReview}`, "accounting");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "payment_batches", "payments", "ar_records"]);
    await openAction(page, /^Approve$/i);
    await expectModal(page, /Approve/i);
    await page.getByLabel(/Approval Note/i).first().fill("E2E certification approval");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT approval_status FROM accounting_export_batches WHERE id = $1 AND tenant_id = $2`, [s.aexUnderReview, TENANT_ID]));
    expect(row.rows[0].approval_status, "accounting_export_batches.approval_status must be approved").toBe("approved");
    await expectBoundaryUnchanged(TENANT_ID, before, "aexUnderReview-approve");
  });

  test("[Accounting Export] aexSubmitted: Mark Accepted → export_status=accepted_later", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/accounting-exports/${s.aexSubmitted}`, "accounting");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "payment_batches", "payments", "ar_records"]);
    await openAction(page, /Mark Accepted/i);
    await expectModal(page, /Mark Accepted/i);
    await page.getByLabel(/Acceptance Note/i).first().fill("E2E certification accepted");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT export_status FROM accounting_export_batches WHERE id = $1 AND tenant_id = $2`, [s.aexSubmitted, TENANT_ID]));
    expect(row.rows[0].export_status, "accounting_export_batches.export_status must be accepted_later").toBe("accepted_later");
    await expectBoundaryUnchanged(TENANT_ID, before, "aexSubmitted-mark-accepted");
  });

  test("[Accounting Export] aexCancelable: Cancel → status=cancelled", async ({ page }) => {
    test.slow();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, `/accounting-exports/${s.aexCancelable}`, "accounting");
    const before = await captureBoundaryCounts(TENANT_ID, ["bank_transactions", "payment_batches", "payments", "ar_records"]);
    await openAction(page, /^Cancel$/i);
    await expectModal(page, /Cancel/i);
    await page.getByLabel(/Cancel Reason/i).first().fill("E2E certification cancel");
    await submitModal(page);
    const row = await withDb((c) => c.query(`SELECT status FROM accounting_export_batches WHERE id = $1 AND tenant_id = $2`, [s.aexCancelable, TENANT_ID]));
    expect(row.rows[0].status, "accounting_export_batches.status must be cancelled").toBe("cancelled");
    await expectBoundaryUnchanged(TENANT_ID, before, "aexCancelable-cancel");
  });
});
