'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ClipboardList } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useOfflineCollection } from '@/modules/offline/use-offline-collection';

const STATUS_LABEL: Record<string, string> = { draft: 'Borrador', ready: 'Lista' };

function fmtDate(value: any) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL');
}

export default function WorkOrdersListPage() {
  const { workOrders, createWorkOrder, deleteWorkOrder, can, notify } = useAppState();
  const allWorkOrders = useOfflineCollection('work_orders', workOrders || []);
  const router = useRouter();
  const editable = can('work_reports:create');
  const [creating, setCreating] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const handleNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const wo = await createWorkOrder({});
      router.push(`/dashboard/work-reports/ot/${wo.id}`);
    } catch (e: any) {
      notify(e?.message || 'No se pudo crear la OT.', 'destructive');
    } finally {
      setCreating(false);
    }
  };

  const filtered = allWorkOrders.filter((wo) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [wo.otNumber, wo.area, wo.specialty, wo.client, wo.description]
      .some((v) => (v || '').toLowerCase().includes(q));
  });

  return (
    <PageShell
      title="OT / Reportes de Trabajo"
      description="Captura rápida por orden de trabajo. Cada OT alimenta el Reporte Diario."
      toolbar={
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Input className="rounded-xl sm:w-64" placeholder="Buscar OT, área, especialidad…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {editable && (
            <Button className="rounded-[1.5rem] shadow-lg shadow-primary/10" onClick={handleNew} disabled={creating}>
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
                  {editable && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-xl h-8 w-8 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('¿Eliminar esta OT?')) deleteWorkOrder(wo.id).catch((err: any) => notify(err?.message || 'No se pudo eliminar.', 'destructive'));
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
    </PageShell>
  );
}
