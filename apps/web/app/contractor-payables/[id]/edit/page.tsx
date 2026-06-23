import { ContractorPayableEdit } from "../../contractor-payable-workspace";

export default function ContractorPayableEditPage({ params }: { params: { id: string } }) {
  return <ContractorPayableEdit payableId={params.id} />;
}
