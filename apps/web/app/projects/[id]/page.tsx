import { ProjectDetail } from "../project-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <ProjectDetail projectId={params.id} />;
}
