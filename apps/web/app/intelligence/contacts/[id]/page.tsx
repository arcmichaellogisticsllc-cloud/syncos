import { ContactDetail } from "../contact-workspace";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <ContactDetail contactId={(await params).id} />;
}
