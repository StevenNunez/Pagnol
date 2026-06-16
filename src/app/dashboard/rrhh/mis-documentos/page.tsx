'use client';

import React, { useState, useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { Plus, Trash2, FileText, ExternalLink } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { HRDocument, HRDocumentType } from '@/modules/core/lib/data';
import { HR_DOCUMENT_TYPE_LABEL } from '@/modules/core/lib/hr-labels';

type Form = { documentType: HRDocumentType; name: string; issueDate: string; expiryDate: string };
const EMPTY: Form = { documentType: 'certificate', name: '', issueDate: '', expiryDate: '' };

const fmt = (d: Date | string | null | undefined) => {
  if (!d) return '—';
  const date = new Date(d as any);
  return isNaN(date.getTime()) ? '—' : format(date, "d 'de' MMM yyyy", { locale: es });
};

export default function MisDocumentosPage() {
  const { user } = useAuth();
  const { hrDocuments, addHRDocument, deleteHRDocument, notify } = useAppState();

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<HRDocument | null>(null);

  const myDocs = useMemo(
    () => (hrDocuments || []).filter((d) => d.userId === user?.id)
      .sort((a, b) => new Date(a.expiryDate as any || 0).getTime() - new Date(b.expiryDate as any || 0).getTime()),
    [hrDocuments, user],
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
    if (!user) return;
    if (!form.name.trim()) { notify('El nombre del documento es obligatorio.', 'destructive'); return; }
    if (!file) { notify('Adjunta un archivo.', 'destructive'); return; }
    setSaving(true);
    try {
      await addHRDocument({
        userId: user.id,
        userName: user.name,
        documentType: form.documentType,
        name: form.name,
        issueDate: form.issueDate || null,
        expiryDate: form.expiryDate || null,
        notes: null,
      }, file);
      notify('Documento subido.', 'success');
      setOpen(false);
    } catch (e: any) {
      notify(e?.message || 'No se pudo subir el documento.', 'destructive');
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

  const columns: DataTableColumn<HRDocument>[] = [
    { key: 'type', header: 'Tipo', cell: (d) => <span className="font-semibold text-foreground">{HR_DOCUMENT_TYPE_LABEL[d.documentType]}</span> },
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
      cell: (d) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setToDelete(d)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title="Mis Documentos"
      description="Sube y consulta tus certificados, licencias y contratos."
      toolbar={<Button onClick={openNew} className="rounded-xl gap-2 ml-auto"><Plus className="h-4 w-4" /> Subir Documento</Button>}
    >
      <DataTable
        columns={columns}
        data={myDocs}
        rowKey={(d) => d.id}
        empty={{ icon: <FileText size={22} />, title: 'Sin documentos', description: 'Aún no has subido documentos.' }}
        minWidth="700px"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Subir documento</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <Field label="Tipo">
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
            <Field label="Archivo (PDF o imagen) *" full>
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="rounded-xl" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={save} disabled={saving} className="rounded-xl">{saving ? 'Subiendo…' : 'Subir'}</Button>
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
