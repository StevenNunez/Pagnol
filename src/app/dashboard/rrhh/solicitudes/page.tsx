'use client';

import React, { useState, useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Check, X, ClipboardList, ShieldOff } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { LeaveRequest, LeaveStatus } from '@/modules/core/lib/data';
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

export default function SolicitudesPage() {
  const { leaveRequests, updateLeaveRequestStatus, can, notify } = useAppState();
  const canApprove = can('hr_leave:approve');

  const [tab, setTab] = useState<'all' | LeaveStatus>('pending');
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return (leaveRequests || [])
      .filter((r) => tab === 'all' || r.status === tab)
      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());
  }, [leaveRequests, tab]);

  const approve = async (r: LeaveRequest) => {
    setBusyId(r.id);
    try {
      await updateLeaveRequestStatus(r.id, 'approved');
      notify('Solicitud aprobada.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo aprobar.', 'destructive');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    try {
      await updateLeaveRequestStatus(rejecting.id, 'rejected', { rejectionReason });
      notify('Solicitud rechazada.', 'success');
      setRejecting(null);
      setRejectionReason('');
    } catch (e: any) {
      notify(e?.message || 'No se pudo rechazar.', 'destructive');
    } finally {
      setBusyId(null);
    }
  };

  if (!can('hr_leave:view_all')) {
    return (
      <EmptyState
        icon={<ShieldOff size={22} />}
        title="Sin acceso"
        description="No tienes permisos para ver las solicitudes de vacaciones/licencias."
      />
    );
  }

  const columns: DataTableColumn<LeaveRequest>[] = [
    { key: 'user', header: 'Trabajador', cell: (r) => <span className="font-semibold text-foreground">{r.userName}</span> },
    { key: 'type', header: 'Tipo', cell: (r) => <span className="text-muted-foreground">{LEAVE_TYPE_LABEL[r.type]}</span> },
    { key: 'dates', header: 'Periodo', cell: (r) => <span className="text-muted-foreground">{fmt(r.startDate)} → {fmt(r.endDate)}</span> },
    { key: 'days', header: 'Días', cell: (r) => <span className="tabular-nums">{r.daysCount}</span> },
    { key: 'reason', header: 'Motivo', cell: (r) => <span className="text-muted-foreground truncate max-w-[200px] block">{r.reason || '—'}</span> },
    {
      key: 'status', header: 'Estado',
      cell: (r) => <Badge variant="outline" className={STATUS_BADGE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (r) => canApprove && r.status === 'pending' ? (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-success-subtle-foreground hover:bg-success-subtle" disabled={busyId === r.id} onClick={() => approve(r)}><Check className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" disabled={busyId === r.id} onClick={() => setRejecting(r)}><X className="h-4 w-4" /></Button>
        </div>
      ) : null,
    },
  ];

  return (
    <PageShell
      title="Vacaciones y Licencias"
      description="Revisa y aprueba las solicitudes del personal."
      toolbar={
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="pending">Pendientes</TabsTrigger>
            <TabsTrigger value="approved">Aprobadas</TabsTrigger>
            <TabsTrigger value="rejected">Rechazadas</TabsTrigger>
            <TabsTrigger value="all">Todas</TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(r) => r.id}
        empty={{ icon: <ClipboardList size={22} />, title: 'Sin solicitudes', description: 'No hay solicitudes en esta categoría.' }}
        minWidth="800px"
      />

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar solicitud de {rejecting?.userName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Motivo del rechazo</label>
            <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="rounded-xl" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} className="rounded-xl">Cancelar</Button>
            <Button variant="destructive" onClick={reject} disabled={busyId === rejecting?.id} className="rounded-xl">Rechazar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
