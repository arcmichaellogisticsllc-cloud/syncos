import { BankTransactionEdit } from "../../../bank-reconciliation-workspace";

export default async function BankTransactionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BankTransactionEdit transactionId={id} />;
}
