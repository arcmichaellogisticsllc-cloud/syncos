import { CollectionCaseEdit } from "../../collections-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CollectionCaseEdit caseId={(await params).id} />;
}
