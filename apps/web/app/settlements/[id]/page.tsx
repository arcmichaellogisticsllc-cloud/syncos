import { SettlementDetail } from "../settlement-workspace";

export default function SettlementDetailPage({ params }: { params: { id: string } }) {
  return <SettlementDetail settlementId={params.id} />;
}
