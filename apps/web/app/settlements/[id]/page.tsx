import { SettlementDetail } from "../settlement-workspace";

export default async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <SettlementDetail settlementId={(await params).id} />;
}
