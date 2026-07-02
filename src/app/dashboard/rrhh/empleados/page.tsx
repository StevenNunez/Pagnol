'use client';

import React, { useState, useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Pencil, Search, Users, ShieldOff } from 'lucide-react';
import type { User } from '@/modules/core/lib/data';
import { EMPLOYMENT_STATUS_LABEL } from '@/modules/core/lib/hr-labels';
import { UserPanel } from '@/components/user-panel';

export default function EmpleadosPage() {
  const { users, can } = useAppState();
  const canEdit = can('hr_employees:edit');

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | null>(null);

  const filtered = useMemo(() => {
    return (users || []).filter((u) => {
      if (!search) return true;
      return `${u.name} ${u.rut ?? ''} ${u.cargo ?? ''}`.toLowerCase().includes(search.toLowerCase());
    });
  }, [users, search]);

  if (!can('hr_employees:view')) {
    return (
      <EmptyState
        icon={<ShieldOff size={22} />}
        title="Sin acceso"
        description="No tienes permisos para ver la ficha de empleados."
      />
    );
  }

  const columns: DataTableColumn<User>[] = [
    { key: 'name', header: 'Nombre', cell: (u) => <span className="font-semibold text-foreground">{u.name}</span> },
    { key: 'rut', header: 'RUT', cell: (u) => <span className="text-muted-foreground">{u.rut || '—'}</span> },
    { key: 'cargo', header: 'Cargo', cell: (u) => <span className="text-muted-foreground">{u.cargo || '—'}</span> },
    { key: 'phone', header: 'Teléfono', cell: (u) => <span className="text-muted-foreground">{u.phone || '—'}</span> },
    {
      key: 'status', header: 'Estado',
      cell: (u) => {
        const status = u.employmentStatus || 'active';
        const cls = status === 'active' ? 'badge-success' : status === 'on_leave' ? 'badge-warning' : 'bg-destructive/10 text-destructive';
        return <Badge variant="outline" className={cls}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>;
      },
    },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (u) => canEdit ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(u)}><Pencil className="h-4 w-4" /></Button>
        </div>
      ) : null,
    },
  ];

  return (
    <PageShell
      title="Ficha de Empleados"
      description="Datos personales, cargo y contacto de emergencia."
      toolbar={
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre, RUT o cargo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-xl" />
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(u) => u.id}
        empty={{ icon: <Users size={22} />, title: 'Sin empleados', description: 'Aún no hay usuarios registrados en este tenant.' }}
        minWidth="700px"
      />

      {editing && (
        <UserPanel
          user={editing}
          isOpen={!!editing}
          onClose={() => setEditing(null)}
          defaultTab="contrato"
        />
      )}
    </PageShell>
  );
}
