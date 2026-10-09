'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/empty-state';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/lib/utils';
import { canSignSlot, deriveProposalState, pendingSlots } from '@/modules/data/mutations/approvalMath';
import type { ApprovalProposal, ApprovalSlot, PurchaseRequest } from '@/modules/core/lib/data';
import { Check, Clock, Loader2, Signature, Trophy, X, Zap } from 'lucide-react';
import { clp } from './proposal-utils';
import { slotLabel } from './proposal-status-panel';

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * RFC-006 F2 — Bandeja "Por firmar". Muestra a cada firmante las compras que le
 * tocan, con todo lo necesario para decidir: total con IVA, líneas, las otras
 * ofertas con que se comparó, de qué pedidos sale y quién la propuso.
 */
export function ProposalSignInbox({ proposals }: { proposals: ApprovalProposal[] }) {
  if (proposals.length === 0) {
    return (
      <EmptyState
        icon={<Signature size={22} />}
        title="Nada por firmar"
        description="Cuando Abastecimiento envíe una compra que te toca firmar según el monto, aparecerá aquí."
      />
    );
  }
  return <div className="space-y-4">{proposals.map(p => <SignCard key={p.id} proposal={p} />)}</div>;
}

/** Propuestas pendientes donde esta persona tiene algo que firmar. */
export function useProposalsToSign(): ApprovalProposal[] {
  const { approvalProposals, approvalSignatures } = useAppState();
  const { user } = useAuth();
  return useMemo(() => {
    if (!user) return [];
    const sigs = approvalSignatures || [];
    return (approvalProposals || [])
      .filter(p => deriveProposalState(p, sigs) === 'pending')
      .filter(p => pendingSlots(p, sigs).some(slot => canSignSlot(user, slot)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [approvalProposals, approvalSignatures, user]);
}

function SignCard({ proposal: p }: { proposal: ApprovalProposal }) {
  const { approvalSignatures, users, purchaseRequests, rentalRequests, purchaseOrders, signProposal } = useAppState();
  const isRental = p.kind === 'rental';
  const orderEmitted = (purchaseOrders || []).some(o => o.approvalProposalId === p.id && o.status !== 'cancelled');
  const { user } = useAuth();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const userName = useMemo(() => new Map(((users || []) as any[]).map(u => [u.id, u.name as string])), [users]);
  const sigs = (approvalSignatures || []).filter(s => s.proposalId === p.id);
  const mySlots = pendingSlots(p, sigs).filter(slot => canSignSlot(user, slot));
  // RFC-006 F4: un arriendo sale de solicitudes de arriendo.
  const requests = (((isRental ? rentalRequests : purchaseRequests) || []) as any[]).filter(r => p.requestIds.includes(r.id)) as (PurchaseRequest & { supervisorName?: string })[];
  const requesters = [...new Set(requests.map(r => r.requesterName || r.supervisorName).filter(Boolean))].join(', ');
  const contracts = [...new Set(requests.map(r => r.contractName).filter(Boolean))].join(', ');
  const justification = requests.find(r => r.justification)?.justification;
  const noteOk = note.trim().length >= 5;

  const act = async (slot: ApprovalSlot, decision: 'approved' | 'rejected') => {
    const key = `${decision}:${slot.kind}:${slot.kind === 'adc' ? slot.contractId : ''}`;
    setBusy(key);
    try {
      await signProposal({ proposalId: p.id, slot, decision, note: note.trim() || undefined });
      toast({
        title: decision === 'approved' ? 'Compra firmada' : 'Compra rechazada',
        description: decision === 'approved' ? 'Abastecimiento ya puede emitir la OC (si no faltan otras firmas).' : 'Abastecimiento verá tu motivo.',
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo guardar', description: e?.message || 'Error inesperado.' });
      setBusy(null);
    }
  };

  return (
    <Card className={cn('rounded-[1.5rem] border-l-4 border-l-primary', busy && 'opacity-60 pointer-events-none')}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={isRental ? 'badge-warning' : 'badge-success'}>{isRental ? 'Arriendo' : 'Compra'}</Badge>
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{p.internalCode}</span>
              {p.tier === 'gerente' && <Badge className="badge-warning border-none">{p.escalated ? 'Enviada al Gerente' : 'Sobre el monto del ADC'}</Badge>}
              {p.urgent && <Badge className="bg-destructive/10 text-destructive border-none gap-1"><Zap className="h-3 w-3" /> Urgente</Badge>}
            </div>
            <p className="text-lg font-bold">{p.supplierName || 'Proveedor'}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Propuesta por {p.createdByName || 'Abastecimiento'} · {fmtDate(p.createdAt)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{isRental ? 'Valor mensual con IVA' : 'Total con IVA'}</p>
            <p className="text-2xl font-black">{clp(p.grossTotal)}{isRental && <span className="text-sm font-semibold text-muted-foreground"> /mes</span>}</p>
            <p className="text-xs text-muted-foreground">{clp(p.netTotal)} neto + {clp(p.grossTotal - p.netTotal)} IVA</p>
          </div>
        </div>

        {p.urgent && (
          <p className="text-xs rounded-lg bg-destructive/10 text-destructive px-3 py-2">
            <b>{isRental ? 'Arriendo urgente' : 'Compra urgente'}{orderEmitted ? ': la OC ya se emitió' : ''}.</b> Motivo: {(p.urgencyReason || '').replace(/[.\s]+$/, '')}.{' '}
            {orderEmitted ? 'Tu firma la ratifica; si la rechazas, queda registrado en el reporte de urgencias.' : ''}
          </p>
        )}

        {p.escalated && p.escalationReason && (
          <p className="text-xs rounded-lg bg-warning-subtle text-warning-subtle-foreground px-3 py-2">
            <b>Por qué te la mandaron:</b> {p.escalationReason}
          </p>
        )}

        {/* Qué se compra */}
        <div className="rounded-xl border divide-y text-sm">
          {p.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{it.name}</p>
                <p className="text-xs text-muted-foreground">{it.quantity} × {it.unitPrice ? `${clp(it.unitPrice)}${isRental ? ` por período (${it.unit || ''})` : ` ${it.unit || ''}`}` : it.unit || ''}</p>
              </div>
              {it.unitPrice && !isRental ? <span className="font-semibold shrink-0">{clp(it.quantity * it.unitPrice)}</span> : null}
            </div>
          ))}
        </div>

        {/* Con qué se comparó */}
        {p.comparison && p.comparison.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{isRental ? 'Ofertas recibidas (neto al mes)' : 'Ofertas recibidas (neto)'}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {[...p.comparison].sort((a, b) => a.totalPrice - b.totalPrice).map((c, i) => (
                <div key={i} className={cn('flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs border', c.chosen && 'border-primary bg-primary/5 font-semibold')}>
                  <span className="truncate flex items-center gap-1">{c.chosen && <Trophy className="h-3 w-3 text-primary" />}{c.supplierName}</span>
                  <span className="shrink-0">{clp(c.totalPrice)}{c.deliveryDays != null ? ` · ${c.deliveryDays} d` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* De dónde sale */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {contracts && <span><b>Obra:</b> {contracts}</span>}
          {requesters && <span><b>Pidió:</b> {requesters}</span>}
          <span><b>Pedidos:</b> {requests.map(r => r.internalCode).filter(Boolean).join(', ') || p.requestIds.length}</span>
        </div>
        {justification && <p className="text-xs text-muted-foreground italic">"{justification}"</p>}

        {/* Otras firmas de la misma compra */}
        {p.requiredSigners.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Firman: {p.requiredSigners.map(s => slotLabel(s, userName)).join(' · ')}
          </p>
        )}

        <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Comentario (obligatorio para rechazar)" className="rounded-xl min-h-[56px] text-sm" />
        {mySlots.map(slot => {
          const k = `${slot.kind}:${slot.kind === 'adc' ? slot.contractId : ''}`;
          return (
            <div key={k} className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end sm:items-center">
              {mySlots.length > 1 && <span className="text-xs text-muted-foreground sm:mr-auto">Como {slotLabel(slot, userName)}</span>}
              <Button
                variant="outline"
                className="rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                disabled={!!busy || !noteOk}
                title={noteOk ? undefined : 'Escribe el motivo para poder rechazar'}
                onClick={() => act(slot, 'rejected')}
              >
                {busy === `rejected:${k}` ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <X className="h-4 w-4 mr-1" />} Rechazar
              </Button>
              <Button className="rounded-xl gap-1.5 bg-success text-success-foreground hover:bg-success/90" disabled={!!busy} onClick={() => act(slot, 'approved')}>
                {busy === `approved:${k}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Firmar {clp(p.grossTotal)}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
