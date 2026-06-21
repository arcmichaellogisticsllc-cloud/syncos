import { WorkOrderEdit } from "../../work-order-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <WorkOrderEdit workOrderId={params.id} />;
}
