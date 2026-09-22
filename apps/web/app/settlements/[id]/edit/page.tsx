import { SettlementEdit } from "../../settlement-workspace";

export default async function SettlementEditPage({ params }: { params: Promise<{ id: string }> }) {
  return <SettlementEdit settlementId={(await params).id} />;
}
