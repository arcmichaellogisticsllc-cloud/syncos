import { RelationshipMapForm } from "../../relationship-map-workspace";

export default function EditRelationshipMapPage({ params }: { params: { id: string } }) {
  return <RelationshipMapForm mode="edit" mapId={params.id} />;
}
