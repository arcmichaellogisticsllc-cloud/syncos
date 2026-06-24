import { ReconciliationMatchDetail } from "../../bank-reconciliation/bank-reconciliation-workspace";

export default async function ReconciliationMatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReconciliationMatchDetail matchId={id} />;
}
