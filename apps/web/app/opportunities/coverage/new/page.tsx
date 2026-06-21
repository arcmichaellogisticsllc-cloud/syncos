import { CoveragePlanFormPage } from "../coverage-planning-workspace";

export default function Page({ searchParams }: { searchParams?: { opportunityId?: string } }) {
  return <CoveragePlanFormPage mode="create" initialOpportunityId={searchParams?.opportunityId} />;
}
