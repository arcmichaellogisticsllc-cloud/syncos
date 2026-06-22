import { ProductionEdit } from "../../production-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <ProductionEdit productionId={params.id} />;
}
