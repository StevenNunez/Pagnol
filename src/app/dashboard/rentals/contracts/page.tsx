'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, FileText, ChevronRight } from 'lucide-react';
import type { RentalContract, RentalDirection, RentalBillingCycle, RentalContractStatus } from '@/modules/core/lib/data';
import {
  DIRECTION_SHORT, DIRECTION_BADGE, BILLING_CYCLE_LABEL, CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_BADGE, formatMoney,
} from '../_lib/helpers';

type FormState = {
  code: string; direction: RentalDirection; partyId: string; title: string;
  status: RentalContractStatus; startDate: string; endDate: string;
  billingCycle: RentalBillingCycle; amount: string; currency: string; paymentDay: string; notes: string;
  clientContractId: string;
};

const EMPTY: FormState = {
  code: '', direction: 'incoming', partyId: '', title: '', status: 'active',
  startDate: new Date().toISOString().slice(0, 10), endDate: '',
  billingCycle: 'monthly', amount: '', currency: 'CLP', paymentDay: '', notes: '',
  clientContractId: '',
};

export default function RentalContractsPage() {
  const router = useRouter();
  const { rentalContracts, rentalParties, suppliers, contracts, addRentalContract, updateRentalContract, can, notify } = useAppState();
  const canManage = can('rentals:manage_contracts');

  const [dirFilter, setDirFilter] = useState<'all' | RentalDirection>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RentalContractStatus>('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RentalContract | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  // El arrendador (incoming) vive en `suppliers`; el cliente (outgoing) en `rentalParties`.
  const partyName = (id: string) =>
    suppliers?.find((s) => s.id === id)?.name ?? rentalParties?.find((p) => p.id === id)?.name ?? '—';

  const filtered = useMemo(() => {
    return (rentalContracts || []).filter((c) => {
      if (dirFilter !== 'all' && c.direction !== dirFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      return true;
    });
  }, [rentalContracts, dirFilter, statusFilter]);

  // Las contrapartes válidas según la dirección: incoming → arrendadores (suppliers),
  // outgoing → clientes (rentalParties).
  const partyOptions = useMemo(
    () => (form.direction === 'incoming'
      ? (suppliers || []).map((s) => ({ id: s.id, name: s.name }))
      : (rentalParties || []).filter((p) => p.partyType === 'client').map((p) => ({ id: p.id, name: p.name }))),
    [suppliers, rentalParties, form.direction],
  );

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c: RentalContract) => {
    setEditing(c);
    setForm({
      code: c.code ?? '', direction: c.direction, partyId: c.partyId, title: c.title,
      status: c.status, startDate: toInputDate(c.startDate), endDate: c.endDate ? toInputDate(c.endDate) : '',
      billingCycle: c.billingCycle, amount: String(c.amount ?? ''), currency: c.currency || 'CLP',
      paymentDay: c.paymentDay != null ? String(c.paymentDay) : '', notes: c.notes ?? '',
      clientContractId: c.clientContractId ?? '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) { notify('El título es obligatorio.', 'destructive'); return; }
    if (!form.partyId) { notify('Selecciona una contraparte.', 'destructive'); return; }
    setSaving(true);
    const payload = {
      code: form.code || undefined,
      direction: form.direction,
      partyId: form.partyId,
      title: form.title,
      status: form.status,
      startDate: form.startDate,
      endDate: form.endDate || null,
      billingCycle: form.billingCycle,
      amount: Number(form.amount) || 0,
      currency: form.currency,
      paymentDay: form.paymentDay ? Number(form.paymentDay) : null,
      notes: form.notes || undefined,
      // Imputación del costo a la faena (ADR-004): a qué contrato cliente se carga.
      clientContractId: form.clientContractId || null,
    };
    try {
      if (editing) {
        await updateRentalContract(editing.id, payload);
        notify('Contrato actualizado.', 'success');
      } else {
        const created = await addRentalContract(payload);
        notify('Contrato creado. Agrega activos y genera el calendario de pagos.', 'success');
        setOpen(false);
        router.push(`/dashboard/rentals/contracts/${created.id}`);
        return;
      }
      setOpen(false);
    } catch (e: any) {
      notify(e?.message || 'No se pudo guardar.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const columns: DataTableColumn<RentalContract>[] = [
    {
      key: 'title', header: 'Contrato',
      cell: (c) => (
        <div>
          <div className="font-semibold text-foreground">{c.title}</div>
          <div className="text-xs text-muted-foreground">{c.code || 'Sin código'} · {partyName(c.partyId)}</div>
        </div>
      ),
    },
    { key: 'dir', header: 'Dirección', cell: (c) => <Badge variant="outline" className={DIRECTION_BADGE[c.direction]}>{DIRECTION_SHORT[c.direction]}</Badge> },
    { key: 'cycle', header: 'Ciclo', cell: (c) => <span className="text-muted-foreground">{BILLING_CYCLE_LABEL[c.billingCycle]}</span> },
    { key: 'amount', header: 'Monto', cell: (c) => <span className="font-medium tabular-nums">{formatMoney(c.amount, c.currency)}</span> },
    {
      key: 'status', header: 'Estado',
      cell: (c) => (
        <div className="flex flex-col items-start gap-1">
          <Badge variant="outline" className={CONTRACT_STATUS_BADGE[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Badge>
          {(c.ocStatus ?? 'confirmed') !== 'confirmed' && (
            <Badge variant="outline" className="badge-warning text-[9px]">{c.ocStatus === 'sent' ? 'OC enviada' : 'OC por emitir'}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (c) => (
        <div className="flex justify-end items-center gap-1">
          {canManage && <Button variant="ghost" size="sm" className="h-8" onClick={(e) => { e.stopPropagation(); openEdit(c); }}>Editar</Button>}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title="Contratos de Arriendo"
      description="Arriendos entrantes (de proveedores) y salientes (a clientes)."
      toolbar={
        <>
          <div className="flex flex-col sm:flex-row gap-3 w-full xl:w-auto">
            <Select value={dirFilter} onValueChange={(v) => setDirFilter(v as any)}>
              <SelectTrigger className="rounded-xl sm:w-48"><SelectValue placeholder="Dirección" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las direcciones</SelectItem>
                <SelectItem value="incoming">Entrantes (de proveedor)</SelectItem>
                <SelectItem value="outgoing">Salientes (a cliente)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="rounded-xl sm:w-44"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="pending">Pendiente</SelectItem>
                <SelectItem value="finished">Finalizado</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {canManage && <Button onClick={openNew} className="rounded-xl gap-2"><Plus className="h-4 w-4" /> Nuevo Contrato</Button>}
        </>
      }
    >
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(c) => c.id}
        onRowClick={(c) => router.push(`/dashboard/rentals/contracts/${c.id}`)}
        empty={{ icon: <FileText size={22} />, title: 'Sin contratos', description: 'Crea tu primer contrato de arriendo.' }}
        minWidth="820px"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar contrato' : 'Nuevo contrato'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <Field label="Dirección *">
              <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as RentalDirection, partyId: '' })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="incoming">Entrante — arrendamos de un proveedor</SelectItem>
                  <SelectItem value="outgoing">Saliente — arrendamos a un cliente</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={form.direction === 'incoming' ? 'Arrendador *' : 'Cliente *'}>
              <Select value={form.partyId} onValueChange={(v) => setForm({ ...form, partyId: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder={partyOptions.length ? 'Selecciona…' : 'Crea una contraparte primero'} /></SelectTrigger>
                <SelectContent>
                  {partyOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Título *" full><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej: Arriendo retroexcavadora CAT 320" className="rounded-xl" /></Field>
            <Field label="Código / N° contrato"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Estado">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as RentalContractStatus })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="finished">Finalizado</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha inicio *"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Fecha término"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Ciclo de facturación">
              <Select value={form.billingCycle} onValueChange={(v) => setForm({ ...form, billingCycle: v as RentalBillingCycle })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Mensual</SelectItem>
                  <SelectItem value="biweekly">Quincenal</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="daily">Diario</SelectItem>
                  <SelectItem value="one_time">Pago único</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Día de pago (mensual)"><Input type="number" min={1} max={31} value={form.paymentDay} onChange={(e) => setForm({ ...form, paymentDay: e.target.value })} placeholder="Ej: 5" className="rounded-xl" /></Field>
            <Field label="Monto por ciclo *"><Input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Moneda">
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CLP">CLP (peso)</SelectItem>
                  <SelectItem value="UF">UF</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.direction === 'incoming' && (
              <Field label="Imputar a contrato (Finanzas)" full>
                <Select
                  value={form.clientContractId || '__none__'}
                  onValueChange={(v) => setForm({ ...form, clientContractId: v === '__none__' ? '' : v })}
                >
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sin imputar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin imputar (alerta en Finanzas)</SelectItem>
                    {(contracts || []).filter((c) => c.status === 'active').map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}{c.clientName ? ` — ${c.clientName}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Notas" full><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-xl" /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={save} disabled={saving} className="rounded-xl">{saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear y configurar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function toInputDate(d: Date | string): string {
  const date = new Date(d as any);
  if (isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
