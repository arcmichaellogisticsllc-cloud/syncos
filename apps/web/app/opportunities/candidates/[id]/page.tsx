import { CandidateDetail } from "../candidate-workspace";

export default function OpportunityCandidateDetailPage({ params }: { params: { id: string } }) {
  return <CandidateDetail candidateId={params.id} />;
}

