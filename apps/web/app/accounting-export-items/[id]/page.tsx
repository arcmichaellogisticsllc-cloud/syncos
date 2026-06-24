import { AccountingExportItemDetail } from "../../accounting-exports/accounting-export-workspace";

export default function AccountingExportItemPage({ params }: { params: { id: string } }) {
  return <AccountingExportItemDetail accountingExportItemId={params.id} />;
}
