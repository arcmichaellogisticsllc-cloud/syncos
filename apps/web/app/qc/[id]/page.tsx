import { QcReviewDetail } from "../qc-workspace";

export default async function QcDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QcReviewDetail qcReviewId={id} />;
}
