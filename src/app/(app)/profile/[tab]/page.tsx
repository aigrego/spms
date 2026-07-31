import ProfileClient from '../ProfileClient';

/* /profile/<tab> — 指定 Tab 的账号页(security/apps,非法值回落 profile)。 */
export default async function ProfileTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  return <ProfileClient tab={tab} />;
}
