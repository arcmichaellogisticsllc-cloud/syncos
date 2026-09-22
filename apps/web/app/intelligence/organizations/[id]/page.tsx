import { OrganizationProfile } from "../organization-workspace";

export default async function OrganizationProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return <OrganizationProfile organizationId={(await params).id} />;
}
