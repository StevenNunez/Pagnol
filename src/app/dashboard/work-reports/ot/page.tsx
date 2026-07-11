'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ClipboardList, Hash, Pencil } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/empty-state';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useOfflineCollection } from '@/modules/offline/use-offline-collection';
import { useOnlineStatus } from '@/hooks/use-online-status';

const STATUS_LABEL: Record<string, string> = { draft: 'Borrador', ready: 'Lista' };

// Evita el corrimiento de un día por zona horaria que produce
// `new Date('YYYY-MM-DD').toLocaleDateString()` (se parsea como UTC).
function fmtDate(value: any) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-CL');
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL');
}

export default function WorkOrdersListPage() {
  const { workOrders, createWorkOrder, deleteWorkOrder, can, notify } = useAppState();
  const allWorkOrders = useOfflineCollection('work_orders', workOrders || []);
  const router = useRouter();
  const online = useOnlineStatus();
  const canCreate = can('work_reports:create');
  const canDelete = can('work_reports:delete');
  const [creating, setCreating] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [newOpen, setNewOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);

  const handleNew = async (source: 'auto' | 'manual') => {
    if (creating) return;
    setCreating(true);
    try {
      const wo = await createWorkOrder({ otNumberSource: source });
      setNewOpen(false);
      router.push(`/dashboard/work-reports/ot/${wo.id}`);
    } catch (e: any) {
      notify(e?.message || 'No se pudo crear la OT.', 'destructive');
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteWorkOrder(pendingDelete);
    } catch (err: any) {
      notify(err?.message || 'No se pudo eliminar.', 'destructive');
    } finally {
      setPendingDelete(null);
    }
  };

  const filtered = allWorkOrders
    .filter((wo) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [wo.otNumber, wo.area, wo.specialty, wo.client, wo.description]
        .some((v) => (v || '').toLowerCase().includes(q));
    })
    .sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)));

  return (
    <PageShell
      title="OT / Reportes de Trabajo"
      description="Captura rápida por orden de trabajo. Cada OT alimenta el Reporte Diario."
      toolbar={
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Input className="rounded-xl sm:w-64" placeholder="Buscar OT, área, especialidad…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {canCreate && (
            <Button className="rounded-[1.5rem] shadow-lg shadow-primary/10" onClick={() => setNewOpen(true)} disabled={creating}>
              <Plus className="h-4 w-4 mr-2" /> Nueva OT
            </Button>
          )}
        </div>
      }
    >
      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No hay OT registradas"
          description="Crea la primera orden de trabajo del día."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((wo) => (
            <Card
              key={wo.id}
              className="rounded-[1.5rem] cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => router.push(`/dashboard/work-reports/ot/${wo.id}`)}
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">OT</p>
                    <p className="text-lg font-bold">{wo.otNumber || 'Sin número'}</p>
                  </div>
                  <Badge className="rounded-xl" variant={wo.status === 'ready' ? 'default' : 'secondary'}>
                    {STATUS_LABEL[wo.status] || wo.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">{wo.description || 'Sin descripción.'}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {wo.area && <span>📍 {wo.area}</span>}
                  {wo.specialty && <span>🔧 {wo.specialty}</span>}
                  <span>📅 {fmtDate(wo.workDate)}</span>
                </div>
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-xs text-muted-foreground">Avance: <b className="text-foreground tabular-nums">{wo.executedPercent || 0}%</b></span>
                  {canDelete && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-xl h-8 w-8 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(wo.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={(o) => !creating && setNewOpen(o)}>
        <DialogContent className="rounded-[1.5rem] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva OT — número</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <button
              type="button"
              disabled={creating || !online}
              onClick={() => handleNew('auto')}
              className="w-full text-left rounded-xl border p-4 flex items-start gap-3 hover:border-primary/40 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Hash className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">Correlativo automático</p>
                <p className="text-xs text-muted-foreground">Genera el siguiente número interno del tenant. Queda bloqueado, no se puede editar después.</p>
                {!online && <p className="text-xs text-warning-subtle-foreground mt-1">Requiere conexión.</p>}
              </div>
            </button>
            <button
              type="button"
              disabled={creating}
              onClick={() => handleNew('manual')}
              className="w-full text-left rounded-xl border p-4 flex items-start gap-3 hover:border-primary/40 transition disabled:opacity-50"
            >
              <Pencil className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">Número manual</p>
                <p className="text-xs text-muted-foreground">Lo asigna el cliente. Lo escribes tú en la OT.</p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-[1.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta OT?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer. Si la OT está consolidada en un Diario, primero deberás quitarla de ahí.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
