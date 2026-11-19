import { ProductionEdit } from "../../production-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProductionEdit productionId={(await params).id} />;
}
