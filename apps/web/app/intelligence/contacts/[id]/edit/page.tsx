import { ContactForm } from "../../contact-workspace";

export default function EditContactPage({ params }: { params: { id: string } }) {
  return <ContactForm mode="edit" contactId={params.id} />;
}
