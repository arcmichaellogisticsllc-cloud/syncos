import { ProductionDetail } from "../production-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <ProductionDetail productionId={params.id} />;
}
