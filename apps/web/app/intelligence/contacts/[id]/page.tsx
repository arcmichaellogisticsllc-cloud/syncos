import { ContactDetail } from "../contact-workspace";

export default function ContactDetailPage({ params }: { params: { id: string } }) {
  return <ContactDetail contactId={params.id} />;
}
