import { OpportunityDetail } from "../pipeline/opportunity-pipeline-workspace";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <OpportunityDetail opportunityId={(await params).id} />;
}
