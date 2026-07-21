import { ProjectHub } from '@/components/ProjectHub';

export default async function ProjectHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectHub projectId={id} />;
}
