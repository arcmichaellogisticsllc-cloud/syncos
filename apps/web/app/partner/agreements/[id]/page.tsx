import { PartnerShell } from "../../partner-shell";

export default function PartnerAgreementDetailPage({ params }: { params: { id: string } }) {
  return <PartnerShell section="agreement-detail" itemId={params.id} />;
}
