'use client';

/* Theme preference shared by the header toggle and the settings page.
   Persisted in localStorage('theme') as 'light' | 'dark' | 'system';
   the anti-flash inline script in app/layout.tsx resolves the same value
   before first paint. Default is light. */

export type ThemePref = 'light' | 'dark' | 'system';

export function readThemePref(): ThemePref {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark' || t === 'system') return t;
  } catch {
    // private mode etc. — fall through to the default
  }
  return 'light';
}

export function effectiveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

let systemListenerBound = false;

function bindSystemListener() {
  if (systemListenerBound) return;
  systemListenerBound = true;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readThemePref() === 'system') {
      document.documentElement.dataset.theme = effectiveTheme('system');
    }
  });
}

export function applyTheme(pref: ThemePref): void {
  try {
    localStorage.setItem('theme', pref);
  } catch {
    // theme just won't persist
  }
  if (pref === 'system') bindSystemListener();
  document.documentElement.dataset.theme = effectiveTheme(pref);
}
