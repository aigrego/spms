import { redirect } from 'next/navigation';
import ProfileClient from './ProfileClient';

/* /profile — 个人资料。旧查询参数 ?tab=<tab> 301 到 /profile/<tab>
   (oauth 反馈参数保留)。 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  if (typeof sp.tab === 'string' && sp.tab) {
    const oauth = typeof sp.oauth === 'string' && sp.oauth ? `?oauth=${sp.oauth}` : '';
    redirect(`/profile/${sp.tab}${oauth}`);
  }
  return <ProfileClient />;
}
