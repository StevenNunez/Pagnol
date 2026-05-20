'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function ContratosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/estado-pago');
  }, [router]);
  return (
    <div className="flex h-[80vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
