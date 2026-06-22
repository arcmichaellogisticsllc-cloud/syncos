import { SettlementEdit } from "../../settlement-workspace";

export default function SettlementEditPage({ params }: { params: { id: string } }) {
  return <SettlementEdit settlementId={params.id} />;
}
