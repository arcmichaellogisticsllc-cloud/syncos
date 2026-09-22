import { CollectionCaseDetail } from "../collections-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CollectionCaseDetail caseId={(await params).id} />;
}
