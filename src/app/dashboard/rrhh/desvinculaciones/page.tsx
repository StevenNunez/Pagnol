'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { supabase } from '@/modules/core/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, Search, ShieldOff, UserMinus } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { SEPARATION_REASON_LABEL, type PendingItem, type SeparationReason } from '@/lib/worker-separation';
import { fetchPendingEquipment } from '@/modules/core/lib/worker-separation-client';

interface SeparationRow {
  id: string;
  worker_id: string;
  worker_name: string;
  worker_rut: string | null;
  kind: 'separation' | 'reinstatement';
  scope: 'company' | 'contract';
  contract_name: string | null;
  effective_date: string;
  reason_kind: SeparationReason | null;
  reason: string;
  pending_items: PendingItem[];
  created_by_name: string;
  created_at: string;
}

/**
 * Historial de desvinculaciones y reincorporaciones. Son hechos: no se editan ni
 * se borran. «Debe devolver» se recalcula al abrir la página, así que desaparece
 * solo cuando el equipo vuelve al pañol.
 */
export default function DesvinculacionesPage() {
  const { can } = useAppState();
  const allowed = can('hr_employees:edit');

  const [rows, setRows] = useState<SeparationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // workerId → equipos que SIGUEN sin devolver hoy.
  const [stillOwed, setStillOwed] = useState<Record<string, PendingItem[]>>({});
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('worker_separations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (err) { setError(err.message); setRows([]); return; }
    setRows((data ?? []) as SeparationRow[]);
  }, []);

  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  // Sólo se revisa a quienes se fueron con algo pendiente (pocos), y sólo su último hecho.
  const checkOwed = useCallback(async (list: SeparationRow[]) => {
    const latest = new Map<string, SeparationRow>();
    for (const r of list) if (!latest.has(r.worker_id)) latest.set(r.worker_id, r);
    const targets = [...latest.values()].filter(r => r.kind === 'separation' && r.pending_items.length > 0);
    if (targets.length === 0) { setStillOwed({}); return; }
    setChecking(true);
    try {
      const entries = await Promise.all(targets.map(async r => {
        try { return [r.worker_id, await fetchPendingEquipment(r.worker_id)] as const; }
        catch { return [r.worker_id, r.pending_items] as const; }
      }));
      setStillOwed(Object.fromEntries(entries));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { if (rows) void checkOwed(rows); }, [rows, checkOwed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter(r => `${r.worker_name} ${r.worker_rut ?? ''} ${r.contract_name ?? ''}`.toLowerCase().includes(q));
  }, [rows, search]);

  if (!allowed) {
    return (
      <EmptyState icon={<ShieldOff size={22} />} title="Sin acceso" description="Solo RR.HH. y administración ven las desvinculaciones." />
    );
  }

  const latestByWorker = new Map<string, string>();
  for (const r of rows ?? []) if (!latestByWorker.has(r.worker_id)) latestByWorker.set(r.worker_id, r.id);

  const columns: DataTableColumn<SeparationRow>[] = [
    {
      key: 'date', header: 'Fecha',
      cell: r => <span className="text-muted-foreground whitespace-nowrap">{format(new Date(`${r.effective_date}T12:00:00`), 'd MMM yyyy', { locale: es })}</span>,
    },
    {
      key: 'worker', header: 'Trabajador',
      cell: r => (
        <div>
          <p className="font-semibold text-foreground">{r.worker_name}</p>
          <p className="text-xs text-muted-foreground">{r.worker_rut || '—'}</p>
        </div>
      ),
    },
    {
      key: 'kind', header: 'Hecho',
      cell: r => (
        <Badge variant="outline" className={r.kind === 'separation' ? 'bg-destructive/10 text-destructive' : 'badge-success'}>
          {r.kind === 'separation' ? 'Desvinculación' : 'Reincorporación'}
        </Badge>
      ),
    },
    {
      key: 'scope', header: 'Alcance',
      cell: r => <span className="text-muted-foreground">{r.scope === 'company' ? 'Empresa' : `Contrato: ${r.contract_name ?? '—'}`}</span>,
    },
    {
      key: 'reason', header: 'Motivo',
      cell: r => (
        <div className="max-w-xs">
          {r.reason_kind && <p className="text-xs font-bold">{SEPARATION_REASON_LABEL[r.reason_kind]}</p>}
          <p className="text-xs text-muted-foreground break-words">{r.reason}</p>
        </div>
      ),
    },
    {
      key: 'owed', header: 'Debe devolver',
      cell: r => {
        if (r.kind !== 'separation' || r.pending_items.length === 0) return <span className="text-muted-foreground">—</span>;
        if (latestByWorker.get(r.worker_id) !== r.id) return <span className="text-muted-foreground">—</span>;
        const owed = stillOwed[r.worker_id];
        if (!owed) return <span className="text-xs text-muted-foreground">{checking ? 'Revisando…' : '—'}</span>;
        if (owed.length === 0) return <Badge variant="outline" className="badge-success">Todo devuelto</Badge>;
        return (
          <div className="space-y-0.5">
            <Badge variant="outline" className="badge-warning">{owed.length} pendiente{owed.length !== 1 ? 's' : ''}</Badge>
            <p className="text-xs text-muted-foreground max-w-[14rem]">{owed.map(o => o.name).join(', ')}</p>
          </div>
        );
      },
    },
    { key: 'by', header: 'Registró', cell: r => <span className="text-xs text-muted-foreground">{r.created_by_name}</span> },
  ];

  return (
    <PageShell
      title="Desvinculaciones"
      description="Salidas de la empresa o de un contrato. Se conserva todo el historial del trabajador."
      toolbar={
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nombre, RUT o contrato…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 rounded-xl" />
          </div>
          <Button variant="outline" size="icon" className="rounded-xl shrink-0" onClick={() => void load()} aria-label="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      {error && <p className="text-sm text-destructive">No se pudo cargar: {error}</p>}
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={r => r.id}
        isLoading={rows === null}
        empty={{
          icon: <UserMinus size={22} />,
          title: search ? 'Sin resultados' : 'Aún no hay desvinculaciones',
          description: search ? `No se encontró "${search}".` : 'Se registran desde la ficha del trabajador (Contrato / RR.HH. › Desvincular).',
        }}
        minWidth="900px"
      />
    </PageShell>
  );
}
