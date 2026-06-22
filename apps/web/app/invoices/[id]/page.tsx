import { InvoiceDetail } from "../invoice-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <InvoiceDetail invoiceId={params.id} />;
}
