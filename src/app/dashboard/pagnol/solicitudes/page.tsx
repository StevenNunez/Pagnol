"use client";

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { LoadingState } from '@/components/loading-state';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
    ArrowUpRight, ArrowDownLeft, HandHelping, ShieldQuestion,
} from 'lucide-react';
import type { MaterialRequest, ReturnRequest } from '@/modules/core/lib/data';
import { WithdrawalsInbox, type WithdrawalStep } from '@/components/pagnol-requests/withdrawals-inbox';
import { ReturnsInbox } from '@/components/pagnol-requests/returns-inbox';
import { daysSince } from '@/components/pagnol-requests/request-shared';
import { withdrawalQueues } from '@/components/pagnol-requests/withdrawal-queues';

// ────────────────────────────────────────────────────────────────────────────
// Bandeja del pañol: Retiros (material_requests) + Devoluciones (return_requests)
// con la firma visual Pagnol (KPIs + chips de segmento).
// ────────────────────────────────────────────────────────────────────────────

type Section = 'retiros' | 'devoluciones';

const TITLE = 'Entregas y Devoluciones';

// ?paso=por-entregar abre directo ese paso (lo usan el panel principal y los avisos).
const STEP_FROM_PARAM: Record<string, WithdrawalStep> = {
    'por-aprobar': 'toApprove',
    'por-entregar': 'toDeliver',
    'entregadas': 'delivered',
    'rechazadas': 'rejected',
};

export default function PanolInboxPage() {
    return (
        <Suspense fallback={<PageShell title={TITLE}><LoadingState /></PageShell>}>
            <PanolInbox />
        </Suspense>
    );
}

function PanolInbox() {
    const { requests, returnRequests } = useAppState();
    const router = useRouter();
    const params = useSearchParams();
    const initialStep = STEP_FROM_PARAM[params.get('paso') || ''];
    const [section, setSection] = useState<Section>(params.get('seccion') === 'devoluciones' ? 'devoluciones' : 'retiros');
    const [step, setStep] = useState<WithdrawalStep>(initialStep ?? 'toApprove');

    const kpis = useMemo(() => {
        const q = withdrawalQueues((requests || []) as MaterialRequest[]);
        const rets = (returnRequests || []) as ReturnRequest[];
        return {
            toApprove: q.toApprove.length,
            toDeliver: q.toDeliver.length,
            // Aprobadas hace 3+ días que nadie retiró (el stock ya salió del inventario).
            stale: q.toDeliver.filter(r => daysSince(r.approvalDate) >= 3).length,
            waitingAdc: q.waitingAdc.length,
            pendingReturns: rets.filter(r => r.status === 'pending').length,
        };
    }, [requests, returnRequests]);

    const goAuthorizations = () => router.push('/dashboard/authorizations');
    const openStep = (s: WithdrawalStep) => { setSection('retiros'); setStep(s); };

    const KPIS = [
        { label: 'Por aprobar', value: kpis.toApprove, icon: ArrowUpRight, iconCls: kpis.toApprove > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground', onClick: () => openStep('toApprove') },
        {
            label: 'Por entregar', value: kpis.toDeliver, icon: HandHelping,
            iconCls: kpis.stale > 0 ? 'bg-destructive/10 text-destructive' : kpis.toDeliver > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            hint: kpis.stale > 0 ? `${kpis.stale} hace más de 3 días` : undefined,
            onClick: () => openStep('toDeliver'),
        },
        { label: 'Devoluciones por revisar', value: kpis.pendingReturns, icon: ArrowDownLeft, iconCls: 'bg-info-subtle text-info', onClick: () => setSection('devoluciones') },
        { label: 'Esperando al ADC', value: kpis.waitingAdc, icon: ShieldQuestion, iconCls: kpis.waitingAdc > 0 ? 'bg-warning-subtle text-warning' : 'bg-muted text-muted-foreground', onClick: goAuthorizations },
    ];

    const SEGMENTS: { key: Section; label: string; icon: any; count: number }[] = [
        { key: 'retiros', label: 'Retiros', icon: ArrowUpRight, count: kpis.toApprove + kpis.toDeliver },
        { key: 'devoluciones', label: 'Devoluciones', icon: ArrowDownLeft, count: kpis.pendingReturns },
    ];

    return (
        <PageShell
            title={TITLE}
            description="Aprueba los retiros autorizados, entrégalos al trabajador y recibe las devoluciones desde faena."
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
                            {k.hint && <p className="text-[10px] font-bold text-destructive mt-1">{k.hint}</p>}
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
                ? <WithdrawalsInbox step={step} onStepChange={setStep} onNavigateAuthorizations={goAuthorizations} />
                : <ReturnsInbox />
            }
        </PageShell>
    );
}
