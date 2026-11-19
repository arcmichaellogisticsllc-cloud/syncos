import { PartnerShell } from "../../partner-shell";

export default async function PartnerWorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <PartnerShell section="worker-detail" itemId={(await params).id} />;
}
