'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Camera, FileText, ImagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { LoadingState } from '@/components/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { supabase } from '@/modules/core/lib/supabase';
import { compressImage } from '@/lib/compress-image';
import { CatalogCombobox } from '@/components/catalog-combobox';
import type {
  WorkOrder,
  WorkOrderLaborItem,
  WorkOrderEquipmentItem,
  WorkOrderMaterialItem,
  WorkReportPhoto,
} from '@/modules/core/lib/data';

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  const next = [...arr];
  next[index] = value;
  return next;
}

const EMPTY_LABOR: WorkOrderLaborItem = { id: '', name: '', role: '', hours: 0 };
const EMPTY_EQUIPMENT: WorkOrderEquipmentItem = { id: '', equipment: '', hours: 0 };
const EMPTY_MATERIAL: WorkOrderMaterialItem = { id: '', material: '', quantity: 0, unit: '' };

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    workOrders,
    workReportAreas,
    workReportSpecialties,
    workReportMilestones,
    workReportCatalogs,
    materials,
    users,
    updateWorkOrder,
    uploadWorkReportPhoto,
    deleteWorkReportPhoto,
    addWorkReportArea,
    addWorkReportSpecialty,
    addWorkReportMilestone,
    addWorkReportCatalog,
    can,
    notify,
    isLoading,
  } = useAppState();

  // Listas por tipo del catálogo genérico (cliente/contrato/ubicación/turno/jornada).
  const catBy = (kind: string) => (workReportCatalogs || []).filter((c) => c.kind === kind);

  // Catálogo de materiales (bodega) para autocompletar nombre + materialId + unidad.
  const materialOptions = React.useMemo(
    () => (materials || [])
      .filter((m) => !m.archived)
      .map((m) => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [materials],
  );

  const editable = can('work_reports:create');
  const wo = (workOrders || []).find((w) => w.id === params.id);

  const draftInit = React.useRef(false);
  const [draft, setDraft] = React.useState<WorkOrder | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [photoDescription, setPhotoDescription] = React.useState('');

  React.useEffect(() => {
    if (wo && !draftInit.current) {
      setDraft(JSON.parse(JSON.stringify(wo)));
      draftInit.current = true;
    }
  }, [wo]);

  if (!draft) {
    if (!isLoading && !wo) {
      return (
        <PageShell title="OT no encontrada" description="La orden de trabajo no existe o no tienes acceso.">
          <Button variant="outline" className="rounded-xl" onClick={() => router.push('/dashboard/work-reports/ot')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Volver al listado
          </Button>
        </PageShell>
      );
    }
    return <LoadingState />;
  }

  const patchDraft = (patch: Partial<WorkOrder>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateWorkOrder(draft.id, draft);
      notify('OT guardada.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo guardar.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setSaving(true);
    try {
      const uploaded: WorkReportPhoto[] = [];
      for (const file of Array.from(files)) {
        const compressed = await compressImage(file);
        uploaded.push(await uploadWorkReportPhoto(draft.id, compressed, photoDescription));
      }
      const photos = [...(draft.photos || []), ...uploaded];
      setDraft((d) => (d ? { ...d, photos } : d));
      await updateWorkOrder(draft.id, { photos });
      setPhotoDescription('');
      notify('Fotografías cargadas.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudieron subir las fotos.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const removePhoto = async (photo: WorkReportPhoto) => {
    const photos = (draft.photos || []).filter((p) => p.id !== photo.id);
    setDraft((d) => (d ? { ...d, photos } : d));
    try {
      await deleteWorkReportPhoto(photo);
      await updateWorkOrder(draft.id, { photos });
    } catch (e: any) {
      notify(e?.message || 'No se pudo eliminar la foto.', 'destructive');
    }
  };

  const downloadPdf = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
      await save();
      const res = await fetch(`/api/work-orders/${draft.id}/pdf`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo generar el PDF.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OT-${draft.otNumber || draft.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e: any) {
      notify(e?.message || 'No se pudo generar el PDF.', 'destructive');
    }
  };

  return (
    <PageShell
      title={`OT ${draft.otNumber || 'nueva'}`}
      description="Reporte de Trabajo — captura rápida por orden de trabajo."
      toolbar={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => router.push('/dashboard/work-reports/ot')}><ArrowLeft className="h-4 w-4 mr-2" /> Volver</Button>
          <Button variant="outline" className="rounded-xl" onClick={downloadPdf}><FileText className="h-4 w-4 mr-2" /> PDF</Button>
          {editable && <Button className="rounded-xl" onClick={save} disabled={saving}><Save className="h-4 w-4 mr-2" /> Guardar</Button>}
        </div>
      }
    >
      <Section title="Información general">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <TextField label="Número OT" value={draft.otNumber} onChange={(v) => patchDraft({ otNumber: v })} disabled={!editable} />
          <Field label="Cliente">
            <CatalogCombobox value={draft.client} options={catBy('client')} disabled={!editable} placeholder="Selecciona o crea…"
              onChange={(v) => patchDraft({ client: v })} onCreate={(n) => addWorkReportCatalog('client', n)} />
          </Field>
          <Field label="Contrato">
            <CatalogCombobox value={draft.contractNumber || ''} options={catBy('contract')} disabled={!editable} placeholder="Selecciona o crea…"
              onChange={(v) => patchDraft({ contractNumber: v })} onCreate={(n) => addWorkReportCatalog('contract', n)} />
          </Field>
          <Field label="Área">
            <CatalogCombobox value={draft.area || ''} options={workReportAreas} disabled={!editable} placeholder="Selecciona o crea…"
              onChange={(v) => patchDraft({ area: v })} onCreate={(n) => addWorkReportArea(n)} />
          </Field>
          <Field label="Ubicación">
            <CatalogCombobox value={draft.location || ''} options={catBy('location')} disabled={!editable} placeholder="Selecciona o crea…"
              onChange={(v) => patchDraft({ location: v })} onCreate={(n) => addWorkReportCatalog('location', n)} />
          </Field>
          <Field label="Especialidad">
            <CatalogCombobox value={draft.specialty || ''} options={workReportSpecialties} disabled={!editable} placeholder="Selecciona o crea…"
              onChange={(v) => patchDraft({ specialty: v })} onCreate={(n) => addWorkReportSpecialty(n)} />
          </Field>
          <Field label="Hito del contrato">
            <CatalogCombobox value={draft.milestone || ''} options={workReportMilestones} disabled={!editable} placeholder="Selecciona o crea…"
              onChange={(v) => patchDraft({ milestone: v })} onCreate={(n) => addWorkReportMilestone(n)} />
          </Field>
          <Field label="Supervisor responsable">
            <Select value={draft.supervisorId || ''} onValueChange={(id) => patchDraft({ supervisorId: id, supervisorName: (users || []).find((u) => u.id === id)?.name || draft.supervisorName })} disabled={!editable}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
              <SelectContent>
                {(users || []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Turno">
            <CatalogCombobox value={draft.shift || ''} options={catBy('shift')} disabled={!editable} placeholder="Selecciona o crea…"
              onChange={(v) => patchDraft({ shift: v })} onCreate={(n) => addWorkReportCatalog('shift', n)} />
          </Field>
          <Field label="Jornada">
            <CatalogCombobox value={draft.workSchedule || ''} options={catBy('workschedule')} disabled={!editable} placeholder="Selecciona o crea…"
              onChange={(v) => patchDraft({ workSchedule: v })} onCreate={(n) => addWorkReportCatalog('workschedule', n)} />
          </Field>
          <TextField label="Fecha" type="date" value={String(draft.workDate).slice(0, 10)} onChange={(v) => patchDraft({ workDate: v })} disabled={!editable} />
        </div>
      </Section>

      <Section title="Descripción de la actividad">
        <Textarea className="min-h-[120px] rounded-xl" value={draft.description} disabled={!editable} onChange={(e) => patchDraft({ description: e.target.value })} placeholder="Ej: Soldadura de tubería línea carbonato sector norte." />
      </Section>

      <Section title="Personal en obra">
        <div className="space-y-3">
          {(draft.labor || []).map((item, index) => (
            <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_110px_auto] gap-3 rounded-[1.5rem] border p-3">
              <Input className="rounded-xl" placeholder="Nombre y apellidos" value={item.name} disabled={!editable} onChange={(e) => patchDraft({ labor: replaceAt(draft.labor, index, { ...item, name: e.target.value }) })} />
              <Input className="rounded-xl" placeholder="Cargo" value={item.role} disabled={!editable} onChange={(e) => patchDraft({ labor: replaceAt(draft.labor, index, { ...item, role: e.target.value }) })} />
              <Input className="rounded-xl" type="number" inputMode="decimal" placeholder="Horas" value={item.hours} disabled={!editable} onChange={(e) => patchDraft({ labor: replaceAt(draft.labor, index, { ...item, hours: Number(e.target.value) }) })} />
              <Button size="icon" variant="ghost" className="rounded-xl" disabled={!editable} onClick={() => patchDraft({ labor: draft.labor.filter((x) => x.id !== item.id) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" className="mt-4 rounded-xl" disabled={!editable} onClick={() => patchDraft({ labor: [...(draft.labor || []), { ...EMPTY_LABOR, id: uid() }] })}><Plus className="h-4 w-4 mr-2" /> Agregar trabajador</Button>
      </Section>

      <Section title="Equipos y maquinaria">
        <div className="space-y-3">
          {(draft.equipment || []).map((item, index) => (
            <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[1fr_110px_auto] gap-3 rounded-[1.5rem] border p-3">
              <Input className="rounded-xl" placeholder="Equipo" value={item.equipment} disabled={!editable} onChange={(e) => patchDraft({ equipment: replaceAt(draft.equipment, index, { ...item, equipment: e.target.value }) })} />
              <Input className="rounded-xl" type="number" inputMode="decimal" placeholder="Horas" value={item.hours} disabled={!editable} onChange={(e) => patchDraft({ equipment: replaceAt(draft.equipment, index, { ...item, hours: Number(e.target.value) }) })} />
              <Button size="icon" variant="ghost" className="rounded-xl" disabled={!editable} onClick={() => patchDraft({ equipment: draft.equipment.filter((x) => x.id !== item.id) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" className="mt-4 rounded-xl" disabled={!editable} onClick={() => patchDraft({ equipment: [...(draft.equipment || []), { ...EMPTY_EQUIPMENT, id: uid() }] })}><Plus className="h-4 w-4 mr-2" /> Agregar equipo</Button>
      </Section>

      <Section title="Materiales">
        <div className="space-y-3">
          {(draft.materials || []).map((item, index) => (
            <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[1fr_110px_110px_auto] gap-3 rounded-[1.5rem] border p-3">
              <CatalogCombobox
                value={item.material}
                options={materialOptions}
                disabled={!editable}
                placeholder="Material (del catálogo o libre)"
                onCreate={async () => { /* permite material libre fuera del catálogo */ }}
                onChange={(name) => {
                  const matched = (materials || []).find((m) => m.name === name);
                  patchDraft({ materials: replaceAt(draft.materials, index, { ...item, material: name, materialId: matched?.id, unit: item.unit || matched?.unit || '' }) });
                }}
              />
              <Input className="rounded-xl" type="number" inputMode="decimal" placeholder="Cantidad" value={item.quantity} disabled={!editable} onChange={(e) => patchDraft({ materials: replaceAt(draft.materials, index, { ...item, quantity: Number(e.target.value) }) })} />
              <Input className="rounded-xl" placeholder="Unidad" value={item.unit || ''} disabled={!editable} onChange={(e) => patchDraft({ materials: replaceAt(draft.materials, index, { ...item, unit: e.target.value }) })} />
              <Button size="icon" variant="ghost" className="rounded-xl" disabled={!editable} onClick={() => patchDraft({ materials: draft.materials.filter((x) => x.id !== item.id) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" className="mt-4 rounded-xl" disabled={!editable} onClick={() => patchDraft({ materials: [...(draft.materials || []), { ...EMPTY_MATERIAL, id: uid() }] })}><Plus className="h-4 w-4 mr-2" /> Agregar material</Button>
      </Section>

      <Section title="Registro fotográfico">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
          <Input className="rounded-xl" value={photoDescription} onChange={(e) => setPhotoDescription(e.target.value)} placeholder="Descripción para las próximas fotos" disabled={!editable} />
          <FileButton icon={<Camera className="h-4 w-4" />} label="Cámara" capture files={handleFiles} disabled={!editable} />
          <FileButton icon={<ImagePlus className="h-4 w-4" />} label="Galería" files={handleFiles} disabled={!editable} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
          {(draft.photos || []).map((p) => (
            <Card key={p.id} className="rounded-[1.5rem] overflow-hidden">
              <img src={p.url} alt={p.description || 'Foto'} className="h-44 w-full object-cover" />
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground line-clamp-1">{p.description || 'Sin descripción'}</span>
                {editable && <Button size="icon" variant="destructive" className="rounded-xl h-8 w-8" onClick={() => removePhoto(p)}><Trash2 className="h-4 w-4" /></Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Avance del trabajo">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <TextField label="% Programado" type="number" value={String(draft.plannedPercent)} onChange={(v) => patchDraft({ plannedPercent: Math.max(0, Math.min(100, Number(v))) })} disabled={!editable} />
          <TextField label="% Ejecutado" type="number" value={String(draft.executedPercent)} onChange={(v) => patchDraft({ executedPercent: Math.max(0, Math.min(100, Number(v))) })} disabled={!editable} />
          <Field label="Estado">
            <Select value={draft.status} onValueChange={(v) => patchDraft({ status: v as WorkOrder['status'] })} disabled={!editable}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Borrador</SelectItem>
                <SelectItem value="ready">Lista</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-[1.5rem]">
      <CardContent className="p-5 sm:p-6 space-y-4">
        <h2 className="text-lg font-bold">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function TextField({ label, value, onChange, type, disabled }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <Field label={label}>
      <Input className="rounded-xl" type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function FileButton({ label, icon, files, capture, disabled }: { label: string; icon: React.ReactNode; files: (f: FileList | null) => void; capture?: boolean; disabled?: boolean }) {
  return (
    <Button asChild variant="outline" className="rounded-xl" disabled={disabled}>
      <label className={disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}>
        {icon}<span className="ml-2">{label}</span>
        <input type="file" accept="image/*" capture={capture ? 'environment' : undefined} className="hidden" disabled={disabled} onChange={(e) => files(e.target.files)} />
      </label>
    </Button>
  );
}
