import { ProjectEdit } from "../../project-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProjectEdit projectId={(await params).id} />;
}
