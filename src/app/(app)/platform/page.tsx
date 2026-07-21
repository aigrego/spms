import { redirect } from 'next/navigation';

/* /platform 已并入 /settings(偏好 + 平台管理 Tab),旧路由保留为重定向。 */
export default function PlatformIndex() {
  redirect('/settings');
}
