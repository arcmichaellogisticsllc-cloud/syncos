import { OrganizationForm } from "../../organization-workspace";

export default function EditOrganizationPage({ params }: { params: { id: string } }) {
  return <OrganizationForm mode="edit" organizationId={params.id} />;
}
