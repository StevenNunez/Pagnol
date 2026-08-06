'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingState } from '@/components/loading-state';

export default function ContratosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/estado-pago');
  }, [router]);
  return <LoadingState fullHeight />;
}
