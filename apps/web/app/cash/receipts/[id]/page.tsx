import { CashReceiptDetail } from "../../cash-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <CashReceiptDetail receiptId={params.id} />;
}
