import { ContactForm } from "../../contact-workspace";

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  return <ContactForm mode="edit" contactId={(await params).id} />;
}
