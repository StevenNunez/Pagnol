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
        title: 'Control de Activos y Abastecimiento',
        desc:
            'Desde que en terreno alguien necesita algo hasta que el equipo se da de baja, incluyendo lo que costó. El recorrido completo, los diez pasos explicados uno por uno y quién responde por cada uno.',
        tags: ['Cómo funciona', 'Paso a paso', 'Quién hace qué'],
    },
    {
        href: '/ayuda/roles',
        icon: Users,
        title: 'Roles y Responsabilidades',
        desc:
            'Qué hace cada rol y qué parte de la aplicación ve. La referencia para decidir a quién le das cada acceso.',
        tags: ['Los roles', 'Qué ve cada uno', 'Permisos'],
    },
];

const COMING = [
    { icon: ClipboardList, title: 'Asistencia, sueldos y finiquitos' },
    { icon: HardHat, title: 'Reportes de terreno' },
    { icon: ShieldCheck, title: 'Prevención de riesgos y Comité Paritario' },
    { icon: Wallet, title: 'Control de obra y estados de pago' },
];

export default function CentroDeAyudaPage() {
    return (
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-16 sm:py-24 space-y-16 animate-in fade-in duration-500">
            {/* Encabezado */}
            <header className="space-y-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                    Manual de uso de Pagnol
                </p>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-balance">
                    Centro de Ayuda
                </h1>
                <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
                    Cómo funciona Pagnol, explicado paso por paso: dónde se hace cada cosa, quién
                    la hace y quién responde por ella.
                </p>
            </header>

            {/* Guías disponibles */}
            <section className="space-y-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Guías disponibles
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
                                        <h2 className="text-xl font-bold tracking-tight group-hover:text-primary transition-colors">
                                            {g.title}
                                        </h2>
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

            {/* Cierre: dónde preguntar */}
            <section className="rounded-[1.5rem] border-2 border-primary bg-primary/5 p-7 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                    ¿No encuentras lo que buscas?
                </p>
                <p className="leading-relaxed max-w-2xl">
                    Estas guías se van actualizando a medida que Pagnol crece, así que cuentan lo que
                    la aplicación hace hoy. Si algo no está o no se entiende, escríbenos a{' '}
                    <a
                        href="mailto:contacto@pagnol.cl"
                        className="font-bold text-primary hover:underline"
                    >
                        contacto@pagnol.cl
                    </a>{' '}
                    y lo agregamos.
                </p>
            </section>

        </div>
    );
}
