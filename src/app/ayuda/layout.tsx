import type { Metadata } from 'next';
import Link from 'next/link';
import { Lock, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SiteFooter } from '@/components/marketing/site-footer';
import { ThemeSwitcher } from '@/components/theme-switcher';

export const metadata: Metadata = {
    title: {
        default: 'Centro de Ayuda',
        template: '%s | Centro de Ayuda PAGNOL',
    },
    description:
        'Manual de uso de PAGNOL: cómo funciona cada proceso, paso a paso, y quién hace qué. ' +
        'Documentación funcional del control de activos y del ciclo de abastecimiento.',
};

export default function AyudaLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            {/* Barra superior */}
            <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-6 sm:px-8 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-6">
                        <Link href="/" className="flex flex-col shrink-0">
                            <span className="text-lg font-black tracking-tighter leading-none">PAGNOL</span>
                            <span className="text-[8px] font-bold tracking-[0.2em] text-primary uppercase mt-0.5">
                                Asset Management
                            </span>
                        </Link>
                        <Link
                            href="/ayuda"
                            className="hidden sm:flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <LifeBuoy className="h-4 w-4" />
                            Centro de Ayuda
                        </Link>
                    </div>
                    <div className="flex items-center gap-2">
                        <ThemeSwitcher />
                        <Button
                            asChild
                            className="rounded-xl font-bold text-[10px] uppercase tracking-widest gap-2 shadow-lg shadow-primary/20"
                        >
                            <Link href="/login">
                                <Lock className="h-4 w-4" />
                                Acceso Personal
                            </Link>
                        </Button>
                    </div>
                </div>
            </nav>

            <main className="flex-1">{children}</main>

            <SiteFooter />
        </div>
    );
}
