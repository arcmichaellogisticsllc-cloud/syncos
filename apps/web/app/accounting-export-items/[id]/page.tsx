import { AccountingExportItemDetail } from "../../accounting-exports/accounting-export-workspace";

export default async function AccountingExportItemPage({ params }: { params: Promise<{ id: string }> }) {
  return <AccountingExportItemDetail accountingExportItemId={(await params).id} />;
}
