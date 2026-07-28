'use client';

import * as React from 'react';

/* Browser memory: user UI preferences (issues view grouping/filters, archived
   toggle, …) persisted in localStorage under the `spms.prefs.` prefix.
   个人资料页的「重置浏览器记忆」清空该前缀下的全部 key;theme/locale 等
   其他 key 不受影响。 */

const PREFIX = 'spms.prefs.';

export function resetBrowserMemory() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* localStorage unavailable (privacy mode) — nothing to reset */
  }
  // drop cached reads so mounted views fall back to defaults immediately
  for (const k of [...cache.keys()]) {
    if (k.startsWith(PREFIX)) cache.delete(k);
  }
  emit();
}

/* useState backed by localStorage via useSyncExternalStore: SSR and the first
   client render use `initial`, the stored value takes over right after mount
   (no hydration mismatch, no setState-in-effect). Same-tab writes notify
   through a tiny emitter; cross-tab writes through the `storage` event. */

const UNSET: unique symbol = Symbol('unset');
type Stored = unknown;

// fullKey → parsed value; UNSET = no stored value. Stabilizes getSnapshot.
const cache = new Map<string, Stored>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function readSnapshot<T>(fullKey: string, isValid?: (v: unknown) => v is T): T | typeof UNSET {
  if (cache.has(fullKey)) return cache.get(fullKey) as T | typeof UNSET;
  let v: Stored = UNSET;
  try {
    const raw = localStorage.getItem(fullKey);
    if (raw != null) {
      const parsed: unknown = JSON.parse(raw);
      if (!isValid || isValid(parsed)) v = parsed;
    }
  } catch {
    /* corrupt JSON or unavailable storage — treat as unset */
  }
  cache.set(fullKey, v);
  return v as T | typeof UNSET;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // cross-tab: drop the cached parse so the next snapshot re-reads storage
  const onStorage = (e: StorageEvent) => {
    if (e.key == null || e.key.startsWith(PREFIX)) {
      if (e.key != null) cache.delete(e.key);
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePersistentState<T>(
  key: string,
  initial: T,
  isValid?: (v: unknown) => v is T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const fullKey = PREFIX + key;
  const stored = React.useSyncExternalStore(
    subscribe,
    () => readSnapshot(fullKey, isValid),
    (): T | typeof UNSET => UNSET,
  );

  const set = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (v) => {
      const cur = readSnapshot(fullKey, isValid);
      const prev = cur === UNSET ? initial : cur;
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try {
        localStorage.setItem(fullKey, JSON.stringify(next));
      } catch {
        /* storage full/unavailable — still update in-memory via cache */
      }
      cache.set(fullKey, next);
      emit();
    },
    [fullKey, initial, isValid],
  );

  return [stored === UNSET ? initial : stored, set];
}
