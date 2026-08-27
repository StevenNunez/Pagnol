import type { Metadata } from 'next';
import Link from 'next/link';
import {
    ArrowRight,
    Boxes,
    ShieldCheck,
    Users,
    ClipboardList,
    HardHat,
    Wallet,
    Clock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = {
    title: 'Centro de Ayuda',
    description:
        'Manual de uso de PAGNOL. Cómo funciona el control de activos asociado a Abastecimiento: ' +
        'diagrama de flujo, las diez fases del proceso y el descriptor de roles y responsabilidades.',
};

const GUIDES = [
    {
        href: '/ayuda/control-de-activos',
        icon: Boxes,
        code: 'PROC-01',
        title: 'Control de Activos y Abastecimiento',
        desc:
            'El proceso completo: desde que en terreno aparece una necesidad hasta que el activo se da de baja, incluyendo su costo. Diagrama de flujo, las diez fases explicadas una a una y la matriz de responsabilidades.',
        tags: ['Diagrama de flujo', '10 fases', 'Matriz RACI'],
    },
    {
        href: '/ayuda/roles',
        icon: Users,
        code: 'ROLES',
        title: 'Roles y Responsabilidades',
        desc:
            'Los 24 roles de Pagnol: qué hace cada uno, qué módulos ve y cómo se resuelve un permiso. La referencia para decidir quién entra a qué.',
        tags: ['24 roles', 'Permisos', 'Módulos'],
    },
];

const COMING = [
    { icon: ClipboardList, title: 'Asistencia, remuneraciones y finiquitos' },
    { icon: HardHat, title: 'Reportes de trabajo en cascada' },
    { icon: ShieldCheck, title: 'Prevención de riesgos y CPHS' },
    { icon: Wallet, title: 'Control de obra y estados de pago' },
];

export default function CentroDeAyudaPage() {
    return (
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-16 sm:py-24 space-y-16 animate-in fade-in duration-500">
            {/* Encabezado */}
            <header className="space-y-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                    Manual de uso · Documentación viva
                </p>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-balance">
                    Centro de Ayuda
                </h1>
                <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
                    Cómo funciona Pagnol por dentro: los procesos de negocio explicados fase por
                    fase, con las pantallas donde ocurre cada cosa y quién responde por cada paso.
                </p>
            </header>

            {/* Guías disponibles */}
            <section className="space-y-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Documentos disponibles
                </p>
                <div className="grid grid-cols-1 gap-5">
                    {GUIDES.map((g) => (
                        <Link key={g.href} href={g.href} className="group block">
                            <Card className="rounded-[1.5rem] transition-all group-hover:border-primary group-hover:shadow-lg group-hover:shadow-primary/5">
                                <CardContent className="p-7 sm:p-8 flex flex-col sm:flex-row gap-6">
                                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                        <g.icon className="h-7 w-7" />
                                    </div>
                                    <div className="space-y-3 min-w-0">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                                {g.code}
                                            </span>
                                            <h2 className="text-xl font-bold tracking-tight group-hover:text-primary transition-colors">
                                                {g.title}
                                            </h2>
                                        </div>
                                        <p className="text-muted-foreground leading-relaxed">{g.desc}</p>
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            {g.tags.map((t) => (
                                                <span
                                                    key={t}
                                                    className="rounded-xl border bg-muted px-3 py-1 text-[11px] font-bold text-muted-foreground"
                                                >
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <ArrowRight className="hidden sm:block h-5 w-5 shrink-0 self-center text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            </section>

            {/* En preparación */}
            <section className="space-y-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    En preparación
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {COMING.map((c) => (
                        <div
                            key={c.title}
                            className="flex items-center gap-4 rounded-[1.25rem] border border-dashed bg-card/40 px-5 py-4"
                        >
                            <c.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <span className="text-sm font-medium text-muted-foreground">{c.title}</span>
                        </div>
                    ))}
                </div>
            </section>

            {/* Nota de documento vivo */}

        </div>
    );
}
