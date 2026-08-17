import { PartnerShell } from "../../partner-shell";

export default function PartnerWorkerDetailPage({ params }: { params: { id: string } }) {
  return <PartnerShell section="worker-detail" itemId={params.id} />;
}
