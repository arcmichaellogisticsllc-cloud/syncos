import { InvoiceEdit } from "../../invoice-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <InvoiceEdit invoiceId={params.id} />;
}
