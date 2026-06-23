import { PaymentApplicationDetail } from "../../cash/cash-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <PaymentApplicationDetail applicationId={params.id} />;
}
