import { PartnerShell } from "../../partner-shell";

export default function PartnerCrewDetailPage({ params }: { params: { id: string } }) {
  return <PartnerShell section="crew-detail" itemId={params.id} />;
}
