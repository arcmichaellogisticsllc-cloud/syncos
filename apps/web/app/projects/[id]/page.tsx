import { ProjectDetail } from "../project-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProjectDetail projectId={(await params).id} />;
}
