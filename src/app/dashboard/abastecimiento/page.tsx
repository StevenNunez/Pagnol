'use client';

import * as React from 'react';
import Link from 'next/link';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
    ShoppingCart,
    FileText,
    Truck,
    Building2,
    DollarSign,
    Search,
    ListChecks,
    Target,
    FileBarChart,
    AlertTriangle,
    Clock,
    ArrowRight,
    CheckCircle2,
} from 'lucide-react';

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

type Kpi = {
    label: string;
    value: string;
    hint?: string;
    icon: React.ElementType;
    tone: 'default' | 'warning' | 'info' | 'success' | 'destructive';
};

const toneStyles: Record<Kpi['tone'], string> = {
    default: 'bg-muted text-foreground',
    warning: 'bg-warning-subtle text-warning-subtle-foreground',
    info: 'bg-info-subtle text-info-subtle-foreground',
    success: 'bg-success-subtle text-success-subtle-foreground',
    destructive: 'bg-destructive/10 text-destructive',
};

const flowSteps = [
    { href: '/dashboard/abastecimiento/solicitudes', icon: ShoppingCart, label: 'Solicitudes' },
    { href: '/dashboard/abastecimiento/rfq', icon: Search, label: 'RFQ' },
    { href: '/dashboard/abastecimiento/comparador', icon: ListChecks, label: 'Comparador' },
    { href: '/dashboard/abastecimiento/ordenes', icon: FileText, label: 'Órdenes' },
    { href: '/dashboard/abastecimiento/recepcion', icon: Truck, label: 'Recepción' },
    { href: '/dashboard/abastecimiento/pagos', icon: DollarSign, label: 'Pagos' },
];

const shortcuts = [
    { href: '/dashboard/abastecimiento/proveedores', icon: Building2, label: 'Proveedores' },
    { href: '/dashboard/abastecimiento/costos', icon: Target, label: 'Control de Costos' },
    { href: '/dashboard/abastecimiento/reportes', icon: FileBarChart, label: 'Reportes' },
];

export default function AbastecimientoDashboard() {
    const { purchaseRequests, purchaseOrders, supplierPayments } = useAppState();

    const kpis = React.useMemo<Kpi[]>(() => {
        const prs = purchaseRequests || [];
        const pos = purchaseOrders || [];
        const sps = supplierPayments || [];

        const pendingRequests = prs.filter((pr) => pr.status === 'pending').length;
        const activeOrders = pos.filter((po) => ['generated', 'sent', 'issued'].includes(po.status)).length;
        const pendingPayments = sps.filter((sp) => sp.status === 'pending').length;
        const overduePayments = sps.filter((sp) => sp.status === 'overdue').length;
        const amountToPay = sps
            .filter((sp) => sp.status === 'pending' || sp.status === 'overdue')
            .reduce((acc, sp) => acc + (sp.amount || 0), 0);

        return [
            { label: 'Solicitudes pendientes', value: String(pendingRequests), hint: 'Esperan aprobación', icon: ShoppingCart, tone: 'warning' },
            { label: 'Órdenes activas', value: String(activeOrders), hint: 'Generadas / enviadas', icon: FileText, tone: 'info' },
            { label: 'Pagos pendientes', value: String(pendingPayments), hint: 'Facturas por pagar', icon: Clock, tone: 'default' },
            { label: 'Pagos vencidos', value: String(overduePayments), hint: 'Requieren atención', icon: AlertTriangle, tone: 'destructive' },
            { label: 'Monto por pagar', value: CLP.format(amountToPay), hint: 'Pendiente + vencido', icon: DollarSign, tone: 'success' },
        ];
    }, [purchaseRequests, purchaseOrders, supplierPayments]);

    return (
        <PageShell
            title="Abastecimiento y Control de Compras"
            description="Trazabilidad de extremo a extremo: solicitud → cotización → orden → recepción → pago."
        >
            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                {kpis.map((kpi) => (
                    <Card key={kpi.label} className="rounded-[1.5rem]">
                        <CardContent className="p-5 flex flex-col gap-3">
                            <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', toneStyles[kpi.tone])}>
                                <kpi.icon className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-2xl font-black tracking-tight text-foreground">{kpi.value}</p>
                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-1">{kpi.label}</p>
                                {kpi.hint && <p className="text-xs text-muted-foreground mt-1">{kpi.hint}</p>}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Flujo de compra */}
            <Card className="rounded-[1.5rem]">
                <CardContent className="p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            Flujo obligatorio — toda compra nace de una solicitud
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {flowSteps.map((step, i) => (
                            <React.Fragment key={step.href}>
                                <Link
                                    href={step.href}
                                    className="group flex items-center gap-2 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-primary/5"
                                >
                                    <step.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                                    <span className="text-sm font-bold text-foreground">{step.label}</span>
                                </Link>
                                {i < flowSteps.length - 1 && (
                                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Accesos directos */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {shortcuts.map((s) => (
                    <Link key={s.href} href={s.href} className="group">
                        <Card className="h-full rounded-[1.5rem] transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg">
                            <CardContent className="p-5 flex items-center gap-4">
                                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                    <s.icon className="h-5 w-5" />
                                </div>
                                <span className="text-base font-bold text-foreground group-hover:text-primary transition-colors">{s.label}</span>
                                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>
        </PageShell>
    );
}
