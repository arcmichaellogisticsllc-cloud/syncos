import { CandidateForm } from "../../candidate-workspace";

export default async function EditOpportunityCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  return <CandidateForm mode="edit" candidateId={(await params).id} />;
}

