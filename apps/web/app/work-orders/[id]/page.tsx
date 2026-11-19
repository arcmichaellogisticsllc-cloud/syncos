import { WorkOrderDetail } from "../work-order-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <WorkOrderDetail workOrderId={(await params).id} />;
}
