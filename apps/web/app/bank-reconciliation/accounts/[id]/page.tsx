import { BankAccountDetail } from "../../bank-reconciliation-workspace";

export default async function BankAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BankAccountDetail accountId={id} />;
}
