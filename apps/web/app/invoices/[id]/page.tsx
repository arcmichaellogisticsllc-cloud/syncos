import { InvoiceDetail } from "../invoice-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <InvoiceDetail invoiceId={(await params).id} />;
}
