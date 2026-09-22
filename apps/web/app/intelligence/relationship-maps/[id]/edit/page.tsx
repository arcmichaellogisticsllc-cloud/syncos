import { RelationshipMapForm } from "../../relationship-map-workspace";

export default async function EditRelationshipMapPage({ params }: { params: Promise<{ id: string }> }) {
  return <RelationshipMapForm mode="edit" mapId={(await params).id} />;
}
