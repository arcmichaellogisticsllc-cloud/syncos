import { OrganizationForm } from "../../organization-workspace";

export default async function EditOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  return <OrganizationForm mode="edit" organizationId={(await params).id} />;
}
