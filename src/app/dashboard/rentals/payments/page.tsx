'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { CalendarClock, CheckCircle2, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { RentalPayment, RentalPaymentStatus } from '@/modules/core/lib/data';
import {
  PAYMENT_STATUS_LABEL, PAYMENT_STATUS_BADGE, DIRECTION_BADGE, DIRECTION_SHORT,
  formatMoney, derivePaymentStatus,
} from '../_lib/helpers';

type StatusFilter = 'all' | RentalPaymentStatus;

export default function RentalPaymentsPage() {
  const router = useRouter();
  const { rentalPayments, rentalContracts, rentalParties, markRentalPaymentPaid, can, notify } = useAppState();
  const canManagePayments = can('rentals:manage_payments');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidMethod, setPaidMethod] = useState('');

  const contractOf = (id: string) => rentalContracts?.find((c) => c.id === id);
  const partyName = (partyId?: string) => rentalParties?.find((p) => p.id === partyId)?.name ?? '—';

  const rows = useMemo(() => {
    return (rentalPayments || [])
      .map((p) => ({ ...p, derived: derivePaymentStatus(p) }))
      .filter((p) => (status === 'all' ? true : p.derived === status))
      .sort((a, b) => new Date(a.dueDate as any).getTime() - new Date(b.dueDate as any).getTime());
  }, [rentalPayments, status]);

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

  const columns: DataTableColumn<RentalPayment & { derived: RentalPaymentStatus }>[] = [
    { key: 'due', header: 'Vencimiento', cell: (p) => <span className="font-semibold text-foreground">{fmtDate(p.dueDate)}</span> },
    {
      key: 'contract', header: 'Contrato',
      cell: (p) => {
        const c = contractOf(p.contractId);
        return (
          <div>
            <div className="font-medium text-foreground">{c?.title ?? 'Contrato'}</div>
            <div className="text-xs text-muted-foreground">{partyName(c?.partyId)}</div>
          </div>
        );
      },
    },
    {
      key: 'dir', header: 'Dirección',
      cell: (p) => { const c = contractOf(p.contractId); return c ? <Badge variant="outline" className={DIRECTION_BADGE[c.direction]}>{DIRECTION_SHORT[c.direction]}</Badge> : '—'; },
    },
    { key: 'amount', header: 'Monto', cell: (p) => <span className="tabular-nums font-medium">{formatMoney(p.amount, contractOf(p.contractId)?.currency)}</span> },
    { key: 'status', header: 'Estado', cell: (p) => <Badge variant="outline" className={PAYMENT_STATUS_BADGE[p.derived]}>{PAYMENT_STATUS_LABEL[p.derived]}</Badge> },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (p) => (
        <div className="flex justify-end items-center gap-1">
          {canManagePayments && p.status !== 'paid' && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-success-subtle-foreground" onClick={(e) => { e.stopPropagation(); setPayingId(p.id); setPaidDate(new Date().toISOString().slice(0, 10)); }}>
              <CheckCircle2 className="h-4 w-4" /> Pagar
            </Button>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title="Calendario de Pagos"
      description="Todas las cuotas de arriendo, entrantes y salientes."
      toolbar={
        <>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="rounded-xl sm:w-52"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="overdue">Vencidos</SelectItem>
              <SelectItem value="pending">Pendientes</SelectItem>
              <SelectItem value="paid">Pagados</SelectItem>
            </SelectContent>
          </Select>
          <span />
        </>
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(p) => p.id}
        onRowClick={(p) => router.push(`/dashboard/rentals/contracts/${p.contractId}`)}
        empty={{ icon: <CalendarClock size={22} />, title: 'Sin cuotas', description: 'Genera el calendario de pagos desde el detalle de cada contrato.' }}
        minWidth="820px"
      />

      <Dialog open={!!payingId} onOpenChange={(o) => !o && setPayingId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Fecha de pago</label>
              <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Medio de pago</label>
              <Input value={paidMethod} onChange={(e) => setPaidMethod(e.target.value)} placeholder="Transferencia, cheque…" className="rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayingId(null)} className="rounded-xl">Cancelar</Button>
            <Button onClick={confirmPaid} className="rounded-xl">Confirmar pago</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function fmtDate(d: Date | string): string {
  const date = new Date(d as any);
  if (isNaN(date.getTime())) return '—';
  return format(date, "d 'de' MMM yyyy", { locale: es });
}
