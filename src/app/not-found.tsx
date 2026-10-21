import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
            <div className="flex w-full max-w-lg flex-col items-center gap-4 rounded-[1.5rem] border border-dashed bg-card px-6 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <SearchX size={24} />
                </div>
                <div className="space-y-1">
                    <p className="text-base font-bold text-foreground">No encontramos esta página</p>
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground">El enlace puede estar mal escrito o la página ya no existe.</p>
                </div>
                <Button asChild className="rounded-xl"><Link href="/dashboard">Ir al inicio</Link></Button>
            </div>
        </main>
    );
}
