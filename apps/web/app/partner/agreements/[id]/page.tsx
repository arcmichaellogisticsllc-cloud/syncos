import { PartnerShell } from "../../partner-shell";

export default async function PartnerAgreementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <PartnerShell section="agreement-detail" itemId={(await params).id} />;
}
