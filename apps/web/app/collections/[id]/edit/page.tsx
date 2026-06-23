import { CollectionCaseEdit } from "../../collections-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <CollectionCaseEdit caseId={params.id} />;
}
