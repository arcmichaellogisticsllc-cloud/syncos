import { CoveragePlanDetailPage } from "../coverage-planning-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <CoveragePlanDetailPage id={params.id} />;
}
