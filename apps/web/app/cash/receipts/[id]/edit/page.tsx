import { CashReceiptEdit } from "../../../cash-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CashReceiptEdit receiptId={(await params).id} />;
}
