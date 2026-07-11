"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
    ArrowUpRight, ArrowDownLeft, Clock, ShieldQuestion,
} from 'lucide-react';
import type { MaterialRequest, ReturnRequest } from '@/modules/core/lib/data';
import { WithdrawalsInbox } from '@/components/pagnol-requests/withdrawals-inbox';
import { ReturnsInbox } from '@/components/pagnol-requests/returns-inbox';
import { daysSince } from '@/components/pagnol-requests/request-shared';

// ────────────────────────────────────────────────────────────────────────────
// Bandeja del pañol: Retiros (material_requests) + Devoluciones (return_requests)
// con la firma visual Pagnol (KPIs + chips de segmento).
// ────────────────────────────────────────────────────────────────────────────

type Section = 'retiros' | 'devoluciones';

export default function PanolInboxPage() {
    const { requests, returnRequests } = useAppState();
    const router = useRouter();
    const [section, setSection] = useState<Section>('retiros');

    const kpis = useMemo(() => {
        const reqs = (requests || []) as MaterialRequest[];
        const rets = (returnRequests || []) as ReturnRequest[];
        const pendingReady = reqs.filter(r => r.status === 'pending' && r.adcAuthorizedAt).length;
        const waitingAdc = reqs.filter(r => r.status === 'pending' && !r.adcAuthorizedAt).length;
        const pendingReturns = rets.filter(r => r.status === 'pending').length;
        // Aprobadas hace 3+ días que nadie retiró (stock que salió y no volvió a moverse).
        const notPickedUp = reqs.filter(r => r.status === 'approved' && !r.deliveryDate && daysSince(r.approvalDate) >= 3).length;
        return { pendingReady, waitingAdc, pendingReturns, notPickedUp };
    }, [requests, returnRequests]);

    const goAuthorizations = () => router.push('/dashboard/authorizations');

    const KPIS = [
        { label: 'Retiros por aprobar', value: kpis.pendingReady, icon: ArrowUpRight, iconCls: 'bg-primary/10 text-primary', onClick: () => setSection('retiros') },
        { label: 'Devoluciones por revisar', value: kpis.pendingReturns, icon: ArrowDownLeft, iconCls: 'bg-info-subtle text-info', onClick: () => setSection('devoluciones') },
        { label: 'Sin retirar (+3 días)', value: kpis.notPickedUp, icon: Clock, iconCls: kpis.notPickedUp > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground', onClick: () => setSection('retiros') },
        { label: 'Esperando al ADC', value: kpis.waitingAdc, icon: ShieldQuestion, iconCls: kpis.waitingAdc > 0 ? 'bg-warning-subtle text-warning' : 'bg-muted text-muted-foreground', onClick: goAuthorizations },
    ];

    const SEGMENTS: { key: Section; label: string; icon: any; count: number }[] = [
        { key: 'retiros', label: 'Retiros', icon: ArrowUpRight, count: kpis.pendingReady },
        { key: 'devoluciones', label: 'Devoluciones', icon: ArrowDownLeft, count: kpis.pendingReturns },
    ];

    return (
        <PageShell
            title="Solicitudes y Devoluciones"
            description="Bandeja del pañol: aprueba retiros de material y gestiona las devoluciones desde faena."
        >
            {/* KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {KPIS.map((k, i) => (
                    <button key={i} onClick={k.onClick} className="text-left">
                        <Card className="p-6 rounded-[1.5rem] border-none shadow-sm hover:shadow-lg transition-all group h-full">
                            <div className="flex items-center justify-between mb-6">
                                <div className={cn('p-3 rounded-xl shadow-sm', k.iconCls)}>
                                    <k.icon size={18} />
                                </div>
                            </div>
                            <p className="text-3xl font-black font-outfit text-foreground">{k.value}</p>
                            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mt-1">{k.label}</p>
                        </Card>
                    </button>
                ))}
            </div>

            {/* Chips de segmento (firma Pagnol) */}
            <div className="flex items-center gap-1 bg-muted/50 border rounded-xl p-1 w-fit">
                {SEGMENTS.map(({ key, label, icon: Icon, count }) => (
                    <button
                        key={key}
                        onClick={() => setSection(key)}
                        className={cn(
                            'px-5 py-2.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-2',
                            section === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        <Icon size={15} /> {label}
                        {count > 0 && (
                            <span className={cn('px-1.5 py-0.5 rounded-md text-[8px]', section === key ? 'bg-primary-foreground/20' : 'bg-warning text-warning-foreground')}>{count}</span>
                        )}
                    </button>
                ))}
            </div>

            {section === 'retiros'
                ? <WithdrawalsInbox onNavigateAuthorizations={goAuthorizations} />
                : <ReturnsInbox />
            }
        </PageShell>
    );
}
