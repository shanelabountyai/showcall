'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-render the server page every few seconds. Since Showcall Live this is the
 * fallback when the stream cannot connect (LV-7). It skips while the browser
 * reports no network: a refresh that cannot reach the server would otherwise
 * fall back to a full navigation onto an error page.
 */
export function Poll({ ms }: { ms: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (navigator.onLine) router.refresh(); }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
