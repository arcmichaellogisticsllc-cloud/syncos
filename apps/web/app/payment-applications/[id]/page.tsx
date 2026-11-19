import { PaymentApplicationDetail } from "../../cash/cash-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PaymentApplicationDetail applicationId={(await params).id} />;
}
