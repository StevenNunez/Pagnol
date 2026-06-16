'use client';

import React, { useState, useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
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
import { Pencil, Search, Users, ShieldOff } from 'lucide-react';
import type { User } from '@/modules/core/lib/data';
import { EMPLOYMENT_STATUS_LABEL } from '@/modules/core/lib/hr-labels';

type EditForm = {
  cargo: string;
  phone: string;
  address: string;
  birthDate: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  employmentStatus: NonNullable<User['employmentStatus']>;
};

const toDateInput = (d: Date | string | null | undefined) => {
  if (!d) return '';
  const date = new Date(d as any);
  return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

export default function EmpleadosPage() {
  const { users, updateUser, can, notify } = useAppState();
  const canEdit = can('hr_employees:edit');

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    return (users || []).filter((u) => {
      if (!search) return true;
      return `${u.name} ${u.rut ?? ''} ${u.cargo ?? ''}`.toLowerCase().includes(search.toLowerCase());
    });
  }, [users, search]);

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({
      cargo: u.cargo ?? '',
      phone: u.phone ?? '',
      address: u.address ?? '',
      birthDate: toDateInput(u.birthDate),
      emergencyContactName: u.emergencyContactName ?? '',
      emergencyContactPhone: u.emergencyContactPhone ?? '',
      employmentStatus: u.employmentStatus ?? 'active',
    });
  };

  const save = async () => {
    if (!editing || !form) return;
    setSaving(true);
    try {
      await updateUser(editing.id, {
        cargo: form.cargo,
        phone: form.phone,
        address: form.address,
        birthDate: form.birthDate || null,
        emergencyContactName: form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        employmentStatus: form.employmentStatus,
      });
      notify('Ficha actualizada.', 'success');
      setEditing(null);
    } catch (e: any) {
      notify(e?.message || 'No se pudo guardar.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
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

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ficha de {editing?.name}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
              <Field label="Cargo"><Input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} className="rounded-xl" /></Field>
              <Field label="Teléfono"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-xl" /></Field>
              <Field label="Dirección" full><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-xl" /></Field>
              <Field label="Fecha de nacimiento"><Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className="rounded-xl" /></Field>
              <Field label="Estado laboral">
                <Select value={form.employmentStatus} onValueChange={(v) => setForm({ ...form, employmentStatus: v as EditForm['employmentStatus'] })}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Activo</SelectItem>
                    <SelectItem value="on_leave">Con Licencia/Vacaciones</SelectItem>
                    <SelectItem value="terminated">Desvinculado</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Contacto de emergencia"><Input value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} className="rounded-xl" /></Field>
              <Field label="Teléfono de emergencia"><Input value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} className="rounded-xl" /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} className="rounded-xl">Cancelar</Button>
            <Button onClick={save} disabled={saving} className="rounded-xl">{saving ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
