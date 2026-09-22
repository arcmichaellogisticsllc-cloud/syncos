import { ContractorPayableDetail } from "../contractor-payable-workspace";

export default async function ContractorPayableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <ContractorPayableDetail payableId={(await params).id} />;
}
