'use client';

import React, { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft, Plus, Trash2, Pencil, Package, CalendarClock, CheckCircle2, ListPlus,
  PackageCheck, Undo2, FileText, Download, Mail, Send, Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { RentalAsset, RentalAssetCategory, RentalPayment } from '@/modules/core/lib/data';
import { rentalCategoryLabel } from '@/modules/core/lib/data';
import { generateRentalOcPDF, type RentalCompanyInfo } from '@/lib/pdf-rental';
import { supabase } from '@/modules/core/lib/supabase';

const IVA_RATE = 0.19;
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
import {
  DIRECTION_LABEL, DIRECTION_BADGE, DIRECTION_SHORT, BILLING_CYCLE_LABEL,
  CONTRACT_STATUS_LABEL, CONTRACT_STATUS_BADGE,
  PAYMENT_STATUS_LABEL, PAYMENT_STATUS_BADGE, formatMoney, derivePaymentStatus,
  ASSET_STATUS_LABEL, ASSET_STATUS_BADGE,
} from '../../_lib/helpers';

const EMPTY_ASSET = {
  name: '', category: 'machinery' as RentalAssetCategory, identifier: '',
  quantity: '1', unitPrice: '', notes: '',
};

export default function RentalContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contractId = String(params.id);
  const {
    rentalContracts, rentalParties, suppliers, rentalAssets, rentalPayments, currentTenant,
    addRentalAsset, updateRentalAsset, deleteRentalAsset, returnRentalAsset,
    generateRentalSchedule, markRentalOcSent, confirmRentalOc, markRentalPaymentPaid, deleteRentalPayment,
    closeRentalContract,
    can, notify,
  } = useAppState();
  const { user } = useAuth();

  const canManageContracts = can('rentals:manage_contracts');
  const canManagePayments = can('rentals:manage_payments');

  const contract = rentalContracts?.find((c) => c.id === contractId);
  // La contraparte puede ser un proveedor (arrendador, incoming) o un cliente
  // (rentalParties, outgoing). Se normaliza a una vista común con `contactName`.
  const party = useMemo(() => {
    const id = contract?.partyId;
    if (!id) return undefined;
    const sup = suppliers?.find((s) => s.id === id);
    if (sup) {
      return { name: sup.name, rut: sup.rut, address: sup.address, email: sup.email, phone: sup.phone, contactName: sup.contacts?.[0]?.name };
    }
    const cli = rentalParties?.find((p) => p.id === id);
    if (cli) {
      return { name: cli.name, rut: cli.rut, address: cli.address, email: cli.email, phone: cli.phone, contactName: cli.contactName };
    }
    return undefined;
  }, [contract?.partyId, suppliers, rentalParties]);
  const assets = useMemo(() => (rentalAssets || []).filter((a) => a.contractId === contractId), [rentalAssets, contractId]);
  const payments = useMemo(
    () => (rentalPayments || []).filter((p) => p.contractId === contractId)
      .sort((a, b) => new Date(a.dueDate as any).getTime() - new Date(b.dueDate as any).getTime()),
    [rentalPayments, contractId],
  );

  // Asset dialog
  const [assetOpen, setAssetOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<RentalAsset | null>(null);
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET);
  const [savingAsset, setSavingAsset] = useState(false);

  // Schedule dialog
  const [schedOpen, setSchedOpen] = useState(false);
  const [installments, setInstallments] = useState('12');
  const [generating, setGenerating] = useState(false);

  // Mark paid dialog
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidMethod, setPaidMethod] = useState('');

  // Close contract (return) dialog
  const [closeOpen, setCloseOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [closeNotes, setCloseNotes] = useState('');
  const [cancelFuture, setCancelFuture] = useState(true);
  const [closing, setClosing] = useState(false);

  // Return single asset dialog
  const [returningAsset, setReturningAsset] = useState<RentalAsset | null>(null);
  const [assetReturnDate, setAssetReturnDate] = useState(new Date().toISOString().slice(0, 10));

  // OC flow
  const [confirmOcOpen, setConfirmOcOpen] = useState(false);
  const [ocInstallments, setOcInstallments] = useState('12');
  const [ocTermsDays, setOcTermsDays] = useState('30');
  const [confirmingOc, setConfirmingOc] = useState(false);
  const [ocEmailOpen, setOcEmailOpen] = useState(false);
  const [ocEmailTo, setOcEmailTo] = useState('');
  const [ocEmailMsg, setOcEmailMsg] = useState('');
  const [sendingOc, setSendingOc] = useState(false);

  if (!contract) {
    return (
      <PageShell title="Contrato de arriendo">
        <EmptyState icon={<Package size={22} />} title="Contrato no encontrado" description="Puede haber sido eliminado." />
        <Button variant="outline" className="rounded-xl gap-2" onClick={() => router.push('/dashboard/rentals/contracts')}>
          <ArrowLeft className="h-4 w-4" /> Volver a contratos
        </Button>
      </PageShell>
    );
  }

  const openNewAsset = () => { setEditingAsset(null); setAssetForm(EMPTY_ASSET); setAssetOpen(true); };
  const openEditAsset = (a: RentalAsset) => {
    setEditingAsset(a);
    setAssetForm({
      name: a.name, category: a.category, identifier: a.identifier ?? '',
      quantity: String(a.quantity ?? 1), unitPrice: a.unitPrice != null ? String(a.unitPrice) : '', notes: a.notes ?? '',
    });
    setAssetOpen(true);
  };

  const saveAsset = async () => {
    if (!assetForm.name.trim()) { notify('El nombre del activo es obligatorio.', 'destructive'); return; }
    setSavingAsset(true);
    const payload = {
      contractId,
      name: assetForm.name,
      category: assetForm.category,
      identifier: assetForm.identifier || undefined,
      quantity: Number(assetForm.quantity) || 1,
      unitPrice: assetForm.unitPrice ? Number(assetForm.unitPrice) : undefined,
      status: 'active' as const,
      notes: assetForm.notes || undefined,
    };
    try {
      if (editingAsset) { await updateRentalAsset(editingAsset.id, payload); notify('Activo actualizado.', 'success'); }
      else { await addRentalAsset(payload); notify('Activo agregado.', 'success'); }
      setAssetOpen(false);
    } catch (e: any) {
      notify(e?.message || 'No se pudo guardar el activo.', 'destructive');
    } finally {
      setSavingAsset(false);
    }
  };

  const removeAsset = async (a: RentalAsset) => {
    try { await deleteRentalAsset(a.id); notify('Activo eliminado.', 'success'); }
    catch (e: any) { notify(e?.message || 'No se pudo eliminar.', 'destructive'); }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      await generateRentalSchedule(contractId, Number(installments) || 1, undefined);
      notify('Calendario de pagos generado.', 'success');
      setSchedOpen(false);
    } catch (e: any) {
      notify(e?.message || 'No se pudo generar el calendario.', 'destructive');
    } finally {
      setGenerating(false);
    }
  };

  const confirmPaid = async () => {
    if (!payingId) return;
    try {
      await markRentalPaymentPaid(payingId, { paidDate, paymentMethod: paidMethod || undefined });
      notify('Pago registrado.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo registrar el pago.', 'destructive');
    } finally {
      setPayingId(null); setPaidMethod('');
    }
  };

  const removePayment = async (p: RentalPayment) => {
    try { await deleteRentalPayment(p.id); notify('Cuota eliminada.', 'success'); }
    catch (e: any) { notify(e?.message || 'No se pudo eliminar.', 'destructive'); }
  };

  const confirmClose = async () => {
    setClosing(true);
    try {
      await closeRentalContract(contractId, { returnDate, notes: closeNotes || undefined, cancelFuturePayments: cancelFuture });
      notify('Arriendo cerrado. Equipos marcados como devueltos.', 'success');
      setCloseOpen(false);
      setCloseNotes('');
    } catch (e: any) {
      notify(e?.message || 'No se pudo cerrar el arriendo.', 'destructive');
    } finally {
      setClosing(false);
    }
  };

  const confirmReturnAsset = async () => {
    if (!returningAsset) return;
    try {
      await returnRentalAsset(returningAsset.id, assetReturnDate);
      notify('Equipo marcado como devuelto.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo registrar la devolución.', 'destructive');
    } finally {
      setReturningAsset(null);
    }
  };

  // ── Orden de Compra (OC) ─────────────────────────────────────────────────
  const ocStatus = contract.ocStatus ?? 'confirmed';
  const ocConfirmed = ocStatus === 'confirmed';
  const taxRate = contract.taxRate ?? 19;

  const company: RentalCompanyInfo = {
    name: currentTenant?.name || 'PAGNOL',
    rut: currentTenant?.rut,
    address: currentTenant?.address,
    logoUrl: currentTenant?.logoUrl,
  };

  const buildOcPdf = async () => {
    // La OC se desglosa por equipo (una fila por activo, con su precio unitario).
    // Guard: si la suma de los activos no cuadra con el neto del contrato
    // (datos antiguos donde cada activo quedó con el total), se cae a una sola
    // línea anclada a `contract.amount` para no inflar ni descuadrar el total.
    const assetsNet = assets.reduce((s, a) => s + (a.unitPrice || 0) * (a.quantity || 1), 0);
    const itemized = assets.length > 0 && assetsNet > 0
      && Math.abs(assetsNet - contract.amount) <= Math.max(1, contract.amount * 0.02);
    const ocItems = itemized
      ? assets.map((a) => ({
          name: a.name,
          category: a.category,
          quantity: a.quantity ?? 1,
          unitPrice: a.unitPrice ?? 0,
          billingCycle: contract.billingCycle,
        }))
      : [{
          name: assets.length ? assets.map((a) => `${a.name} ×${a.quantity}`).join(', ') : contract.title,
          category: assets[0]?.category || 'machinery',
          quantity: 1,
          unitPrice: contract.amount,
          billingCycle: contract.billingCycle,
        }];
    return generateRentalOcPDF({
      company,
      ocNumber: contract.ocNumber || contract.id.slice(0, 8),
      lessor: party ? {
        name: party.name, rut: party.rut, address: party.address,
        contactName: party.contactName, email: party.email, phone: party.phone,
      } : undefined,
      project: contract.title,
      items: ocItems,
      currency: contract.currency,
      taxRate,
      billingCycle: contract.billingCycle,
      paymentTerms: `${contract.paymentTermsDays ?? 30} días`,
    });
  };

  const handleDownloadOc = async () => {
    try {
      const { blob, filename } = await buildOcPdf();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      document.body.removeChild(a); window.URL.revokeObjectURL(url);
    } catch (e: any) {
      notify(e?.message || 'No se pudo generar la OC.', 'destructive');
    }
  };

  const openOcEmail = () => {
    setOcEmailTo(party?.email || '');
    setOcEmailMsg('');
    setOcEmailOpen(true);
  };

  const handleSendOc = async () => {
    const recipients = ocEmailTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) { notify('Indica al menos un destinatario.', 'destructive'); return; }
    setSendingOc(true);
    try {
      const { blob, filename } = await buildOcPdf();
      const pdfBase64 = await blobToBase64(blob);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Sesión no disponible.');
      const res = await fetch('/api/purchasing/send-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: recipients,
          subject: `Orden de Compra de arriendo ${contract.ocNumber || ''}`.trim(),
          message: ocEmailMsg.trim() || undefined,
          pdfBase64, filename, orderCode: contract.ocNumber || '',
          docLabel: 'Orden de Compra de arriendo',
          companyName: company.name, companyLogoUrl: company.logoUrl,
          senderName: user?.name, senderEmail: user?.email, senderPhone: user?.phone, senderRole: user?.cargo,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      // No revertir el estado si la OC ya está confirmada (reenvío posterior).
      if (!ocConfirmed) await markRentalOcSent(contract.id);
      notify(`OC enviada a ${recipients.join(', ')}.`, 'success');
      setOcEmailOpen(false);
    } catch (e: any) {
      notify(e?.message || 'No se pudo enviar la OC.', 'destructive');
    } finally {
      setSendingOc(false);
    }
  };

  const handleConfirmOc = async () => {
    setConfirmingOc(true);
    try {
      await confirmRentalOc(contract.id, {
        installments: Number(ocInstallments) || 1,
        firstDueOffsetDays: Number(ocTermsDays) || 0,
      });
      notify('OC confirmada. Contrato activo y calendario de pagos generado.', 'success');
      setConfirmOcOpen(false);
    } catch (e: any) {
      notify(e?.message || 'No se pudo confirmar la OC.', 'destructive');
    } finally {
      setConfirmingOc(false);
    }
  };

  const totalPaid = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter((p) => p.status !== 'paid').reduce((s, p) => s + p.amount, 0);
  const netPerCycle = contract.amount;
  const ivaPerCycle = taxRate > 0 ? netPerCycle * (taxRate / 100) : 0;
  const totalPerCycle = netPerCycle + ivaPerCycle;
  // Suma de los activos (precio × cantidad). Debería igualar el neto del contrato.
  const assetsNetSum = assets.reduce((s, a) => s + (a.unitPrice || 0) * (a.quantity || 1), 0);
  const assetsPriced = assets.some((a) => a.unitPrice != null);
  const assetsMatchNet = !assetsPriced || Math.abs(assetsNetSum - netPerCycle) <= Math.max(1, netPerCycle * 0.02);

  const assetColumns: DataTableColumn<RentalAsset>[] = [
    { key: 'name', header: 'Activo', cell: (a) => <span className="font-semibold text-foreground">{a.name}</span> },
    { key: 'cat', header: 'Categoría', cell: (a) => <span className="text-muted-foreground">{rentalCategoryLabel(a.category)}</span> },
    { key: 'id', header: 'Patente / Serie', cell: (a) => <span className="text-muted-foreground">{a.identifier || '—'}</span> },
    { key: 'qty', header: 'Cant.', cell: (a) => <span className="tabular-nums">{a.quantity}</span> },
    { key: 'price', header: 'Precio unit.', cell: (a) => <span className="tabular-nums">{a.unitPrice != null ? formatMoney(a.unitPrice, contract.currency) : '—'}</span> },
    { key: 'subtotal', header: 'Subtotal', cell: (a) => <span className="tabular-nums font-medium text-foreground">{a.unitPrice != null ? formatMoney((a.unitPrice || 0) * (a.quantity || 1), contract.currency) : '—'}</span> },
    {
      key: 'status', header: 'Estado',
      cell: (a) => {
        const s = a.status === 'returned' ? 'returned' : 'active';
        return (
          <div className="flex flex-col gap-0.5">
            <Badge variant="outline" className={ASSET_STATUS_BADGE[s]}>{ASSET_STATUS_LABEL[s]}</Badge>
            {s === 'returned' && a.endDate && <span className="text-[11px] text-muted-foreground">{fmtDate(a.endDate)}</span>}
          </div>
        );
      },
    },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (a) => canManageContracts ? (
        <div className="flex justify-end gap-1">
          {a.status !== 'returned' && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-info-subtle-foreground" onClick={() => { setReturningAsset(a); setAssetReturnDate(new Date().toISOString().slice(0, 10)); }}>
              <Undo2 className="h-4 w-4" /> Devolver
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditAsset(a)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => removeAsset(a)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : null,
    },
  ];

  const paymentColumns: DataTableColumn<RentalPayment>[] = [
    { key: 'due', header: 'Vencimiento', cell: (p) => <span className="font-medium">{fmtDate(p.dueDate)}</span> },
    { key: 'amount', header: 'Monto', cell: (p) => <span className="tabular-nums">{formatMoney(p.amount, contract.currency)}</span> },
    {
      key: 'status', header: 'Estado',
      cell: (p) => { const s = derivePaymentStatus(p); return <Badge variant="outline" className={PAYMENT_STATUS_BADGE[s]}>{PAYMENT_STATUS_LABEL[s]}</Badge>; },
    },
    { key: 'paid', header: 'Pagado el', cell: (p) => <span className="text-muted-foreground">{p.paidDate ? fmtDate(p.paidDate) : '—'}</span> },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          {canManagePayments && p.status !== 'paid' && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-success-subtle-foreground" onClick={() => { setPayingId(p.id); setPaidDate(new Date().toISOString().slice(0, 10)); }}>
              <CheckCircle2 className="h-4 w-4" /> Pagar
            </Button>
          )}
          {canManagePayments && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => removePayment(p)}><Trash2 className="h-4 w-4" /></Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageShell title={contract.title} description={`${DIRECTION_LABEL[contract.direction]} · ${party?.name ?? '—'}`}>
      <div className="flex items-center justify-between gap-3 -mt-2">
        <Button variant="ghost" size="sm" className="gap-2 w-fit" onClick={() => router.push('/dashboard/rentals/contracts')}>
          <ArrowLeft className="h-4 w-4" /> Volver a contratos
        </Button>
        {canManageContracts && (contract.status === 'active' || contract.status === 'pending') && (
          <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => { setReturnDate(new Date().toISOString().slice(0, 10)); setCancelFuture(true); setCloseNotes(''); setCloseOpen(true); }}>
            <PackageCheck className="h-4 w-4" /> Cerrar arriendo
          </Button>
        )}
      </div>

      {contract.status === 'finished' && (
        <div className="flex items-center gap-3 rounded-[1.5rem] border bg-muted/50 px-5 py-4">
          <PackageCheck className="h-5 w-5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Arriendo <span className="font-semibold text-foreground">finalizado</span>
            {contract.endDate ? <> el <span className="font-semibold text-foreground">{fmtDate(contract.endDate)}</span></> : ''}. Los equipos fueron devueltos y el calendario de pagos se cerró.
          </p>
        </div>
      )}

      {/* Orden de Compra (OC) */}
      {!ocConfirmed ? (
        <Card className="rounded-[1.5rem] border-warning/40 bg-warning-subtle/40">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-bold">Orden de Compra</h2>
                  <Badge variant="outline" className={ocStatus === 'sent' ? 'badge-info' : 'badge-warning'}>
                    {ocStatus === 'sent' ? 'Enviada' : 'Por emitir'}
                  </Badge>
                  {contract.ocNumber && <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{contract.ocNumber}</span>}
                </div>
                <p className="text-sm text-muted-foreground">
                  El calendario de pagos se generará al <span className="font-semibold text-foreground">confirmar la OC</span>. El 1er vencimiento corre desde la confirmación + el plazo de pago.
                </p>
              </div>
            </div>
            {canManageContracts && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={handleDownloadOc}>
                  <Download className="h-4 w-4" /> Generar OC (PDF)
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={openOcEmail}>
                  <Mail className="h-4 w-4" /> Enviar OC
                </Button>
                <Button size="sm" className="rounded-xl gap-2" onClick={() => {
                  setOcInstallments(contract.billingCycle === 'one_time' ? '1' : '12');
                  setOcTermsDays(String(contract.paymentTermsDays ?? 30));
                  setConfirmOcOpen(true);
                }}>
                  <CheckCircle2 className="h-4 w-4" /> Confirmar OC
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-[1.5rem] border bg-card px-5 py-4 flex-wrap">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-success-subtle-foreground shrink-0" />
            <div className="flex items-center flex-wrap gap-x-1 text-sm text-muted-foreground">
              <span>OC {contract.ocNumber ? <span className="font-semibold text-foreground">{contract.ocNumber}</span> : ''}</span>
              <Badge variant="outline" className="badge-success ml-1">Confirmada</Badge>
              {contract.ocConfirmedAt ? <span className="ml-2">el {fmtDate(contract.ocConfirmedAt)}</span> : ''}
            </div>
          </div>
          {canManageContracts && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={handleDownloadOc}>
                <Download className="h-4 w-4" /> Descargar OC (PDF)
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={openOcEmail}>
                <Mail className="h-4 w-4" /> Enviar OC
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Resumen del contrato */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Dirección" value={<Badge variant="outline" className={DIRECTION_BADGE[contract.direction]}>{DIRECTION_SHORT[contract.direction]}</Badge>} />
        <SummaryCard label="Estado" value={<Badge variant="outline" className={CONTRACT_STATUS_BADGE[contract.status]}>{CONTRACT_STATUS_LABEL[contract.status]}</Badge>} />
        <SummaryCard label="Ciclo" value={<span className="font-bold">{BILLING_CYCLE_LABEL[contract.billingCycle]}</span>} />
        <SummaryCard label="Neto / ciclo" value={<span className="font-bold">{formatMoney(netPerCycle, contract.currency)}</span>} />
        <SummaryCard label={taxRate > 0 ? `IVA (${taxRate}%)` : 'IVA'} value={<span className="font-bold">{taxRate > 0 ? formatMoney(ivaPerCycle, contract.currency) : 'Exento'}</span>} />
        <SummaryCard label="Total / ciclo" value={<span className="font-bold text-primary">{formatMoney(totalPerCycle, contract.currency)}</span>} />
        <SummaryCard label="Inicio" value={<span className="font-bold">{fmtDate(contract.startDate)}</span>} />
        <SummaryCard label="Término" value={<span className="font-bold">{contract.endDate ? fmtDate(contract.endDate) : '—'}</span>} />
        <SummaryCard label="Total pagado" value={<span className="font-bold text-success-subtle-foreground">{formatMoney(totalPaid, contract.currency)}</span>} />
        <SummaryCard label="Pendiente" value={<span className="font-bold text-warning-subtle-foreground">{formatMoney(totalPending, contract.currency)}</span>} />
      </div>

      {/* Activos arrendados */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2"><Package className="h-5 w-5 text-primary" /> Activos arrendados</h2>
          {canManageContracts && <Button onClick={openNewAsset} size="sm" className="rounded-xl gap-2"><Plus className="h-4 w-4" /> Agregar activo</Button>}
        </div>
        <DataTable
          columns={assetColumns}
          data={assets}
          rowKey={(a) => a.id}
          empty={{ icon: <Package size={22} />, title: 'Sin activos', description: 'Agrega la maquinaria, vehículos o equipos de este contrato.' }}
          minWidth="820px"
        />
        {assetsPriced && (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Suma de activos / ciclo:</span>
              <span className="font-bold tabular-nums text-foreground">{formatMoney(assetsNetSum, contract.currency)}</span>
            </div>
            {!assetsMatchNet && (
              <p className="text-[11px] text-warning-subtle-foreground max-w-md text-right">
                La suma de los activos ({formatMoney(assetsNetSum, contract.currency)}) no coincide con el
                neto del contrato ({formatMoney(netPerCycle, contract.currency)}). Revisa los precios
                unitarios de cada activo.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Calendario de pagos */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /> Calendario de pagos</h2>
          {canManagePayments && ocConfirmed && (
            <Button onClick={() => setSchedOpen(true)} size="sm" variant="outline" className="rounded-xl gap-2"><ListPlus className="h-4 w-4" /> Generar cuotas</Button>
          )}
        </div>
        <DataTable
          columns={paymentColumns}
          data={payments}
          rowKey={(p) => p.id}
          empty={{ icon: <CalendarClock size={22} />, title: 'Sin cuotas', description: ocConfirmed ? 'Genera el calendario de pagos según el ciclo del contrato.' : 'El calendario se generará automáticamente al confirmar la OC.' }}
          minWidth="700px"
        />
      </section>

      {/* Dialog activo */}
      <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editingAsset ? 'Editar activo' : 'Agregar activo'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <Field label="Nombre *" full><Input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="Ej: Retroexcavadora CAT 320" className="rounded-xl" /></Field>
            <Field label="Categoría">
              <Select value={assetForm.category} onValueChange={(v) => setAssetForm({ ...assetForm, category: v as RentalAssetCategory })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="machinery">Maquinaria</SelectItem>
                  <SelectItem value="measurement">Equipo de medición</SelectItem>
                  <SelectItem value="vehicle">Vehículo</SelectItem>
                  <SelectItem value="truck">Camión</SelectItem>
                  <SelectItem value="other">Otro</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Patente / N° serie"><Input value={assetForm.identifier} onChange={(e) => setAssetForm({ ...assetForm, identifier: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Cantidad"><Input type="number" min={1} value={assetForm.quantity} onChange={(e) => setAssetForm({ ...assetForm, quantity: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Precio unitario"><Input type="number" min={0} value={assetForm.unitPrice} onChange={(e) => setAssetForm({ ...assetForm, unitPrice: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Notas" full><Textarea value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })} className="rounded-xl" /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={saveAsset} disabled={savingAsset} className="rounded-xl">{savingAsset ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog generar calendario */}
      <Dialog open={schedOpen} onOpenChange={setSchedOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Generar calendario de pagos</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Se crearán cuotas de <span className="font-semibold text-foreground">{formatMoney(contract.amount, contract.currency)}</span> con
              ciclo <span className="font-semibold text-foreground">{BILLING_CYCLE_LABEL[contract.billingCycle].toLowerCase()}</span> desde
              el <span className="font-semibold text-foreground">{fmtDate(contract.startDate)}</span>.
            </p>
            {contract.billingCycle !== 'one_time' && (
              <Field label="N° de cuotas a generar">
                <Input type="number" min={1} max={60} value={installments} onChange={(e) => setInstallments(e.target.value)} className="rounded-xl" />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchedOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={generate} disabled={generating} className="rounded-xl">{generating ? 'Generando…' : 'Generar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog marcar pagado */}
      <Dialog open={!!payingId} onOpenChange={(o) => !o && setPayingId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-2">
            <Field label="Fecha de pago"><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="rounded-xl" /></Field>
            <Field label="Medio de pago"><Input value={paidMethod} onChange={(e) => setPaidMethod(e.target.value)} placeholder="Transferencia, cheque…" className="rounded-xl" /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayingId(null)} className="rounded-xl">Cancelar</Button>
            <Button onClick={confirmPaid} className="rounded-xl">Confirmar pago</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cerrar arriendo (devolución) */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Cerrar arriendo</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Registra la devolución del/los equipo/s. El contrato pasará a <span className="font-semibold text-foreground">Finalizado</span>.
            </p>
            <Field label="Fecha de devolución">
              <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="rounded-xl" />
            </Field>
            <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium text-foreground">Eliminar cuotas futuras</div>
                <div className="text-xs text-muted-foreground">Borra las cuotas pendientes con vencimiento posterior a la devolución.</div>
              </div>
              <Switch checked={cancelFuture} onCheckedChange={setCancelFuture} />
            </div>
            {(() => {
              const activeAssets = assets.filter((a) => a.status !== 'returned').length;
              const ref = new Date(returnDate); ref.setHours(0, 0, 0, 0);
              const futurePending = payments.filter((p) => p.status === 'pending' && new Date(p.dueDate as any) > ref).length;
              return (
                <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                  <div>• <span className="font-semibold text-foreground">{activeAssets}</span> equipo{activeAssets === 1 ? '' : 's'} se marcará{activeAssets === 1 ? '' : 'n'} como devuelto{activeAssets === 1 ? '' : 's'}.</div>
                  {cancelFuture && <div>• <span className="font-semibold text-foreground">{futurePending}</span> cuota{futurePending === 1 ? '' : 's'} pendiente{futurePending === 1 ? '' : 's'} futura{futurePending === 1 ? '' : 's'} se eliminará{futurePending === 1 ? '' : 'n'}.</div>}
                </div>
              );
            })()}
            <Field label="Notas de cierre (opcional)">
              <Textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Estado del equipo, observaciones de la devolución…" className="rounded-xl" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={confirmClose} disabled={closing} className="rounded-xl gap-2"><PackageCheck className="h-4 w-4" /> {closing ? 'Cerrando…' : 'Cerrar arriendo'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog devolver activo individual */}
      <Dialog open={!!returningAsset} onOpenChange={(o) => !o && setReturningAsset(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar devolución</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Marcar <span className="font-semibold text-foreground">{returningAsset?.name}</span> como devuelto.
            </p>
            <Field label="Fecha de devolución">
              <Input type="date" value={assetReturnDate} onChange={(e) => setAssetReturnDate(e.target.value)} className="rounded-xl" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturningAsset(null)} className="rounded-xl">Cancelar</Button>
            <Button onClick={confirmReturnAsset} className="rounded-xl gap-2"><Undo2 className="h-4 w-4" /> Confirmar devolución</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog confirmar OC */}
      <Dialog open={confirmOcOpen} onOpenChange={setConfirmOcOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Confirmar Orden de Compra</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Al confirmar, el contrato pasa a <span className="font-semibold text-foreground">Activo</span> y se genera el calendario de pagos.
              El 1er vencimiento será <span className="font-semibold text-foreground">hoy + el plazo de pago</span> y luego según el ciclo <span className="font-semibold text-foreground">{BILLING_CYCLE_LABEL[contract.billingCycle].toLowerCase()}</span>.
            </p>
            <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground space-y-0.5">
              <div>Neto / ciclo: <span className="font-semibold text-foreground">{formatMoney(netPerCycle, contract.currency)}</span></div>
              {taxRate > 0 && <div>IVA ({taxRate}%): <span className="font-semibold text-foreground">{formatMoney(ivaPerCycle, contract.currency)}</span></div>}
              <div>Total / ciclo: <span className="font-semibold text-foreground">{formatMoney(totalPerCycle, contract.currency)}</span></div>
            </div>
            <Field label="Plazo de pago (días)">
              <Input type="number" min={0} max={180} value={ocTermsDays} onChange={(e) => setOcTermsDays(e.target.value)} className="rounded-xl" />
            </Field>
            {contract.billingCycle !== 'one_time' && (
              <Field label="N° de cuotas a generar">
                <Input type="number" min={1} max={60} value={ocInstallments} onChange={(e) => setOcInstallments(e.target.value)} className="rounded-xl" />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOcOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={handleConfirmOc} disabled={confirmingOc} className="rounded-xl gap-2">
              {confirmingOc ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar OC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog enviar OC por correo */}
      <Dialog open={ocEmailOpen} onOpenChange={setOcEmailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Enviar OC al arrendador</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <Field label="Destinatarios (separados por coma)">
              <Input value={ocEmailTo} onChange={(e) => setOcEmailTo(e.target.value)} placeholder="arrendador@correo.cl" className="rounded-xl" />
            </Field>
            <Field label="Mensaje (opcional)">
              <Textarea value={ocEmailMsg} onChange={(e) => setOcEmailMsg(e.target.value)} className="rounded-xl" placeholder="Adjuntamos la orden de compra del arriendo…" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOcEmailOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={handleSendOc} disabled={sendingOc} className="rounded-xl gap-2">
              {sendingOc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar OC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="rounded-[1.5rem]">
      <CardContent className="p-4 space-y-1.5">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
        <div>{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function fmtDate(d: Date | string): string {
  const date = new Date(d as any);
  if (isNaN(date.getTime())) return '—';
  return format(date, "d 'de' MMM yyyy", { locale: es });
}
