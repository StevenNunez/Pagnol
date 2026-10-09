'use client';

import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { resolveSigners, URGENT_REASON_MIN, URGENT_ROLES } from '@/modules/data/mutations/approvalMath';
import type { PurchaseProposalInput } from '@/modules/data/mutations/approvalMutations';
import type { ApprovalProposal } from '@/modules/core/lib/data';
import { AlertTriangle, Loader2, Send, Signature, UserCheck, Zap } from 'lucide-react';
import { clp } from './proposal-utils';

/**
 * RFC-006 F2 — "Enviar a firma". Muestra lo que se va a firmar (proveedor,
 * líneas, neto + IVA = total) y QUIÉN va a firmar, antes de mandarlo. La base
 * vuelve a calcular quién firma al guardar: esto es la vista previa.
 */
export function ProposalSubmitDialog({
  draft,
  onClose,
  onCreated,
}: {
  draft: (PurchaseProposalInput & { title?: string }) | null;
  onClose: () => void;
  onCreated?: (p: ApprovalProposal) => void;
}) {
  const { purchaseRequests, rentalRequests, contracts, users, currentTenant, createPurchaseProposal } = useAppState();
  const { toast } = useToast();
  const { user } = useAuth();
  const [escalate, setEscalate] = useState(false);
  const [reason, setReason] = useState('');
  // RFC-006 F3: comprar ya, firmar después.
  const [urgent, setUrgent] = useState(false);
  const [urgentReason, setUrgentReason] = useState('');
  const canUrgent = !!user && URGENT_ROLES.includes(user.role);
  const [saving, setSaving] = useState(false);

  // Cada vez que se abre para otra compra, parte limpio.
  const [shownKey, setShownKey] = useState<string | null>(null);
  const key = draft ? `${draft.sourceType}:${draft.sourceId}:${draft.quoteId}:${draft.supplierId}` : null;
  if (key !== shownKey) {
    setShownKey(key);
    setEscalate(false);
    setReason('');
    setUrgent(false);
    setUrgentReason('');
  }

  const userName = useMemo(() => new Map(((users || []) as any[]).map(u => [u.id, u.name as string])), [users]);

  const resolution = useMemo(() => {
    if (!draft) return null;
    const ids = new Set(draft.requestIds || []);
    // RFC-006 F4: un arriendo sale de solicitudes de arriendo, no de requerimientos de compra.
    const source = ((draft.kind === 'rental' ? rentalRequests : purchaseRequests) || []) as any[];
    const contractIds = new Set(source.filter(r => ids.has(r.id) && r.contractId).map(r => r.contractId as string));
    const reqsWithoutContract = source.filter(r => ids.has(r.id) && !r.contractId).length;
    const refs = ((contracts || []) as any[]).filter(c => contractIds.has(c.id)).map(c => ({ id: c.id, name: c.name, adcUserId: c.adcUserId }));
    return { ...resolveSigners({ net: draft.netTotal, settings: currentTenant?.approvalSettings, contracts: refs, escalate }), reqsWithoutContract };
  }, [draft, purchaseRequests, rentalRequests, contracts, currentTenant?.approvalSettings, escalate]);

  if (!draft || !resolution) return null;

  const byAmountIsGerente = resolution.tier === 'gerente' && !resolution.escalated;
  const isRental = draft.kind === 'rental';
  const blockedByAdc = resolution.tier === 'adc' && (!resolution.ready || resolution.reqsWithoutContract > 0);
  const reasonOk = (!escalate || reason.trim().length >= 5) && (!urgent || urgentReason.trim().length >= URGENT_REASON_MIN);

  const submit = async () => {
    setSaving(true);
    try {
      const p = await createPurchaseProposal({
        ...draft,
        escalate, escalationReason: escalate ? reason.trim() : undefined,
        urgent, urgencyReason: urgent ? urgentReason.trim() : undefined,
      });
      toast({
        title: urgent ? 'Compra urgente registrada' : 'Enviada a firma',
        description: urgent
          ? `${p.internalCode}: ya puedes emitir la OC. La firma de ${p.tier === 'gerente' ? 'el Gerente General' : 'el ADC'} queda pendiente.`
          : `${p.internalCode}: ${p.tier === 'gerente' ? 'la firma el Gerente General' : 'la firma el ADC del contrato'}. Cuando esté firmada podrás emitir la OC.`,
      });
      onCreated?.(p);
      onClose();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo enviar a firma', description: e?.message || 'Error inesperado.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-xl rounded-[1.5rem] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Signature className="h-5 w-5 text-primary" /> Enviar a firma</DialogTitle>
          <DialogDescription>
            {draft.title || 'Compra'} · <span className="font-semibold text-foreground">{draft.supplierName || 'Proveedor'}</span>.
            {isRental
              ? ' Se firma el valor mensual del arriendo; se adjudica recién cuando esté firmado.'
              : ' La OC se emite recién cuando esté firmada.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Líneas */}
          <div className="rounded-xl border divide-y text-sm">
            {draft.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{it.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {it.quantity} {it.unit || ''}{it.unitPrice ? ` × ${clp(it.unitPrice)}${isRental ? ' por período' : ''}` : ''}
                  </p>
                </div>
                {it.unitPrice && !isRental ? <span className="font-semibold shrink-0">{clp(it.quantity * it.unitPrice)}</span> : null}
              </div>
            ))}
          </div>

          {/* Totales */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{isRental ? 'Neto al mes' : 'Neto'}</p>
              <p className="font-bold mt-0.5">{clp(resolution.net)}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">IVA</p>
              <p className="font-bold mt-0.5">{clp(resolution.gross - resolution.net)}</p>
            </div>
            <div className="rounded-xl bg-primary/10 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary">{isRental ? 'Al mes con IVA' : 'Total con IVA'}</p>
              <p className="font-black text-lg mt-0.5 text-foreground">{clp(resolution.gross)}</p>
            </div>
          </div>

          {/* Quién firma */}
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Quién firma</p>
            {resolution.tier === 'gerente' ? (
              <div className="flex items-center gap-2 rounded-xl border p-3 text-sm">
                <UserCheck className="h-4 w-4 text-primary shrink-0" />
                <span><b>Gerente General</b> — {resolution.escalated ? 'la mandaste tú' : 'pasa el monto del ADC'}</span>
              </div>
            ) : (
              <>
                {resolution.signers.map(s => s.kind === 'adc' && (
                  <div key={s.contractId} className="flex items-center gap-2 rounded-xl border p-3 text-sm">
                    <UserCheck className="h-4 w-4 text-primary shrink-0" />
                    <span><b>{userName.get(s.userId) || 'ADC'}</b> — ADC de {s.contractName}</span>
                  </div>
                ))}
                {resolution.contractsWithoutAdc.length > 0 && (
                  <div className="flex items-start gap-2 rounded-xl bg-warning-subtle text-warning-subtle-foreground p-3 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Sin ADC asignado: <b>{resolution.contractsWithoutAdc.map(c => c.name).join(', ')}</b>. Asígnalo en
                      Configuración → Clientes y Contratos, o manda la compra al Gerente.
                    </span>
                  </div>
                )}
                {resolution.reqsWithoutContract > 0 && (
                  <div className="flex items-start gap-2 rounded-xl bg-warning-subtle text-warning-subtle-foreground p-3 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Hay {resolution.reqsWithoutContract} pedido(s) sin contrato: no hay ADC a quién pedirle la firma.</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Subir al Gerente (sólo si el monto no lo exige ya) */}
          {!byAmountIsGerente && (
            <div className="space-y-2 rounded-xl border p-3">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <Checkbox checked={escalate} onCheckedChange={v => setEscalate(v === true)} />
                Mandarla al Gerente General aunque no pase el monto
              </label>
              {escalate && (
                <Textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="¿Por qué? Ej: son 400 unidades, más de lo habitual para este contrato."
                  className="rounded-xl min-h-[64px] text-sm"
                />
              )}
            </div>
          )}
          {/* RFC-006 F3: comprar ya, firmar después (sólo Abastecimiento). */}
          {canUrgent && (
            <div className={`space-y-2 rounded-xl border p-3 ${urgent ? 'border-warning bg-warning-subtle/40' : ''}`}>
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <Checkbox checked={urgent} onCheckedChange={v => setUrgent(v === true)} />
                {isRental ? 'Es urgente: adjudicar ya y firmar después' : 'Es urgente: emitir la OC ya y firmar después'}
              </label>
              {urgent && (
                <>
                  <Textarea
                    value={urgentReason}
                    onChange={e => setUrgentReason(e.target.value)}
                    placeholder="¿Por qué no puede esperar la firma? Ej: la chancadora está detenida sin este repuesto."
                    className="rounded-xl min-h-[64px] text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Queda registrada como urgencia: quien firma la ve marcada y aparece en el reporte de compras urgentes.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" className="rounded-xl" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="rounded-xl gap-2" onClick={submit} disabled={saving || (blockedByAdc && !escalate) || !reasonOk}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : urgent ? <Zap className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {urgent ? 'Registrar urgencia' : 'Enviar a firma'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
