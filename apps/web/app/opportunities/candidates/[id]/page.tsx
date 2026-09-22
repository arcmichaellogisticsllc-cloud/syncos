import { CandidateDetail } from "../candidate-workspace";

export default async function OpportunityCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <CandidateDetail candidateId={(await params).id} />;
}

