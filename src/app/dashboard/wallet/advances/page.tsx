"use client";

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/page-shell';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import {
    Clock, CheckCircle2, XCircle, HandCoins, Calendar, ArrowLeft, TrendingUp, Banknote,
} from 'lucide-react';
import type { SalaryAdvance } from '@/modules/core/lib/data';

const formatCLP = (amount: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);

const formatDate = (date: any) => {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

const estadoBadge = (adv: SalaryAdvance) => {
    switch (adv.status) {
        case 'paid':
            return <Badge className="badge-success gap-1"><Banknote size={12} /> Depositado</Badge>;
        case 'approved':
            return <Badge className="badge-info gap-1"><Clock size={12} /> Por transferir</Badge>;
        case 'rejected':
            return <Badge variant="destructive" className="gap-1"><XCircle size={12} /> Rechazado</Badge>;
        default:
            return <Badge className="badge-warning gap-1"><Clock size={12} /> Pendiente</Badge>;
    }
};

function KpiCard({ icon, label, value, tone }: {
    icon: React.ReactNode; label: string; value: string; tone: string;
}) {
    return (
        <Card className="rounded-[1.5rem]">
            <CardContent className="p-6">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${tone}`}>{icon}</div>
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                        <p className="text-xl font-black text-foreground">{value}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export default function WorkerAdvancesPage() {
    const { salaryAdvances } = useAppState();
    const { user } = useAuth();

    const myAdvances = useMemo(() => {
        if (!user || !salaryAdvances) return [];
        return salaryAdvances
            .filter(adv => adv.workerId === user.id)
            .sort((a, b) => new Date(b.requestedAt as any).getTime() - new Date(a.requestedAt as any).getTime());
    }, [user, salaryAdvances]);

    const stats = useMemo(() => {
        // Autorizado incluye lo ya depositado: si no, el monto CAÍA al registrarse
        // el pago, que es justo cuando el trabajador recibió la plata.
        const autorizado = myAdvances
            .filter(a => a.status === 'approved' || a.status === 'paid')
            .reduce((acc, curr) => acc + curr.amount, 0);
        // Deuda vigente: lo que la planilla todavía no descontó, sea del mes que sea.
        const porDescontar = myAdvances
            .filter(a => a.status !== 'rejected' && !a.payrollLineId)
            .reduce((acc, curr) => acc + curr.amount, 0);
        return { total: myAdvances.length, autorizado, porDescontar };
    }, [myAdvances]);

    const columnas: DataTableColumn<SalaryAdvance>[] = [
        {
            key: 'fecha',
            header: 'Solicitado',
            cell: (adv) => (
                <div className="flex items-center gap-3">
                    <Calendar className="text-muted-foreground" size={16} />
                    <span className="font-bold text-foreground">{formatDate(adv.requestedAt)}</span>
                </div>
            ),
        },
        {
            key: 'monto',
            header: 'Monto',
            cell: (adv) => <span className="text-lg font-black text-foreground">{formatCLP(adv.amount)}</span>,
        },
        {
            key: 'estado',
            header: 'Estado',
            cell: (adv) => (
                <div className="space-y-1">
                    {estadoBadge(adv)}
                    {adv.status === 'paid' && (
                        <p className="text-[10px] font-bold text-muted-foreground">
                            {adv.paymentDate}{adv.paymentMethod ? ` · ${adv.paymentMethod}` : ''}
                        </p>
                    )}
                    {adv.status === 'rejected' && adv.rejectionReason && (
                        <p className="text-[10px] font-bold text-destructive max-w-[200px]">{adv.rejectionReason}</p>
                    )}
                </div>
            ),
        },
        {
            key: 'descuento',
            header: 'Descontado',
            cell: (adv) => adv.payrollLineId
                ? <span className="text-xs font-bold text-muted-foreground">En tu liquidación</span>
                : adv.status === 'rejected'
                    ? <span className="text-xs text-muted-foreground">—</span>
                    : <span className="text-xs font-bold text-warning-subtle-foreground">Pendiente</span>,
        },
        {
            key: 'resuelto',
            header: 'Resuelto por',
            cell: (adv) => adv.approverName
                ? (
                    <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[8px] font-black text-muted-foreground uppercase">
                            {adv.approverName[0]}
                        </div>
                        <span className="text-[11px] font-bold text-muted-foreground uppercase">{adv.approverName}</span>
                    </div>
                )
                : <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest italic">En espera</span>,
        },
    ];

    return (
        <PageShell
            title="Mis Adelantos"
            description="Historial de tus solicitudes y en qué liquidación se descuentan."
            toolbar={
                <>
                    <Button variant="ghost" asChild className="text-muted-foreground">
                        <Link href="/dashboard/wallet" className="flex items-center gap-2">
                            <ArrowLeft size={16} /> Volver a mi billetera
                        </Link>
                    </Button>
                    <Button asChild className="rounded-[1.5rem] shadow-lg shadow-primary/10 transition hover:scale-105 active:scale-95">
                        <Link href="/dashboard/wallet">Solicitar adelanto</Link>
                    </Button>
                </>
            }
        >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KpiCard
                    icon={<TrendingUp size={24} />}
                    label="Autorizado"
                    value={formatCLP(stats.autorizado)}
                    tone="bg-info-subtle text-info-subtle-foreground"
                />
                <KpiCard
                    icon={<HandCoins size={24} />}
                    label="Por descontar"
                    value={formatCLP(stats.porDescontar)}
                    tone="bg-warning-subtle text-warning-subtle-foreground"
                />
                <KpiCard
                    icon={<Clock size={24} />}
                    label="Solicitudes"
                    value={String(stats.total)}
                    tone="bg-muted text-muted-foreground"
                />
            </div>

            <DataTable
                columns={columnas}
                data={myAdvances}
                rowKey={(adv) => adv.id}
                minWidth="760px"
                empty={{
                    icon: <HandCoins size={24} />,
                    title: 'Aún no has pedido un adelanto',
                    description: 'Cuando pidas uno desde tu billetera, aparecerá acá con su estado.',
                }}
            />

            <Card className="rounded-[2rem] bg-pagnol-dark text-white">
                <CardContent className="flex flex-col md:flex-row items-center justify-between gap-6 p-8">
                    <div className="flex items-center gap-6">
                        <div className="h-16 w-16 bg-primary rounded-[1.5rem] flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
                            <HandCoins size={32} />
                        </div>
                        <div>
                            <h4 className="text-xl font-black uppercase">Cómo funciona</h4>
                            <p className="text-xs text-white/70 max-w-sm">
                                Un adelanto aprobado se transfiere y se descuenta de tu próxima
                                liquidación. Mientras diga «Por transferir», el pago aún no se ha hecho.
                            </p>
                        </div>
                    </div>
                    <Button asChild variant="secondary" className="rounded-2xl px-8 py-6 font-black uppercase tracking-widest">
                        <Link href="/dashboard/wallet">Ir a mi billetera</Link>
                    </Button>
                </CardContent>
            </Card>
        </PageShell>
    );
}
