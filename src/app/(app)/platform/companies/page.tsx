import { redirect } from 'next/navigation';

export default function CompaniesRedirect() {
  redirect('/settings?tab=companies');
}
