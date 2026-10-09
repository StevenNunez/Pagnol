'use client';

import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/lib/utils';
import { CheckCircle2, Clock, FileCheck, Loader2, Undo2, XCircle, Zap } from 'lucide-react';
import { canEmitWith } from '@/modules/data/mutations/approvalMath';
import type { ApprovalSlot } from '@/modules/core/lib/data';
import { STATE_META, clp, type ProposalView } from './proposal-utils';

/** Nombre del puesto de firma, para la persona: "Carolina Muñoz (ADC Contrato Torres)". */
export function slotLabel(slot: ApprovalSlot, userName: Map<string, string>): string {
  if (slot.kind === 'gerente') return 'Gerente General';
  return `${userName.get(slot.userId) || 'ADC'} (ADC ${slot.contractName})`;
}

/**
 * Estado de la propuesta de una compra, para Abastecimiento: quién firmó, quién
 * falta, por qué se rechazó; y las acciones que corresponden (emitir la OC
 * cuando está firmada, retirarla mientras no tenga OC).
 */
export function ProposalStatusPanel({
  view,
  onEmit,
  emitLabel = 'Emitir OC',
  className,
}: {
  view: ProposalView;
  /** Emite la OC con esta propuesta. Sólo se ofrece si está firmada y sin OC. */
  onEmit?: () => Promise<unknown>;
  emitLabel?: string;
  className?: string;
}) {
  const { users, withdrawProposal, can } = useAppState();
  const { toast } = useToast();
  const [busy, setBusy] = useState<'emit' | 'withdraw' | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState('');
  const userName = useMemo(() => new Map(((users || []) as any[]).map(u => [u.id, u.name as string])), [users]);

  const { proposal: p, state, signatures, orderId } = view;
  const meta = STATE_META[state];
  const canManage = can('finance:manage_purchase_orders');

  const signatureFor = (slot: ApprovalSlot) =>
    signatures.find(s => s.slotKind === slot.kind && (slot.kind === 'gerente' || s.contractId === slot.contractId));

  const emit = async () => {
    if (!onEmit) return;
    setBusy('emit');
    try {
      await onEmit();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo emitir la OC', description: e?.message || 'Error inesperado.' });
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    setBusy('withdraw');
    try {
      await withdrawProposal(p.id, reason.trim());
      toast({ title: 'Propuesta retirada', description: 'Puedes armar una nueva y enviarla a firma.' });
      setWithdrawing(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo retirar', description: e?.message || 'Error inesperado.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn('rounded-xl border p-3 space-y-3 text-sm', className)}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={cn('border-none', meta.cls)}>{meta.label}</Badge>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{p.internalCode}</span>
          {p.urgent && <Badge className="badge-warning border-none gap-1"><Zap className="h-3 w-3" /> Urgente</Badge>}
          {orderId && <Badge className="badge-info border-none">OC emitida</Badge>}
        </div>
        <span className="font-bold">{clp(p.grossTotal)} <span className="text-xs font-normal text-muted-foreground">con IVA</span></span>
      </div>

      {/* Firmantes */}
      <div className="space-y-1.5">
        {p.requiredSigners.map((slot, i) => {
          const s = signatureFor(slot);
          return (
            <div key={i} className="flex items-start gap-2 text-xs">
              {s?.decision === 'approved' ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                : s?.decision === 'rejected' ? <XCircle className="h-4 w-4 text-destructive shrink-0" />
                : <Clock className="h-4 w-4 text-warning shrink-0" />}
              <div className="min-w-0">
                <p>
                  <b>{slotLabel(slot, userName)}</b>
                  {s ? ` — ${s.decision === 'approved' ? 'firmó' : 'rechazó'}${s.signerName && s.signerName !== userName.get((slot as any).userId) ? ` (${s.signerName})` : ''}` : ' — pendiente'}
                </p>
                {s?.note && <p className="text-muted-foreground italic">"{s.note}"</p>}
              </div>
            </div>
          );
        })}
        {p.escalated && <p className="text-xs text-muted-foreground">Enviada al Gerente por Abastecimiento: {p.escalationReason}</p>}
        {p.urgent && <p className="text-xs text-muted-foreground">Urgencia: {p.urgencyReason}{state === 'pending' ? ' — la firma queda pendiente.' : ''}</p>}
        {state === 'withdrawn' && p.withdrawnReason && <p className="text-xs text-muted-foreground">Retirada: {p.withdrawnReason}</p>}
      </div>

      {canManage && canEmitWith(state, p.urgent) && !orderId && onEmit && (
        <Button className="w-full rounded-xl gap-2" onClick={emit} disabled={!!busy}>
          {busy === 'emit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />} {emitLabel}
        </Button>
      )}

      {canManage && !orderId && (state === 'pending' || state === 'approved') && (
        withdrawing ? (
          <div className="space-y-2">
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="¿Por qué la retiras? (ej: el proveedor cambió el precio)" className="rounded-xl min-h-[56px] text-xs" />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setWithdrawing(false)} disabled={!!busy}>Cancelar</Button>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={withdraw} disabled={!!busy || reason.trim().length < 5}>
                {busy === 'withdraw' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Retirar propuesta'}
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setWithdrawing(true)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Undo2 className="h-3 w-3" /> Retirar propuesta
          </button>
        )
      )}
    </div>
  );
}
