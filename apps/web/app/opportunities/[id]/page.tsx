import { OpportunityDetail } from "../pipeline/opportunity-pipeline-workspace";

export default function OpportunityDetailPage({ params }: { params: { id: string } }) {
  return <OpportunityDetail opportunityId={params.id} />;
}
