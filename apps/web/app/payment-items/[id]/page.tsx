import { PaymentItemDetail } from "../../payments/payment-execution-workspace";

export default async function PaymentItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentItemDetail paymentItemId={id} />;
}
