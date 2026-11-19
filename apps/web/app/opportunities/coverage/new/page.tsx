import { CoveragePlanFormPage } from "../coverage-planning-workspace";

export default async function Page({ searchParams }: { searchParams?: Promise<{ opportunityId?: string }> }) {
  return <CoveragePlanFormPage mode="create" initialOpportunityId={(await searchParams)?.opportunityId} />;
}
