import { AccountingExportDetail } from "../accounting-export-workspace";

export default async function AccountingExportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <AccountingExportDetail accountingExportBatchId={(await params).id} />;
}
