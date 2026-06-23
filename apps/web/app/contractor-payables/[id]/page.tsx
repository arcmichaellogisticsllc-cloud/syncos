import { ContractorPayableDetail } from "../contractor-payable-workspace";

export default function ContractorPayableDetailPage({ params }: { params: { id: string } }) {
  return <ContractorPayableDetail payableId={params.id} />;
}
