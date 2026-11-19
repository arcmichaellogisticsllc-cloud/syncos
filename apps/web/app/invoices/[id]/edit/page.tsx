import { InvoiceEdit } from "../../invoice-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <InvoiceEdit invoiceId={(await params).id} />;
}
