import { RelationshipMapDetail } from "../relationship-map-workspace";

export default async function RelationshipMapDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <RelationshipMapDetail mapId={(await params).id} />;
}
