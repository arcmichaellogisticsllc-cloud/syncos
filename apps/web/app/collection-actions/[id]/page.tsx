import { CollectionActionDetail } from "../../collections/collections-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <CollectionActionDetail actionId={params.id} />;
}
