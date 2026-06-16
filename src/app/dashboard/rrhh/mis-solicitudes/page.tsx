'use client';

import React, { useState, useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, CalendarClock } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { LeaveRequest, LeaveStatus, LeaveType } from '@/modules/core/lib/data';
import { LEAVE_TYPE_LABEL, LEAVE_STATUS_LABEL } from '@/modules/core/lib/hr-labels';

const STATUS_BADGE: Record<LeaveStatus, string> = {
  pending: 'badge-warning',
  approved: 'badge-success',
  rejected: 'bg-destructive/10 text-destructive',
};

const fmt = (d: Date | string) => {
  const date = new Date(d as any);
  return isNaN(date.getTime()) ? '—' : format(date, "d 'de' MMM yyyy", { locale: es });
};

type Form = { type: LeaveType; startDate: string; endDate: string; reason: string };
const EMPTY: Form = { type: 'vacation', startDate: '', endDate: '', reason: '' };

export default function MisSolicitudesPage() {
  const { user } = useAuth();
  const { leaveRequests, addLeaveRequest, deleteLeaveRequest, notify } = useAppState();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [toCancel, setToCancel] = useState<LeaveRequest | null>(null);

  const myRequests = useMemo(
    () => (leaveRequests || []).filter((r) => r.userId === user?.id)
      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()),
    [leaveRequests, user],
  );

  const daysCount = useMemo(() => {
    if (!form.startDate || !form.endDate) return 0;
    const d = differenceInCalendarDays(new Date(form.endDate), new Date(form.startDate)) + 1;
    return d > 0 ? d : 0;
  }, [form.startDate, form.endDate]);

  const openNew = () => { setForm(EMPTY); setOpen(true); };

  const save = async () => {
    if (!form.startDate || !form.endDate) { notify('Selecciona fecha de inicio y término.', 'destructive'); return; }
    if (daysCount <= 0) { notify('El rango de fechas no es válido.', 'destructive'); return; }
    setSaving(true);
    try {
      await addLeaveRequest({
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        daysCount,
        reason: form.reason || null,
        supportingDocumentUrl: null,
      });
      notify('Solicitud enviada.', 'success');
      setOpen(false);
    } catch (e: any) {
      notify(e?.message || 'No se pudo enviar la solicitud.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = async () => {
    if (!toCancel) return;
    try {
      await deleteLeaveRequest(toCancel.id);
      notify('Solicitud cancelada.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo cancelar.', 'destructive');
    } finally {
      setToCancel(null);
    }
  };

  const columns: DataTableColumn<LeaveRequest>[] = [
    { key: 'type', header: 'Tipo', cell: (r) => <span className="font-semibold text-foreground">{LEAVE_TYPE_LABEL[r.type]}</span> },
    { key: 'dates', header: 'Periodo', cell: (r) => <span className="text-muted-foreground">{fmt(r.startDate)} → {fmt(r.endDate)}</span> },
    { key: 'days', header: 'Días', cell: (r) => <span className="tabular-nums">{r.daysCount}</span> },
    { key: 'status', header: 'Estado', cell: (r) => <Badge variant="outline" className={STATUS_BADGE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge> },
    { key: 'rejection', header: 'Motivo rechazo', cell: (r) => <span className="text-muted-foreground">{r.rejectionReason || '—'}</span> },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (r) => r.status === 'pending' ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setToCancel(r)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : null,
    },
  ];

  return (
    <PageShell
      title="Mis Solicitudes"
      description="Solicita vacaciones o licencias y revisa su estado."
      toolbar={<Button onClick={openNew} className="rounded-xl gap-2 ml-auto"><Plus className="h-4 w-4" /> Nueva Solicitud</Button>}
    >
      <DataTable
        columns={columns}
        data={myRequests}
        rowKey={(r) => r.id}
        empty={{ icon: <CalendarClock size={22} />, title: 'Sin solicitudes', description: 'Aún no has solicitado vacaciones ni licencias.' }}
        minWidth="700px"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva solicitud</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <Field label="Tipo" full>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as LeaveType })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAVE_TYPE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha inicio *"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Fecha término *"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Días solicitados" full>
              <p className="text-sm font-bold tabular-nums">{daysCount > 0 ? `${daysCount} día${daysCount !== 1 ? 's' : ''}` : '—'}</p>
            </Field>
            <Field label="Motivo" full><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="rounded-xl" /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={save} disabled={saving} className="rounded-xl">{saving ? 'Enviando…' : 'Enviar Solicitud'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toCancel} onOpenChange={(o) => !o && setToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta solicitud?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={confirmCancel}>Sí, cancelar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
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
