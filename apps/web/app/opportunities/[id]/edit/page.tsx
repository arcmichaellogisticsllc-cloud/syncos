import { OpportunityForm } from "../../pipeline/opportunity-pipeline-workspace";

export default function EditOpportunityPage({ params }: { params: { id: string } }) {
  return <OpportunityForm mode="edit" opportunityId={params.id} />;
}
