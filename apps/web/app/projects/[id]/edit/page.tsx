import { ProjectEdit } from "../../project-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <ProjectEdit projectId={params.id} />;
}
