import { BankTransactionDetail } from "../../bank-reconciliation-workspace";

export default async function BankTransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BankTransactionDetail transactionId={id} />;
}
