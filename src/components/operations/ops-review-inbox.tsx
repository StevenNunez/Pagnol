'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/empty-state';
import { Check, X, Clock, Loader2, Minus, Plus, Undo2, ClipboardCheck } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/lib/utils';
import { UrgencyBadge, ExpenseKindBadge, SuggestedSupplier, UrgencyReason, ServiceBadge, type RequestMeta } from './request-meta';

const REASON_MIN = 5;

export type OpsReviewLine = {
  /** id de la fila (compras) o posición en `items` (arriendos). */
  key: string;
  label: string;
  meta?: string;
  quantity: number;
  unit?: string;
};

export type OpsReviewGroup = {
  key: string;
  code?: string;
  requesterName?: string;
  contractName?: string;
  date?: Date | string | null;
  justification?: string;
  meta?: RequestMeta;
  lines: OpsReviewLine[];
};

export type OpsReviewResult = {
  quantities: Record<string, number>;
  removed: string[];
  note: string;
};

const fmtDate = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * RFC-006 F1 — Bandeja del Jefe de Operaciones. A diferencia de la del ADC, acá
 * se puede CORREGIR: cambiar cantidades y sacar líneas antes de aprobar. Lo que
 * se cambia queda a la vista del ADC ("pidió 10").
 */
export function OpsReviewInbox({
  groups,
  canReview,
  allowRemoveLines,
  typeLabel,
  typeBadgeClass = 'badge-success',
  lineIcon,
  nextStepLabel = 'Pasa al ADC para su autorización.',
  emptyTitle,
  emptyDescription,
  onApprove,
  onReject,
}: {
  groups: OpsReviewGroup[];
  canReview: boolean;
  /** Compras: se puede sacar una línea del pedido. Arriendos: sólo cantidades. */
  allowRemoveLines: boolean;
  typeLabel: string;
  typeBadgeClass?: string;
  lineIcon?: React.ReactNode;
  nextStepLabel?: string;
  emptyTitle: string;
  emptyDescription: string;
  onApprove: (group: OpsReviewGroup, result: OpsReviewResult) => Promise<unknown>;
  onReject: (group: OpsReviewGroup, note: string) => Promise<unknown>;
}) {
  if (groups.length === 0) {
    return <EmptyState icon={<ClipboardCheck size={22} />} title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <ReviewCard
          key={g.key}
          group={g}
          canReview={canReview}
          allowRemoveLines={allowRemoveLines}
          typeLabel={typeLabel}
          typeBadgeClass={typeBadgeClass}
          lineIcon={lineIcon}
          nextStepLabel={nextStepLabel}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </div>
  );
}

function ReviewCard({
  group, canReview, allowRemoveLines, typeLabel, typeBadgeClass, lineIcon, nextStepLabel, onApprove, onReject,
}: {
  group: OpsReviewGroup;
  canReview: boolean;
  allowRemoveLines: boolean;
  typeLabel: string;
  typeBadgeClass: string;
  lineIcon?: React.ReactNode;
  nextStepLabel: string;
  onApprove: (group: OpsReviewGroup, result: OpsReviewResult) => Promise<unknown>;
  onReject: (group: OpsReviewGroup, note: string) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const valueOf = (ln: OpsReviewLine) => qty[ln.key] ?? String(ln.quantity);
  const numOf = (ln: OpsReviewLine) => Math.floor(Number(valueOf(ln)));
  const changed = group.lines.some(ln => numOf(ln) !== ln.quantity) || removed.size > 0;
  const invalidQty = group.lines.some(ln => !removed.has(ln.key) && !(numOf(ln) >= 1));
  const allRemoved = removed.size === group.lines.length;
  const noteOk = note.trim().length >= REASON_MIN;
  // Sacar líneas o rechazar se explica: el supervisor lo va a leer.
  const approveNeedsNote = removed.size > 0;

  const step = (ln: OpsReviewLine, d: number) =>
    setQty(q => ({ ...q, [ln.key]: String(Math.max(1, (numOf(ln) || 0) + d)) }));
  const toggleRemove = (key: string) =>
    setRemoved(r => { const n = new Set(r); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const approve = async () => {
    setBusy('approve');
    try {
      const quantities: Record<string, number> = {};
      for (const ln of group.lines) quantities[ln.key] = numOf(ln);
      await onApprove(group, { quantities, removed: [...removed], note: note.trim() });
      toast({ title: 'Pedido revisado', description: nextStepLabel });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo guardar', description: e?.message || 'Error inesperado.' });
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy('reject');
    try {
      await onReject(group, note.trim());
      toast({ title: 'Pedido rechazado', description: 'El supervisor verá el motivo.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo rechazar', description: e?.message || 'Error inesperado.' });
      setBusy(null);
    }
  };

  return (
    <Card className={cn('rounded-[1.5rem] border-l-4 border-l-warning', busy && 'opacity-60 pointer-events-none')}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={typeBadgeClass}>{typeLabel}</Badge>
            {group.code && <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{group.code}</span>}
            {group.meta && <ServiceBadge req={group.meta} />}
            {group.meta && <UrgencyBadge req={group.meta} />}
            {group.meta && <ExpenseKindBadge req={group.meta} />}
          </div>
          <span className="text-xs text-muted-foreground flex items-center">
            <Clock className="h-3 w-3 mr-1" />{fmtDate(group.date)}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {group.requesterName && <span><b>Solicita:</b> {group.requesterName}</span>}
          {group.contractName && <span><b>Obra:</b> {group.contractName}</span>}
        </div>
        {group.justification && <div className="text-xs text-muted-foreground italic">"{group.justification}"</div>}
        {group.meta && <UrgencyReason req={group.meta} />}
        {group.meta && <SuggestedSupplier req={group.meta} />}

        {/* Líneas con cantidad editable */}
        <div className="rounded-2xl border divide-y">
          {group.lines.map(ln => {
            const isRemoved = removed.has(ln.key);
            const n = numOf(ln);
            return (
              <div key={ln.key} className={cn('flex flex-col sm:flex-row sm:items-center gap-3 p-3', isRemoved && 'bg-muted/50')}>
                <div className={cn('flex items-start gap-2 min-w-0 flex-1', isRemoved && 'line-through text-muted-foreground')}>
                  <span className="text-primary shrink-0 mt-0.5">{lineIcon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{ln.label}</p>
                    {ln.meta && <p className="text-[11px] text-muted-foreground">{ln.meta}</p>}
                  </div>
                </div>
                {!isRemoved && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-xl" disabled={!canReview} onClick={() => step(ln, -1)} aria-label="Restar uno">
                      <Minus size={14} />
                    </Button>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={valueOf(ln)}
                      disabled={!canReview}
                      onChange={e => setQty(q => ({ ...q, [ln.key]: e.target.value }))}
                      className={cn('h-9 w-20 rounded-xl text-center font-bold', n !== ln.quantity && 'border-warning text-warning')}
                      aria-label={`Cantidad de ${ln.label}`}
                    />
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-xl" disabled={!canReview} onClick={() => step(ln, 1)} aria-label="Sumar uno">
                      <Plus size={14} />
                    </Button>
                    {ln.unit && <span className="text-xs text-muted-foreground w-12 truncate">{ln.unit}</span>}
                  </div>
                )}
                {!isRemoved && n !== ln.quantity && n >= 1 && (
                  <span className="text-[10px] font-bold text-warning sm:w-16">pidió {ln.quantity}</span>
                )}
                {allowRemoveLines && canReview && group.lines.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 rounded-xl text-xs shrink-0" onClick={() => toggleRemove(ln.key)}>
                    {isRemoved ? <><Undo2 size={13} className="mr-1" /> Volver</> : <><X size={13} className="mr-1" /> Quitar</>}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {canReview && (
          <>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={approveNeedsNote ? 'Explica por qué quitaste líneas (lo verá el supervisor)' : 'Comentario para el ADC o el supervisor (opcional para aprobar, obligatorio para rechazar)'}
              className="rounded-xl min-h-[64px] text-sm"
            />
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <Button
                variant="outline"
                className="rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                disabled={!!busy || !noteOk}
                title={noteOk ? undefined : 'Escribe el motivo para poder rechazar'}
                onClick={reject}
              >
                {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <X className="h-4 w-4 mr-1" />} Rechazar pedido
              </Button>
              <Button
                className="rounded-xl gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                disabled={!!busy || invalidQty || allRemoved || (approveNeedsNote && !noteOk)}
                onClick={approve}
              >
                {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {changed ? 'Aprobar con cambios' : 'Aprobar'}
              </Button>
            </div>
            {!noteOk && (approveNeedsNote || note.length > 0) && (
              <p className="text-xs text-muted-foreground text-right">Escribe al menos {REASON_MIN} letras de motivo.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
