import { ProductionDetail } from "../production-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProductionDetail productionId={(await params).id} />;
}
