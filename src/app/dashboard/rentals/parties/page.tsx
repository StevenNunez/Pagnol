'use client';

import React, { useState, useMemo } from 'react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, Contact, Search } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { RentalParty, RentalPartyType } from '@/modules/core/lib/data';

const EMPTY: Omit<RentalParty, 'id' | 'tenantId' | 'createdAt'> = {
  name: '', partyType: 'lessor', rut: '', contactName: '', email: '',
  phone: '', address: '', bank: '', accountType: '', accountNumber: '', notes: '',
};

export default function RentalPartiesPage() {
  const { rentalParties, rentalContracts, addRentalParty, updateRentalParty, deleteRentalParty, can, notify } = useAppState();
  const canManage = can('rentals:manage_parties');

  const [tab, setTab] = useState<'all' | RentalPartyType>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RentalParty | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [toDelete, setToDelete] = useState<RentalParty | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    return (rentalParties || []).filter((p) => {
      if (tab !== 'all' && p.partyType !== tab) return false;
      if (search && !`${p.name} ${p.rut ?? ''} ${p.contactName ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rentalParties, tab, search]);

  const contractCount = (partyId: string) =>
    (rentalContracts || []).filter((c) => c.partyId === partyId).length;

  const openNew = () => { setEditing(null); setForm({ ...EMPTY, partyType: tab === 'all' ? 'lessor' : tab }); setOpen(true); };
  const openEdit = (p: RentalParty) => {
    setEditing(p);
    setForm({
      name: p.name, partyType: p.partyType, rut: p.rut ?? '', contactName: p.contactName ?? '',
      email: p.email ?? '', phone: p.phone ?? '', address: p.address ?? '', bank: p.bank ?? '',
      accountType: p.accountType ?? '', accountNumber: p.accountNumber ?? '', notes: p.notes ?? '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { notify('El nombre es obligatorio.', 'destructive'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateRentalParty(editing.id, form);
        notify('Contraparte actualizada.', 'success');
      } else {
        await addRentalParty(form);
        notify('Contraparte creada.', 'success');
      }
      setOpen(false);
    } catch (e: any) {
      notify(e?.message || 'No se pudo guardar.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteRentalParty(toDelete.id);
      notify('Contraparte eliminada.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo eliminar (¿tiene contratos asociados?).', 'destructive');
    } finally {
      setToDelete(null);
    }
  };

  const columns: DataTableColumn<RentalParty>[] = [
    { key: 'name', header: 'Nombre', cell: (p) => <span className="font-semibold text-foreground">{p.name}</span> },
    {
      key: 'type', header: 'Tipo',
      cell: (p) => (
        <Badge variant="outline" className={p.partyType === 'lessor' ? 'badge-warning' : 'badge-info'}>
          {p.partyType === 'lessor' ? 'Arrendador' : 'Cliente'}
        </Badge>
      ),
    },
    { key: 'rut', header: 'RUT', cell: (p) => <span className="text-muted-foreground">{p.rut || '—'}</span> },
    { key: 'contact', header: 'Contacto', cell: (p) => <span className="text-muted-foreground">{p.contactName || '—'}</span> },
    { key: 'phone', header: 'Teléfono', cell: (p) => <span className="text-muted-foreground">{p.phone || '—'}</span> },
    { key: 'contracts', header: 'Contratos', cell: (p) => <span className="text-muted-foreground">{contractCount(p.id)}</span> },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (p) => canManage ? (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setToDelete(p)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : null,
    },
  ];

  return (
    <PageShell
      title="Arrendadores y Clientes"
      description="Gestiona las contrapartes de tus contratos de arriendo."
      toolbar={
        <>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center w-full xl:w-auto">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList>
                <TabsTrigger value="all">Todos</TabsTrigger>
                <TabsTrigger value="lessor">Arrendadores</TabsTrigger>
                <TabsTrigger value="client">Clientes</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-xl sm:w-64" />
            </div>
          </div>
          {canManage && (
            <Button onClick={openNew} className="rounded-xl gap-2"><Plus className="h-4 w-4" /> Nueva Contraparte</Button>
          )}
        </>
      }
    >
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(p) => p.id}
        empty={{ icon: <Contact size={22} />, title: 'Sin contrapartes', description: 'Crea arrendadores (proveedores) o clientes para asociarlos a contratos.' }}
        minWidth="800px"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar contraparte' : 'Nueva contraparte'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <Field label="Tipo *">
              <Select value={form.partyType} onValueChange={(v) => setForm({ ...form, partyType: v as RentalPartyType })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lessor">Arrendador (proveedor)</SelectItem>
                  <SelectItem value="client">Cliente</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Nombre / Razón social *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl" />
            </Field>
            <Field label="RUT"><Input value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Persona de contacto"><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Teléfono"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Dirección" full><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Banco"><Input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Tipo de cuenta"><Input value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} className="rounded-xl" /></Field>
            <Field label="N° de cuenta"><Input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Notas" full><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-xl" /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={save} disabled={saving} className="rounded-xl">{saving ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar "{toDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={confirmDelete}>Sí, eliminar</AlertDialogAction>
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
