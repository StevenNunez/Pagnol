'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorPanel } from '@/components/error-panel';

// Un fallo de render en una página no tumba el panel: el menú lateral y la sesión
// siguen en pie y sólo esta área muestra el error.
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    useEffect(() => {
        console.error('[dashboard] error de render:', error);
    }, [error]);

    return (
        <ErrorPanel
            className="mt-10"
            reference={error.digest}
            onRetry={retry}
            action={<Button asChild variant="outline" className="rounded-xl"><Link href="/dashboard">Volver al inicio</Link></Button>}
        />
    );
}
