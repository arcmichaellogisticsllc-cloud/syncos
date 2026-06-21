import { CoveragePlanFormPage } from "../../coverage-planning-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <CoveragePlanFormPage mode="edit" id={params.id} />;
}
