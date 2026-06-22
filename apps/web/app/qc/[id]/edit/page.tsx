import { QcReviewEdit } from "../../qc-workspace";

export default async function QcEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QcReviewEdit qcReviewId={id} />;
}
