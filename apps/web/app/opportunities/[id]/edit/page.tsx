import { OpportunityForm } from "../../pipeline/opportunity-pipeline-workspace";

export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  return <OpportunityForm mode="edit" opportunityId={(await params).id} />;
}
