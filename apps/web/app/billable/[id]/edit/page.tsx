import { BillableEdit } from "../../billable-workspace";

export default async function BillableEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillableEdit billableId={id} />;
}
