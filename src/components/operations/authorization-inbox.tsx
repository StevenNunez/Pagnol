'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { Check, X, Clock, Package, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';

// ── Forma normalizada de cualquier solicitud "autorizable" ────────────────────
// Material / Compra / Arriendo se mapean a esto antes de pasar por el inbox, así
// el componente es uno solo y no se duplica el flujo aprobar/rechazar por tipo.
export type ApprovableLine = { label: string; qty?: number; meta?: string };

export type ApprovableRequest = {
  id: string;
  code?: string;
  requesterName?: string;
  contractName?: string;
  date?: Date | string | null;
  lines: ApprovableLine[];
  justification?: string;
};

interface AuthorizationInboxProps {
  items: ApprovableRequest[];
  canAuthorize: boolean;
  onApprove: (id: string) => Promise<void> | void;
  /** El motivo es opcional; el inbox lo solicita en un diálogo al rechazar. */
  onReject: (id: string, reason?: string) => Promise<void> | void;
  /** Etiqueta de tipo mostrada como badge en cada tarjeta (ej. "Arriendo"). */
  typeLabel?: string;
  /** Clase de badge para `typeLabel` (mapa estático, dark-mode safe). */
  typeBadgeClass?: string;
  /** Ícono por línea (ej. <Truck/>); por defecto un paquete. */
  lineIcon?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
}

const fmtDate = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * Bandeja de autorización reutilizable (patrón de tarjetas Aprobar/Rechazar).
 * Es el único componente para la etapa de autorización del ADC en los 3 tipos
 * de solicitud. Si `canAuthorize` es falso, muestra los ítems en solo-lectura.
 */
export function AuthorizationInbox({
  items,
  canAuthorize,
  onApprove,
  onReject,
  typeLabel,
  typeBadgeClass = 'badge-info',
  lineIcon,
  emptyTitle = 'Nada por autorizar',
  emptyDescription = 'Las solicitudes pendientes de autorización aparecerán aquí.',
}: AuthorizationInboxProps) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovableRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const approve = async (req: ApprovableRequest) => {
    setBusyId(req.id);
    try {
      await onApprove(req.id);
      toast({ title: 'Solicitud autorizada', description: 'Pasó a Abastecimiento para su gestión.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo autorizar.' });
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    try {
      await onReject(rejecting.id, rejectReason.trim() || undefined);
      toast({ title: 'Solicitud rechazada' });
      setRejecting(null);
      setRejectReason('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo rechazar.' });
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) {
    return <EmptyState icon={<Package size={22} />} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      {!canAuthorize && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-warning/30 bg-warning-subtle text-warning-subtle-foreground text-sm">
          <AlertCircle className="h-4 w-4" /> No tienes permiso para autorizar estas solicitudes (solo lectura).
        </div>
      )}

      {items.map((req) => {
        const busy = busyId === req.id;
        return (
          <Card key={req.id} className="rounded-[1.5rem]">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  {typeLabel && <Badge className={typeBadgeClass}>{typeLabel}</Badge>}
                  {req.code && (
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{req.code}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground flex items-center">
                  <Clock className="h-3 w-3 mr-1" />{fmtDate(req.date)}
                </span>
              </div>

              <div className="space-y-0.5">
                {req.lines.map((ln, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm font-semibold">
                    <span className="text-primary shrink-0">{lineIcon ?? <Package className="h-3.5 w-3.5" />}</span>
                    {ln.label}
                    {ln.qty != null && <span className="text-muted-foreground font-normal">×{ln.qty}</span>}
                    {ln.meta && <span className="text-[10px] font-normal text-muted-foreground">({ln.meta})</span>}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {req.contractName && <span><b>Obra:</b> {req.contractName}</span>}
                {req.requesterName && <span><b>Solicita:</b> {req.requesterName}</span>}
              </div>
              {req.justification && <div className="text-xs text-muted-foreground italic">"{req.justification}"</div>}

              {canAuthorize && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="badge-success" disabled={busy}
                    onClick={() => approve(req)}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />} Autorizar
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" disabled={busy}
                    onClick={() => { setRejecting(req); setRejectReason(''); }}>
                    <X className="h-3.5 w-3.5 mr-1" /> Rechazar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Diálogo de rechazo con motivo opcional */}
      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o) { setRejecting(null); setRejectReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rechazar solicitud</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {rejecting?.code ? <span className="font-semibold text-foreground">{rejecting.code}</span> : 'Esta solicitud'} será marcada como rechazada.
            </p>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Motivo (opcional)</label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Indica por qué se rechaza…" className="rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => { setRejecting(null); setRejectReason(''); }}>Cancelar</Button>
            <Button variant="destructive" className="rounded-xl" disabled={!!busyId} onClick={confirmReject}>
              {busyId ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Rechazar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
