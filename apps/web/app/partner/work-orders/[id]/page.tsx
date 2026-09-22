import { PartnerShell } from "../../partner-shell";

export default async function PartnerWorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <PartnerShell section="work-order-detail" itemId={(await params).id} />;
}
