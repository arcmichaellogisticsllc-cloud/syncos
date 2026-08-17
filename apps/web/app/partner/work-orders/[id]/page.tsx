import { PartnerShell } from "../../partner-shell";

export default function PartnerWorkOrderDetailPage({ params }: { params: { id: string } }) {
  return <PartnerShell section="work-order-detail" itemId={params.id} />;
}
