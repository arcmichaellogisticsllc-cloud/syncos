import { PaymentBatchEdit } from "../../payment-execution-workspace";

export default async function PaymentBatchEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentBatchEdit paymentBatchId={id} />;
}
