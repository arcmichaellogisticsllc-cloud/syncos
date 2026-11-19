import { WorkOrderEdit } from "../../work-order-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <WorkOrderEdit workOrderId={(await params).id} />;
}
