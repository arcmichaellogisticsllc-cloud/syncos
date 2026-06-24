import { AccountingExportDetail } from "../accounting-export-workspace";

export default function AccountingExportDetailPage({ params }: { params: { id: string } }) {
  return <AccountingExportDetail accountingExportBatchId={params.id} />;
}
