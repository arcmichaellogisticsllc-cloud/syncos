export const productionForbidden = ["settlements", "invoices", "payment_batches", "payroll_runs", "bank_transactions", "accounting_export_batches"];
export const invoiceForbidden = ["cash_receipts", "payment_batches", "bank_transactions", "payroll_runs", "ar_records", "payments"];
export const cashForbidden = ["payroll_runs", "contractor_payables", "bank_transactions", "accounting_export_batches"];
export const collectionsForbidden = ["cash_receipts", "payment_applications", "accounting_export_batches"];
export const paymentExecutionForbidden = ["bank_transactions", "reconciliation_matches", "accounting_export_batches"];
export const bankReconciliationForbidden = ["accounting_export_batches", "accounting_export_items", "payment_applications"];
export const accountingExportForbidden = ["bank_transactions", "payment_batches", "payments", "ar_records"];
