import { CollectionCaseDetail } from "../collections-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <CollectionCaseDetail caseId={params.id} />;
}
