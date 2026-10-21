'use client';

import { useEffect } from 'react';
import { ErrorPanel } from '@/components/error-panel';

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    useEffect(() => {
        console.error('[app] error de render:', error);
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
            <ErrorPanel reference={error.digest} onRetry={retry} className="w-full max-w-lg" />
        </main>
    );
}
