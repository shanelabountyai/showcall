'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-render the server page every few seconds: live mode is polling, not push. */
export function Poll({ ms }: { ms: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
