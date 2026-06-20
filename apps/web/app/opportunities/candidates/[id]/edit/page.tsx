import { CandidateForm } from "../../candidate-workspace";

export default function EditOpportunityCandidatePage({ params }: { params: { id: string } }) {
  return <CandidateForm mode="edit" candidateId={params.id} />;
}

