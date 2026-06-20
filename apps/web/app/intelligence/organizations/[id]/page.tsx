import { OrganizationProfile } from "../organization-workspace";

export default function OrganizationProfilePage({ params }: { params: { id: string } }) {
  return <OrganizationProfile organizationId={params.id} />;
}
