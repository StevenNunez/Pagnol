'use client';

import React, { useState, useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAppState } from '@/modules/core/contexts/app-provider';
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
import { Plus, Trash2, FileText, ExternalLink, ShieldOff } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { HRDocument, HRDocumentType } from '@/modules/core/lib/data';
import { HR_DOCUMENT_TYPE_LABEL } from '@/modules/core/lib/hr-labels';

type NewDocForm = {
  userId: string;
  documentType: HRDocumentType;
  name: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
};

const EMPTY: NewDocForm = { userId: '', documentType: 'other', name: '', issueDate: '', expiryDate: '', notes: '' };

const fmt = (d: Date | string | null | undefined) => {
  if (!d) return '—';
  const date = new Date(d as any);
  return isNaN(date.getTime()) ? '—' : format(date, "d 'de' MMM yyyy", { locale: es });
};

export default function DocumentosPage() {
  const { hrDocuments, users, addHRDocument, deleteHRDocument, can, notify } = useAppState();
  const canManage = can('hr_documents:manage');

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewDocForm>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<HRDocument | null>(null);

  const sorted = useMemo(
    () => [...(hrDocuments || [])].sort((a, b) => new Date(a.expiryDate as any || 0).getTime() - new Date(b.expiryDate as any || 0).getTime()),
    [hrDocuments],
  );

  const expiryTone = (doc: HRDocument): 'expired' | 'soon' | 'ok' | 'none' => {
    if (!doc.expiryDate) return 'none';
    const days = differenceInCalendarDays(new Date(doc.expiryDate as any), today);
    if (days < 0) return 'expired';
    if (days <= 30) return 'soon';
    return 'ok';
  };

  const openNew = () => { setForm(EMPTY); setFile(null); setOpen(true); };

  const save = async () => {
    if (!form.userId) { notify('Selecciona un empleado.', 'destructive'); return; }
    if (!form.name.trim()) { notify('El nombre del documento es obligatorio.', 'destructive'); return; }
    const employee = (users || []).find((u) => u.id === form.userId);
    setSaving(true);
    try {
      await addHRDocument({
        userId: form.userId,
        userName: employee?.name || '',
        documentType: form.documentType,
        name: form.name,
        issueDate: form.issueDate || null,
        expiryDate: form.expiryDate || null,
        notes: form.notes || null,
      }, file);
      notify('Documento agregado.', 'success');
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
      await deleteHRDocument(toDelete);
      notify('Documento eliminado.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo eliminar.', 'destructive');
    } finally {
      setToDelete(null);
    }
  };

  if (!can('hr_documents:view')) {
    return (
      <EmptyState
        icon={<ShieldOff size={22} />}
        title="Sin acceso"
        description="No tienes permisos para ver los documentos de empleados."
      />
    );
  }

  const columns: DataTableColumn<HRDocument>[] = [
    { key: 'user', header: 'Empleado', cell: (d) => <span className="font-semibold text-foreground">{d.userName}</span> },
    { key: 'type', header: 'Tipo', cell: (d) => <span className="text-muted-foreground">{HR_DOCUMENT_TYPE_LABEL[d.documentType]}</span> },
    { key: 'name', header: 'Documento', cell: (d) => <span className="text-muted-foreground">{d.name}</span> },
    { key: 'issue', header: 'Emisión', cell: (d) => <span className="text-muted-foreground">{fmt(d.issueDate)}</span> },
    {
      key: 'expiry', header: 'Vencimiento',
      cell: (d) => {
        const tone = expiryTone(d);
        const cls = tone === 'expired' ? 'bg-destructive/10 text-destructive' : tone === 'soon' ? 'badge-warning' : tone === 'ok' ? 'badge-success' : '';
        return tone === 'none' ? <span className="text-muted-foreground">—</span> : <Badge variant="outline" className={cls}>{fmt(d.expiryDate)}</Badge>;
      },
    },
    {
      key: 'file', header: '',
      cell: (d) => d.fileUrl ? (
        <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary text-xs font-bold">
          <ExternalLink className="h-3.5 w-3.5" /> Ver
        </a>
      ) : null,
    },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (d) => canManage ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setToDelete(d)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : null,
    },
  ];

  return (
    <PageShell
      title="Documentos de Empleados"
      description="Contratos, certificados y vencimientos del personal."
      toolbar={canManage ? (
        <Button onClick={openNew} className="rounded-xl gap-2 ml-auto"><Plus className="h-4 w-4" /> Nuevo Documento</Button>
      ) : undefined}
    >
      <DataTable
        columns={columns}
        data={sorted}
        rowKey={(d) => d.id}
        empty={{ icon: <FileText size={22} />, title: 'Sin documentos', description: 'Agrega contratos, certificados o exámenes de tus empleados.' }}
        minWidth="900px"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo documento</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <Field label="Empleado *" full>
              <Select value={form.userId} onValueChange={(v) => setForm({ ...form, userId: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecciona un empleado" /></SelectTrigger>
                <SelectContent>
                  {(users || []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tipo de documento">
              <Select value={form.documentType} onValueChange={(v) => setForm({ ...form, documentType: v as HRDocumentType })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(HR_DOCUMENT_TYPE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Nombre *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Fecha de emisión"><Input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Fecha de vencimiento"><Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} className="rounded-xl" /></Field>
            <Field label="Archivo (PDF o imagen)" full>
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="rounded-xl" />
            </Field>
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
