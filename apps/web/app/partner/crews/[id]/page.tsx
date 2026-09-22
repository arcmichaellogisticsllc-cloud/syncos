import { PartnerShell } from "../../partner-shell";

export default async function PartnerCrewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <PartnerShell section="crew-detail" itemId={(await params).id} />;
}
