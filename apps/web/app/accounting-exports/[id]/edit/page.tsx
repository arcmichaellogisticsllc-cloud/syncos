import { AccountingExportEdit } from "../../accounting-export-workspace";

export default async function EditAccountingExportPage({ params }: { params: Promise<{ id: string }> }) {
  return <AccountingExportEdit accountingExportBatchId={(await params).id} />;
}
