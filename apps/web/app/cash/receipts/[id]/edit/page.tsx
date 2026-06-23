import { CashReceiptEdit } from "../../../cash-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <CashReceiptEdit receiptId={params.id} />;
}
