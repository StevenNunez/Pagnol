'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, CalendarRange } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { LoadingState } from '@/components/loading-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useAuth } from '@/modules/auth/useAuth';

const STATUS_LABEL: Record<string, string> = { draft: 'Borrador', ready: 'Listo' };

// Evita el corrimiento de un día por zona horaria que produce
// `new Date('YYYY-MM-DD').toLocaleDateString()` (se parsea como UTC).
function fmtDate(value: any) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-CL');
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL');
}

export default function WeeklyReportsListPage() {
  const { workWeeklyReports, createWorkWeeklyReport, deleteWorkWeeklyReport, can, isLoading, notify } = useAppState();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super-admin';
  const router = useRouter();
  const canCreate = can('work_reports:create');
  const canDelete = can('work_reports:delete');
  const [creating, setCreating] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [toDelete, setToDelete] = React.useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const handleNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const wr = await createWorkWeeklyReport({});
      router.push(`/dashboard/work-reports/semanal/${wr.id}`);
    } catch (e: any) {
      notify(e?.message || 'No se pudo crear el reporte semanal.', 'destructive');
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteWorkWeeklyReport(toDelete.id);
      notify('Reporte semanal eliminado.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo eliminar.', 'destructive');
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  const filtered = (workWeeklyReports || []).filter((wr) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [wr.title, wr.faena, wr.area, wr.specialty, wr.client]
      .some((v) => (v || '').toLowerCase().includes(q));
  });

  return (
    <PageShell
      title="Reportes Semanales"
      description="Consolidan varios Reportes Diarios en un rango de fechas. Resumen automático y entrega de turno."
      toolbar={
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Input className="rounded-xl sm:w-64" placeholder="Buscar título, faena, área…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {canCreate && (
            <Button className="rounded-[1.5rem] shadow-lg shadow-primary/10" onClick={handleNew} disabled={creating}>
              <Plus className="h-4 w-4 mr-2" /> Nuevo Reporte Semanal
            </Button>
          )}
        </div>
      }
    >
      {isLoading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarRange className="h-8 w-8" />}
          title="No hay reportes semanales"
          description="Crea el primer reporte semanal para consolidar los diarios."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((wr) => {
            const canDeleteThis = canDelete && (isSuperAdmin || wr.status === 'draft');
            return (
              <Card
                key={wr.id}
                className="rounded-[1.5rem] cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => router.push(`/dashboard/work-reports/semanal/${wr.id}`)}
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reporte Semanal</p>
                      <p className="text-lg font-bold">{wr.title || 'Sin título'}</p>
                    </div>
                    <Badge className="rounded-xl" variant={wr.status === 'ready' ? 'default' : 'secondary'}>
                      {STATUS_LABEL[wr.status] || wr.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {wr.faena && <span>📍 {wr.faena}</span>}
                    {wr.specialty && <span>🔧 {wr.specialty}</span>}
                    <span>📅 {fmtDate(wr.startDate)} – {fmtDate(wr.endDate)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="text-xs text-muted-foreground">Diarios: <b className="text-foreground tabular-nums">{(wr.consolidatedReportIds || []).length}</b></span>
                    {canDeleteThis && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="rounded-xl h-8 w-8 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setToDelete({ id: wr.id, title: wr.title || 'este reporte semanal' });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="rounded-[1.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar &ldquo;{toDelete?.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting} onClick={confirmDelete}>
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
