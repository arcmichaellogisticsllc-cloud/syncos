import { BankAccountEdit } from "../../../bank-reconciliation-workspace";

export default async function BankAccountEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BankAccountEdit accountId={id} />;
}
