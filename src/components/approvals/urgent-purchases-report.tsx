'use client';

import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { cn } from '@/lib/utils';
import { Zap } from 'lucide-react';
import { proposalsForSource, clp, type ProposalView } from './proposal-utils';

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Cómo terminó la firma de una compra urgente, en palabras de la faena. */
function outcome(v: ProposalView): { label: string; cls: string } {
  if (v.state === 'approved') return { label: 'Firma ratificada', cls: 'badge-success' };
  if (v.state === 'rejected') return { label: v.orderId ? 'Rechazada después de comprar' : 'Rechazada', cls: 'bg-destructive/10 text-destructive' };
  if (v.state === 'withdrawn') return { label: 'Retirada', cls: 'bg-muted text-muted-foreground' };
  return { label: v.orderId ? 'Comprada · firma pendiente' : 'Firma pendiente', cls: 'badge-warning' };
}

/**
 * RFC-006 F3 — Reporte de compras urgentes (comprar ya, firmar después). Lo ven
 * Abastecimiento, los firmantes y administración, para que la urgencia no se
 * vuelva la forma normal de comprar.
 */
export function UrgentPurchasesReport() {
  const { approvalProposals, approvalSignatures, purchaseOrders } = useAppState();
  const views = useMemo(
    () => proposalsForSource(approvalProposals, approvalSignatures, purchaseOrders, p => p.urgent),
    [approvalProposals, approvalSignatures, purchaseOrders],
  );

  const kpis = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const thisMonth = views.filter(v => new Date(v.proposal.createdAt) >= monthStart);
    return {
      month: thisMonth.length,
      monthAmount: thisMonth.reduce((a, v) => a + v.proposal.grossTotal, 0),
      pending: views.filter(v => v.state === 'pending').length,
      rejectedAfter: views.filter(v => v.state === 'rejected' && v.orderId).length,
    };
  }, [views]);

  if (views.length === 0) {
    return <EmptyState icon={<Zap size={22} />} title="Sin compras urgentes" description="Aquí aparecen las compras que se emitieron antes de la firma, con su motivo y cómo terminó." />;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Urgentes este mes', value: String(kpis.month) },
          { label: 'Monto este mes (con IVA)', value: clp(kpis.monthAmount) },
          { label: 'Firma pendiente', value: String(kpis.pending), warn: kpis.pending > 0 },
          { label: 'Rechazadas después de comprar', value: String(kpis.rejectedAfter), bad: kpis.rejectedAfter > 0 },
        ].map(k => (
          <Card key={k.label} className="rounded-[1.5rem]">
            <CardContent className="p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{k.label}</p>
              <p className={cn('text-2xl font-black mt-1', k.warn && 'text-warning', k.bad && 'text-destructive')}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        {views.map(v => {
          const o = outcome(v);
          const rejection = v.signatures.find(s => s.decision === 'rejected');
          return (
            <Card key={v.proposal.id} className="rounded-[1.5rem]">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="badge-warning border-none gap-1"><Zap className="h-3 w-3" /> Urgente</Badge>
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{v.proposal.internalCode}</span>
                    <Badge className={cn('border-none', o.cls)}>{o.label}</Badge>
                  </div>
                  <span className="font-bold">{clp(v.proposal.grossTotal)} <span className="text-xs font-normal text-muted-foreground">con IVA</span></span>
                </div>
                <p className="text-sm"><b>{v.proposal.supplierName}</b> · {v.proposal.items.map(i => `${i.quantity} ${i.name}`).join(', ')}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(v.proposal.createdAt)} · {v.proposal.createdByName || 'Abastecimiento'} · firma: {v.proposal.tier === 'gerente' ? 'Gerente General' : 'ADC del contrato'}
                </p>
                <p className="text-xs"><b>Motivo:</b> {v.proposal.urgencyReason}</p>
                {rejection?.note && <p className="text-xs text-destructive"><b>{rejection.signerName}:</b> "{rejection.note}"</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
