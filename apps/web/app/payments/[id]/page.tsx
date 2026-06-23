import { PaymentBatchDetail } from "../payment-execution-workspace";

export default async function PaymentBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentBatchDetail paymentBatchId={id} />;
}
