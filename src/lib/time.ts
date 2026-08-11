import type { TFn, Locale } from './i18n';

/* Render an ISO timestamp as a localized relative-time string. */
export function relativeTime(iso: string, t: TFn): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minAgo', { n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('time.hrAgo', { n: hr });
  const day = Math.round(hr / 24);
  if (day === 1) return t('time.yesterday');
  if (day < 7) return t('time.dayAgo', { n: day });
  if (day < 14) return t('time.lastWeek');
  const wk = Math.round(day / 7);
  if (wk < 5) return t('time.weekAgo', { n: wk });
  const mo = Math.round(day / 30);
  return t('time.monthAgo', { n: mo });
}

/* Absolute timestamp for activity rows. zh → "5月19日 09:14"; en → "May 19 09:14". */
export function formatActivityTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  if (locale === 'en') {
    const mon = d.toLocaleString('en-US', { month: 'short' });
    return `${mon} ${d.getDate()} ${hh}:${mi}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mi}`;
}

/* Date-only rendering. zh → "2026/8/14"; en → "Aug 14, 2026". */
export function formatDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (locale === 'en') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
