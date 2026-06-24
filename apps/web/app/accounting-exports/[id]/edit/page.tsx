import { AccountingExportEdit } from "../../accounting-export-workspace";

export default function EditAccountingExportPage({ params }: { params: { id: string } }) {
  return <AccountingExportEdit accountingExportBatchId={params.id} />;
}
