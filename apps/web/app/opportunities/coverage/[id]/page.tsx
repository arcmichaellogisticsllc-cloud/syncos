import { CoveragePlanDetailPage } from "../coverage-planning-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CoveragePlanDetailPage id={(await params).id} />;
}
