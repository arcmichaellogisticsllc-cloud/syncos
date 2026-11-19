import { CashReceiptDetail } from "../../cash-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CashReceiptDetail receiptId={(await params).id} />;
}
