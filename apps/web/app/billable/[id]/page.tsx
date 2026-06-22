import { BillableDetail } from "../billable-workspace";

export default async function BillableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillableDetail billableId={id} />;
}
