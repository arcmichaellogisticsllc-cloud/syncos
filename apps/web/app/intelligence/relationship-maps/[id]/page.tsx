import { RelationshipMapDetail } from "../relationship-map-workspace";

export default function RelationshipMapDetailPage({ params }: { params: { id: string } }) {
  return <RelationshipMapDetail mapId={params.id} />;
}
