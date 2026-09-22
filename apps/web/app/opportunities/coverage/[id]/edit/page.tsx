import { CoveragePlanFormPage } from "../../coverage-planning-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CoveragePlanFormPage mode="edit" id={(await params).id} />;
}
