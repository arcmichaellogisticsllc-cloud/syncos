import { ContractorPayableEdit } from "../../contractor-payable-workspace";

export default async function ContractorPayableEditPage({ params }: { params: Promise<{ id: string }> }) {
  return <ContractorPayableEdit payableId={(await params).id} />;
}
