import { WorkOrderDetail } from "../work-order-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <WorkOrderDetail workOrderId={params.id} />;
}
