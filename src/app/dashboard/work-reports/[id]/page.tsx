'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowDown, ArrowLeft, ArrowUp, Camera, Check, CheckCircle2, ChevronsUpDown, FileText, ImagePlus,
  Mail, Plus, Save, Send, Signature, Trash2, Upload, XCircle,
} from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { LoadingState } from '@/components/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import SignaturePad from '@/components/signature-pad';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import type {
  Material,
  WorkExecutionStatus,
  WorkReport,
  WorkReportActivity,
  WorkReportDailyOt,
  WorkReportEquipmentItem,
  WorkReportHousekeeping,
  WorkReportHousekeepingItem,
  WorkReportInterference,
  WorkReportLaborItem,
  WorkReportMaterialItem,
  WorkReportNextDayPlan,
  WorkReportPhoto,
  WorkReportSignature,
  WorkReportStatus,
  WorkOrder,
} from '@/modules/core/lib/data';
import { supabase } from '@/modules/core/lib/supabase';
import {
  WORK_REPORT_STATUS_LABEL as STATUS_LABEL,
  WORK_EXECUTION_LABEL as EXECUTION_LABEL,
} from '@/modules/core/lib/work-report-labels';
import { createDefaultHousekeeping } from '@/modules/core/lib/work-report-housekeeping';
import { compressImage } from '@/lib/compress-image';
import { consolidateWorkOrders } from '@/modules/core/lib/work-order-consolidation';

const EMPTY_LABOR: WorkReportLaborItem = { id: '', name: '', role: '', hours: {} };

function laborSubtotal(item: WorkReportLaborItem) {
  const sumHoras = Object.values(item.hours || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  return sumHoras + (Number(item.colacion) || 0) + (Number(item.documentacion) || 0) + (Number(item.traslados) || 0);
}
function laborTotal(item: WorkReportLaborItem) {
  return laborSubtotal(item) + (Number(item.overtimeHours) || 0);
}
const EMPTY_EQUIPMENT: WorkReportEquipmentItem = { id: '', equipment: '', type: '', hours: 0, activity: '' };
const EMPTY_MATERIAL: WorkReportMaterialItem = { id: '', material: '', unit: '', quantity: 0 };
const EMPTY_ACTIVITY: WorkReportActivity = { id: '', description: '' };
const EMPTY_INTERFERENCE: WorkReportInterference = { id: '', reason: '' };
const EMPTY_NEXT_DAY: WorkReportNextDayPlan = { id: '', description: '' };

function interferenceTotalHH(item: WorkReportInterference) {
  return (Number(item.hours) || 0) * (Number(item.workerCount) || 0);
}

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneReport(report: WorkReport): WorkReport {
  return JSON.parse(JSON.stringify(report));
}

export default function WorkReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    workReports,
    users,
    materials,
    workOrders,
    currentTenant,
    updateWorkReport,
    transitionWorkReport,
    signWorkReportApproval,
    recordWorkReportSent,
    uploadWorkReportPhoto,
    deleteWorkReportPhoto,
    deleteWorkReport,
    notify,
    can,
    isLoading,
  } = useAppState();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super-admin';

  const report = (workReports || []).find((r) => r.id === params.id);
  const localKey = `wr_draft_${params.id}`;
  // Tracks whether localStorage was used as source so dirty can start true
  const restoredFromLocalRef = React.useRef(false);
  const [draft, setDraft] = React.useState<WorkReport | null>(() => {
    if (typeof window === 'undefined') return null;
    // Priority 1: newly-created report not yet in Realtime
    const newCached = sessionStorage.getItem(`wr_new_${params.id}`);
    if (newCached) {
      try {
        sessionStorage.removeItem(`wr_new_${params.id}`);
        return JSON.parse(newCached) as WorkReport;
      } catch {}
    }
    // Priority 2: in-progress local draft (supervisor left and came back)
    try {
      const local = localStorage.getItem(localKey);
      if (local) {
        const parsed = JSON.parse(local) as WorkReport;
        if (parsed?.id === params.id) {
          restoredFromLocalRef.current = true;
          return parsed;
        }
      }
    } catch {}
    // Priority 3: DB version already in state
    if (report) return cloneReport(report);
    return null;
  });
  const [dirty, setDirty] = React.useState(() => restoredFromLocalRef.current);
  // Once draft is initialized from any source, this ref prevents Realtime from resetting it
  const draftInitializedRef = React.useRef(draft !== null);
  const [saving, setSaving] = React.useState(false);
  const [photoDescription, setPhotoDescription] = React.useState('');
  const [signatureOpen, setSignatureOpen] = React.useState<null | 'supervisor' | 'operations' | 'final'>(null);
  const [signatureData, setSignatureData] = React.useState('');
  const [useSavedSignature, setUseSavedSignature] = React.useState(true);
  const [reviewNotes, setReviewNotes] = React.useState('');
  const [missingFields, setMissingFields] = React.useState<string[] | null>(null);
  const savedSignature = user?.signature || null;

  const openSignatureDialog = (step: 'supervisor' | 'operations' | 'final') => {
    if (step === 'supervisor') {
      const missing = getMissingForSubmit();
      if (missing.length) { setMissingFields(missing); return; }
    }
    setUseSavedSignature(!!savedSignature);
    setSignatureData(savedSignature || '');
    setSignatureOpen(step);
  };
  const [sendOpen, setSendOpen] = React.useState(false);
  const [sendTo, setSendTo] = React.useState('');
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [forceStatus, setForceStatus] = React.useState<WorkReportStatus | ''>('');

  // Initialize draft from DB only when it hasn't been set yet (avoids resetting after autosave)
  React.useEffect(() => {
    if (report && !draftInitializedRef.current) {
      draftInitializedRef.current = true;
      setDraft(cloneReport(report));
    }
  }, [report]);

  // Notify once on mount if we restored unsaved local changes
  React.useEffect(() => {
    if (restoredFromLocalRef.current) {
      notify('Se restauraron cambios sin guardar. Guarda el borrador cuando estés listo.', 'default');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editable = !!draft && (isSuperAdmin || ((draft.status === 'draft' || draft.status === 'observed') && can('work_reports:edit')));
  const isAwaitingApproval = !!draft && (draft.status === 'pending_review' || draft.status === 'operations_approved');
  // OT (work_orders) que este Diario consolida. Si hay alguna, el reporte deriva
  // personal/equipos/materiales/matriz HH desde ellas (modo cascada).
  const consolidatedOrders = React.useMemo(
    () => (draft?.consolidatedOrderIds || [])
      .map((oid) => (workOrders || []).find((o) => o.id === oid))
      .filter((o): o is WorkOrder => !!o),
    [draft?.consolidatedOrderIds, workOrders],
  );
  const consolidating = consolidatedOrders.length > 0;
  const consolidation = React.useMemo(
    () => (consolidating ? consolidateWorkOrders(consolidatedOrders) : null),
    [consolidating, consolidatedOrders],
  );
  // Fotos del Diario en modo cascada: se toman de las OT consolidadas.
  const consolidatedPhotos = React.useMemo(
    () => consolidatedOrders.flatMap((o) => (o.photos || []).map((p) => ({ ...p, otNumber: o.otNumber }))),
    [consolidatedOrders],
  );

  const totals = React.useMemo(() => {
    if (consolidation) {
      const workers = consolidation.personal.length;
      const hh = consolidation.hhTotal;
      const hm = consolidation.equipos.reduce((s, e) => s + Number(e.horas || 0), 0);
      return { workers, hh, hm };
    }
    return {
      workers: draft?.labor?.length || 0,
      hh: (draft?.labor || []).reduce((s, l) => s + laborTotal(l), 0),
      hm: (draft?.equipment || []).reduce((s, e) => s + Number(e.hours || 0), 0),
    };
  }, [draft, consolidation]);

  const patchDraft = (patch: Partial<WorkReport>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      try { localStorage.setItem(localKey, JSON.stringify(next)); } catch {}
      return next;
    });
    setDirty(true);
  };

  const save = React.useCallback(async (silent = false) => {
    if (!draft || !dirty) return;
    setSaving(true);
    try {
      await updateWorkReport(draft.id, draft);
      setDirty(false);
      try { localStorage.removeItem(localKey); } catch {}
      if (!silent) notify('Borrador guardado.', 'success');
    } catch (error: any) {
      notify(error?.message || 'No se pudo guardar el reporte.', 'destructive');
    } finally {
      setSaving(false);
    }
  }, [draft, dirty, notify, updateWorkReport, localKey]);

  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  }, [save]);

  React.useEffect(() => {
    const timer = setInterval(() => { saveRef.current(true); }, 30000);
    return () => clearInterval(timer);
  }, []);

  if (!draft) {
    if (isLoading) return <LoadingState />;
    return (
      <PageShell title="Reporte no encontrado" description="El informe no existe o no tienes acceso.">
        <Button variant="outline" onClick={() => router.push('/dashboard/work-reports/reportesdiarios')}>Volver</Button>
      </PageShell>
    );
  }

  // Marca/desmarca una OT consolidada. Las OT seleccionadas se reflejan en
  // dailyOts para que definan las columnas de la matriz y los selects de OT.
  const toggleConsolidatedOrder = (order: WorkOrder) => {
    const ids = draft.consolidatedOrderIds || [];
    const nextIds = ids.includes(order.id)
      ? ids.filter((x) => x !== order.id)
      : [...ids, order.id];
    const nextOrders = nextIds
      .map((oid) => (workOrders || []).find((o) => o.id === oid))
      .filter((o): o is WorkOrder => !!o);
    const nextDailyOts = nextOrders.map((o) => ({ id: o.id, otNumber: o.otNumber || '', description: o.description || '' }));
    // El Diario HEREDA la cabecera de la primera OT seleccionada: el contexto
    // (cliente, contrato, área, especialidad, supervisor, fecha, turno) viene de
    // las OT, no se re-captura a mano.
    const rep = nextOrders[0];
    const header: Partial<WorkReport> = rep ? {
      client: rep.client || draft.client,
      contractNumber: rep.contractNumber || draft.contractNumber,
      area: rep.area || draft.area,
      specialty: rep.specialty || draft.specialty,
      location: rep.location || draft.location,
      shift: rep.shift || draft.shift,
      workSchedule: rep.workSchedule || draft.workSchedule,
      workDate: rep.workDate || draft.workDate,
      supervisorId: rep.supervisorId || draft.supervisorId,
      supervisorName: rep.supervisorName || draft.supervisorName,
    } : {};
    patchDraft({ consolidatedOrderIds: nextIds, dailyOts: nextDailyOts, ...header });
  };

  const updateArray = <T extends { id: string }>(key: 'labor' | 'equipment' | 'interferences' | 'materials' | 'nextDayPlan' | 'photos' | 'dailyOts' | 'structuredActivities', items: T[]) => {
    patchDraft({ [key]: items } as Partial<WorkReport>);
  };

  // Actualiza las horas de un trabajador en una OT puntual (celda de la matriz).
  const setLaborHours = (index: number, otId: string, raw: string) => {
    const item = draft!.labor[index];
    const hours = { ...(item.hours || {}) };
    if (raw === '' || Number(raw) === 0) delete hours[otId];
    else hours[otId] = Number(raw);
    updateArray('labor', replaceAt(draft!.labor, index, { ...item, hours }));
  };

  const addProgressSnapshot = (next: Partial<WorkReport>) => {
    const entry = {
      id: uid(),
      percent: next.progressPercent ?? draft.progressPercent,
      status: next.executionStatus ?? draft.executionStatus,
      observations: next.progressObservations ?? draft.progressObservations ?? '',
      date: new Date().toISOString(),
      userId: user?.id || draft.updatedBy || draft.createdBy,
      userName: user?.name || draft.supervisorName,
    };
    patchDraft({ ...next, progressHistory: [...(draft.progressHistory || []), entry] });
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
      patchDraft({ photos });
      await updateWorkReport(draft.id, { ...draft, photos });
      setDirty(false);
      setPhotoDescription('');
      notify('Fotografias cargadas.', 'success');
    } catch (error: any) {
      notify(error?.message || 'No se pudieron subir las fotografias.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const removePhoto = async (photo: WorkReportPhoto) => {
    const originalPhotos = draft.photos || [];
    const photos = originalPhotos.filter((p) => p.id !== photo.id);
    patchDraft({ photos });
    try {
      await deleteWorkReportPhoto(photo);
      await updateWorkReport(draft.id, { ...draft, photos });
      setDirty(false);
      notify('Fotografía eliminada.', 'success');
    } catch (error: any) {
      patchDraft({ photos: originalPhotos });
      setDirty(false);
      notify(error?.message || 'No se pudo eliminar la fotografía.', 'destructive');
    }
  };

  // Housekeeping (página 4). Siempre hay un objeto (el mapper inicializa el default).
  const hk: WorkReportHousekeeping = draft.housekeeping || createDefaultHousekeeping();
  const patchHk = (patch: Partial<WorkReportHousekeeping>) => patchDraft({ housekeeping: { ...hk, ...patch } });
  const patchHkItem = (key: 'items' | 'jefeItems', index: number, patch: Partial<WorkReportHousekeepingItem>) =>
    patchHk({ [key]: replaceAt(hk[key], index, { ...hk[key][index], ...patch }) });

  const handleHkPhoto = async (index: number, files: FileList | null) => {
    if (!files?.length) return;
    setSaving(true);
    try {
      const compressed = await compressImage(files[0]);
      const uploaded = await uploadWorkReportPhoto(draft.id, compressed, `Housekeeping ${index + 1}`);
      const photos = [...(hk.photos || ['', '', '', ''])];
      photos[index] = uploaded.url;
      const housekeeping = { ...hk, photos };
      patchDraft({ housekeeping });
      await updateWorkReport(draft.id, { ...draft, housekeeping });
      setDirty(false);
      notify('Foto de housekeeping cargada.', 'success');
    } catch (error: any) {
      notify(error?.message || 'No se pudo subir la foto.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  // Foto opcional por punto del checklist (2.1, 2.2, …).
  const handleHkItemPhoto = async (index: number, files: FileList | null) => {
    if (!files?.length) return;
    setSaving(true);
    try {
      const compressed = await compressImage(files[0]);
      const uploaded = await uploadWorkReportPhoto(draft.id, compressed, `Housekeeping ${hk.items[index]?.text || index + 1}`);
      const items = replaceAt(hk.items, index, { ...hk.items[index], photo: uploaded.url });
      const housekeeping = { ...hk, items };
      patchDraft({ housekeeping });
      await updateWorkReport(draft.id, { ...draft, housekeeping });
      setDirty(false);
      notify('Foto del punto cargada.', 'success');
    } catch (error: any) {
      notify(error?.message || 'No se pudo subir la foto.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  // Devuelve la lista de campos obligatorios que faltan para enviar a revisión.
  const getMissingForSubmit = (): string[] => [
    // En cascada el número de OT lo aportan las OT consolidadas (no hay un único N°).
    !consolidating && !draft.otNumber?.trim() && 'Número de OT',
    !draft.client?.trim() && 'Cliente',
    !draft.faena?.trim() && 'Faena',
    !draft.area?.trim() && 'Área',
    !draft.workDate && 'Fecha de trabajo',
    !draft.supervisorName?.trim() && 'Supervisor',
    // Modo cascada: validar contra las OT consolidadas; modo legacy: captura manual.
    consolidating
      ? (!consolidation || consolidation.personal.length === 0) && 'Las OT consolidadas no tienen personal'
      : !(draft.dailyOts || []).some((o) => o.otNumber?.trim()) && 'Al menos una OT del día',
    !consolidating && !(draft.structuredActivities || []).some((a) => a.description?.trim()) && 'Al menos una actividad ejecutada',
    !consolidating && !(draft.labor || []).some((l) => l.name?.trim()) && 'Al menos un trabajador en obra',
  ].filter(Boolean) as string[];

  const signedTransition = async (step: WorkReportSignature['step'], action: string, toStatus?: WorkReportStatus) => {
    if (!signatureData) {
      notify('La firma digital es obligatoria.', 'destructive');
      return;
    }
    if (step === 'supervisor') {
      const missing = getMissingForSubmit();
      if (missing.length) { setSignatureOpen(null); setMissingFields(missing); return; }
    }
    try {
      await save(true);
      const signature: WorkReportSignature = {
        id: uid(),
        step,
        userId: user?.id || draft.updatedBy || draft.createdBy,
        userName: user?.name || draft.supervisorName,
        userRole: user?.role || step,
        signature: signatureData,
        date: new Date().toISOString(),
        action,
        notes: reviewNotes,
      };
      if (step === 'supervisor' && toStatus) {
        await transitionWorkReport(draft.id, toStatus, { signature, notes: reviewNotes });
      } else {
        await signWorkReportApproval(draft.id, step as 'operations' | 'final', { signature, notes: reviewNotes });
      }
      setSignatureOpen(null);
      setSignatureData('');
      setReviewNotes('');
      setDirty(false);
      try { localStorage.removeItem(localKey); } catch {}
      notify('Flujo actualizado.', 'success');
    } catch (error: any) {
      notify(error?.message || 'No se pudo realizar la firma y transición.', 'destructive');
    }
  };

  // Genera el PDF en el backend (motor Handlebars + Puppeteer), lo guarda en
  // Storage y devuelve la URL firmada. Guarda el borrador antes para que el PDF
  // refleje los últimos cambios.
  // Genera el PDF al vuelo y devuelve el binario (no se persiste en Storage).
  const requestPdfBlob = async (): Promise<Blob> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
    if (dirty) await save(true);
    const res = await fetch(`/api/work-reports/${draft.id}/pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'No se pudo generar el PDF.');
    }
    return res.blob();
  };

  const downloadPdf = async () => {
    try {
      const blob = await requestPdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${draft.internalCode}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error: any) {
      notify(error?.message || 'No se pudo generar o descargar el PDF.', 'destructive');
    }
  };

  const sendPdf = async () => {
    try {
      const recipients = sendTo.split(/[;,]/).map((v) => v.trim()).filter(Boolean);
      if (!recipients.length) {
        notify('Ingresa al menos un correo.', 'destructive');
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        notify('Sesión expirada. Vuelve a iniciar sesión.', 'destructive');
        return;
      }
      const blob = await requestPdfBlob();
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await fetch('/api/work-reports/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: recipients,
          reportCode: draft.internalCode,
          filename: `${draft.internalCode}.pdf`,
          pdfBase64,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo enviar el reporte.');
      }
      await recordWorkReportSent(draft.id, recipients);
      setSendOpen(false);
      setSendTo('');
      notify('Reporte enviado por correo.', 'success');
    } catch (error: any) {
      notify(error?.message || 'No se pudo enviar el reporte por correo.', 'destructive');
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteWorkReport(draft.id);
      try { localStorage.removeItem(localKey); } catch {}
      notify('Informe eliminado.', 'success');
      router.push('/dashboard/work-reports/reportesdiarios');
    } catch (error: any) {
      notify(error?.message || 'No se pudo eliminar el informe.', 'destructive');
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const sendBackToObserved = async () => {
    try {
      await transitionWorkReport(draft.id, 'observed', { notes: 'Solicita correcciones.' });
      notify('Informe devuelto a observado.', 'success');
    } catch (error: any) {
      notify(error?.message || 'No se pudo observar el informe.', 'destructive');
    }
  };

  const applyForceStatus = async () => {
    if (!forceStatus) return;
    try {
      await transitionWorkReport(draft.id, forceStatus);
      notify(`Estado forzado a "${STATUS_LABEL[forceStatus]}".`, 'success');
      setForceStatus('');
    } catch (error: any) {
      notify(error?.message || 'No se pudo forzar el estado.', 'destructive');
    }
  };

  return (
    <PageShell
      title={`Informe ${draft.internalCode}`}
      description={`${STATUS_LABEL[draft.status]} · ${draft.otNumber || 'Sin OT asignada'}`}
      toolbar={
        <div className="w-full flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <Button variant="outline" onClick={() => router.push('/dashboard/work-reports/reportesdiarios')} className="rounded-xl">
            <ArrowLeft className="h-4 w-4 mr-2" /> Volver
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => save(false)} disabled={!dirty || saving} className="rounded-xl">
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Guardando…' : (draft.status === 'draft' || draft.status === 'observed') ? 'Guardar borrador' : 'Guardar'}
            </Button>
            {can('work_reports:download_pdf') && (
              <Button variant="outline" onClick={downloadPdf} className="rounded-xl">
                <FileText className="h-4 w-4 mr-2" /> PDF
              </Button>
            )}
            {can('work_reports:send') && (
              <Button variant="outline" onClick={() => setSendOpen(true)} className="rounded-xl">
                <Mail className="h-4 w-4 mr-2" /> Enviar
              </Button>
            )}
            {can('work_reports:delete') && (
              <Button variant="destructive" onClick={() => setDeleteOpen(true)} className="rounded-xl">
                <Trash2 className="h-4 w-4 mr-2" /> Eliminar
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          {/* Fuente principal del Diario: las OT del día. Al seleccionarlas se
              hereda la cabecera y se consolidan personal/equipos/materiales/HH/fotos. */}
          <Section title="OT / Reportes de Trabajo del día">
            <p className="text-[10px] text-muted-foreground mb-3">El reporte diario se construye desde las OT. Selecciona las del día: el personal, equipos, materiales, la matriz de horas y las fotografías se consolidan automáticamente, y la información general se hereda de ellas.</p>
            {(workOrders || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay Órdenes de Trabajo creadas. Crea OT en <button type="button" className="text-primary underline" onClick={() => router.push('/dashboard/work-reports/ot')}>OT / Reportes de Trabajo</button>.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[...(workOrders || [])]
                  .sort((a, b) => (a.otNumber || '').localeCompare(b.otNumber || ''))
                  .map((o) => {
                    const selected = (draft.consolidatedOrderIds || []).includes(o.id);
                    const hh = (o.labor || []).reduce((a, l) => a + (Number(l.hours) || 0), 0);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={!editable}
                        onClick={() => toggleConsolidatedOrder(o)}
                        className={`text-left rounded-xl border p-3 transition disabled:opacity-60 ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm truncate">{o.otNumber || '(sin N°)'}</span>
                          <Badge variant="outline" className="rounded-lg shrink-0">{o.status === 'ready' ? 'Lista' : 'Borrador'}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{o.description || 'Sin descripción'}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground mt-1">
                          {o.area && <span>Área: {o.area}</span>}
                          {o.specialty && <span>Esp.: {o.specialty}</span>}
                          <span>HH: {Math.round(hh * 100) / 100}</span>
                          <span>{(o.labor || []).length} pers.</span>
                          <span>{(o.photos || []).length} fotos</span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </Section>

          {consolidating ? (
            <Section title="Información general · heredada de las OT">
              <p className="text-[10px] text-muted-foreground mb-3">Estos datos provienen de las OT seleccionadas. Para cambiarlos, edita la OT correspondiente.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field label="Cliente"><ReadOnly value={draft.client} /></Field>
                <Field label="N° Contrato"><ReadOnly value={draft.contractNumber} /></Field>
                <Field label="Área"><ReadOnly value={draft.area} /></Field>
                <Field label="Especialidad"><ReadOnly value={draft.specialty} /></Field>
                <Field label="Supervisor"><ReadOnly value={draft.supervisorName} /></Field>
                <Field label="Ubicación"><ReadOnly value={draft.location} /></Field>
                <Field label="Turno"><ReadOnly value={draft.shift} /></Field>
                <Field label="Jornada"><ReadOnly value={draft.workSchedule} /></Field>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-6 mb-2">Datos del día (no provienen de las OT)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <TextField label="Faena" value={draft.faena} onChange={(v) => patchDraft({ faena: v })} disabled={!editable} />
                <TextField label="Obra" value={draft.obra || ''} onChange={(v) => patchDraft({ obra: v })} disabled={!editable} />
                <TextField label="Fecha trabajo" type="date" value={String(draft.workDate).slice(0, 10)} onChange={(v) => patchDraft({ workDate: v })} disabled={!editable} />
                <TextField label="Hora inicio" type="time" value={draft.startTime || ''} onChange={(v) => patchDraft({ startTime: v })} disabled={!editable} />
                <TextField label="Hora término" type="time" value={draft.endTime || ''} onChange={(v) => patchDraft({ endTime: v })} disabled={!editable} />
                <Field label="Modalidad">
                  <Select value={draft.dayNight || ''} onValueChange={(v) => patchDraft({ dayNight: v })} disabled={!editable}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Diurno / Nocturno" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Diurno">Diurno</SelectItem>
                      <SelectItem value="Nocturno">Nocturno</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </Section>
          ) : (
            <Section title="Informacion general">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextField label="Numero OT" value={draft.otNumber} onChange={(v) => patchDraft({ otNumber: v })} disabled={!editable} />
                <TextField label="Cliente" value={draft.client} onChange={(v) => patchDraft({ client: v })} disabled={!editable} />
                <TextField label="Faena" value={draft.faena} onChange={(v) => patchDraft({ faena: v })} disabled={!editable} />
                <TextField label="Area" value={draft.area} onChange={(v) => patchDraft({ area: v })} disabled={!editable} />
                <Field label="Supervisor responsable">
                  <Select value={draft.supervisorId || ''} onValueChange={(id) => {
                    const u = users.find((x) => x.id === id);
                    patchDraft({ supervisorId: id, supervisorName: u?.name || draft.supervisorName });
                  }} disabled={!editable}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder={draft.supervisorName || 'Supervisor'} /></SelectTrigger>
                    <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <TextField label="Fecha trabajo" type="date" value={String(draft.workDate).slice(0, 10)} onChange={(v) => patchDraft({ workDate: v })} disabled={!editable} />
                <TextField label="Hora inicio" type="time" value={draft.startTime || ''} onChange={(v) => patchDraft({ startTime: v })} disabled={!editable} />
                <TextField label="Hora termino" type="time" value={draft.endTime || ''} onChange={(v) => patchDraft({ endTime: v })} disabled={!editable} />
                <TextField label="Ubicacion" value={draft.location || ''} onChange={(v) => patchDraft({ location: v })} disabled={!editable} />
                <TextField label="Obra" value={draft.obra || ''} onChange={(v) => patchDraft({ obra: v })} disabled={!editable} />
                <TextField label="N° Contrato" value={draft.contractNumber || ''} onChange={(v) => patchDraft({ contractNumber: v })} disabled={!editable} />
                <TextField label="Addendum N°" value={draft.addendumNumber || ''} onChange={(v) => patchDraft({ addendumNumber: v })} disabled={!editable} />
                <TextField label="Turno" value={draft.shift || ''} onChange={(v) => patchDraft({ shift: v })} disabled={!editable} />
                <TextField label="Especialidad" value={draft.specialty || ''} onChange={(v) => patchDraft({ specialty: v })} disabled={!editable} />
                <TextField label="Emitido por" value={draft.emittedBy || ''} onChange={(v) => patchDraft({ emittedBy: v })} disabled={!editable} />
                <TextField label="Cargo emisor" value={draft.emittedByRole || ''} onChange={(v) => patchDraft({ emittedByRole: v })} disabled={!editable} />
                <TextField label="Jornada (ej. 7x7)" value={draft.workSchedule || ''} onChange={(v) => patchDraft({ workSchedule: v })} disabled={!editable} />
                <Field label="Modalidad">
                  <Select value={draft.dayNight || ''} onValueChange={(v) => patchDraft({ dayNight: v })} disabled={!editable}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Diurno / Nocturno" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Diurno">Diurno</SelectItem>
                      <SelectItem value="Nocturno">Nocturno</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <TextField label="Hora almuerzo" type="time" value={draft.lunchStart || ''} onChange={(v) => patchDraft({ lunchStart: v })} disabled={!editable} />
                <TextField label="Hora reinicio" type="time" value={draft.restartTime || ''} onChange={(v) => patchDraft({ restartTime: v })} disabled={!editable} />
              </div>
            </Section>
          )}

          {consolidating && consolidation && (
            <Section title="Consolidación · vista previa del PDF">
              <div className="space-y-6">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="text-muted-foreground">OT: <b className="text-foreground">{consolidation.ots.length}</b></span>
                  <span className="text-muted-foreground">Personal: <b className="text-foreground">{consolidation.personal.length}</b></span>
                  <span className="text-muted-foreground">HH total: <b className="text-foreground tabular-nums">{consolidation.hhTotal}</b></span>
                </div>

                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Resumen por OT</p>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr><th className="text-left p-2">OT</th><th className="text-left p-2">Actividad</th><th className="text-left p-2">Área</th><th className="text-right p-2">HH</th><th className="text-right p-2">Avance</th></tr>
                      </thead>
                      <tbody>
                        {consolidation.porOt.map((r) => (
                          <tr key={r.id} className="border-t">
                            <td className="p-2 font-medium">{r.otNumber || '—'}</td>
                            <td className="p-2 text-muted-foreground truncate max-w-[16rem]">{r.actividad}</td>
                            <td className="p-2 text-muted-foreground">{r.area}</td>
                            <td className="p-2 text-right tabular-nums">{r.hh}</td>
                            <td className="p-2 text-right tabular-nums">{r.avance}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Matriz de horas (persona × OT)</p>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="text-left p-2 sticky left-0 bg-muted/50">Persona</th>
                          {consolidation.ots.map((c) => <th key={c.id} className="text-right p-2">{c.otNumber}</th>)}
                          <th className="text-right p-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consolidation.personal.map((p, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-2 sticky left-0 bg-card"><span className="font-medium">{p.nombre}</span> <span className="text-muted-foreground">{p.cargo}</span></td>
                            {consolidation.ots.map((c) => <td key={c.id} className="p-2 text-right tabular-nums">{p.horas[c.id] || ''}</td>)}
                            <td className="p-2 text-right tabular-nums font-semibold">{p.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {consolidation.porEspecialidad.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">HH por especialidad</p>
                    <div className="flex flex-wrap gap-2">
                      {consolidation.porEspecialidad.map((s) => (
                        <Badge key={s.especialidad} variant="outline" className="rounded-lg">{s.especialidad}: <b className="ml-1 tabular-nums">{s.hh}</b></Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Equipos ({consolidation.equipos.length})</p>
                    {consolidation.equipos.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
                      <ul className="text-xs space-y-1">
                        {consolidation.equipos.map((e, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{e.equipo}</span><span className="tabular-nums text-muted-foreground">{e.horas} h</span></li>)}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Materiales ({consolidation.materiales.length})</p>
                    {consolidation.materiales.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
                      <ul className="text-xs space-y-1">
                        {consolidation.materiales.map((m, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{m.material}</span><span className="tabular-nums text-muted-foreground">{m.cantidad} {m.unidad}</span></li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </Section>
          )}

          {!consolidating && (
          <DynamicSection title="OTs del día" action="+ Agregar OT" onAdd={() => updateArray('dailyOts', [...(draft.dailyOts || []), { id: uid(), otNumber: '', description: '' }])} disabled={!editable}>
            <p className="text-[10px] text-muted-foreground mb-1">Las OTs definen las columnas de horas en el detalle del personal y se pueden asignar a cada actividad.</p>
            {(draft.dailyOts || []).map((ot, index) => (
              <CompactRow key={ot.id} onDelete={() => updateArray('dailyOts', (draft.dailyOts || []).filter((x) => x.id !== ot.id))} disabled={!editable}>
                <Input className="rounded-xl" placeholder="N° OT (ej. SER-07887)" value={ot.otNumber} disabled={!editable} onChange={(e) => updateArray('dailyOts', replaceAt(draft.dailyOts || [], index, { ...ot, otNumber: e.target.value }))} />
                <Input className="rounded-xl sm:col-span-2" placeholder="Descripción (opcional)" value={ot.description || ''} disabled={!editable} onChange={(e) => updateArray('dailyOts', replaceAt(draft.dailyOts || [], index, { ...ot, description: e.target.value }))} />
              </CompactRow>
            ))}
          </DynamicSection>
          )}

          {!consolidating && (
          <Section title="Actividades ejecutadas">
            <div className="space-y-3">
              {(draft.structuredActivities || []).map((item, index) => (
                <div key={item.id} className="rounded-[1.5rem] border p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                    <Input className="rounded-xl" placeholder="Descripción de la actividad" value={item.description} disabled={!editable} onChange={(e) => updateArray('structuredActivities', replaceAt(draft.structuredActivities || [], index, { ...item, description: e.target.value }))} />
                    <Button size="icon" variant="ghost" className="rounded-xl" disabled={!editable} onClick={() => updateArray('structuredActivities', (draft.structuredActivities || []).filter((x) => x.id !== item.id))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    <Field label="Área"><Input className="rounded-xl" value={item.area || ''} disabled={!editable} onChange={(e) => updateArray('structuredActivities', replaceAt(draft.structuredActivities || [], index, { ...item, area: e.target.value }))} /></Field>
                    <Field label="OT">
                      <Select value={item.otId || ''} onValueChange={(v) => updateArray('structuredActivities', replaceAt(draft.structuredActivities || [], index, { ...item, otId: v }))} disabled={!editable || !(draft.dailyOts || []).length}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sin OT" /></SelectTrigger>
                        <SelectContent>
                          {(draft.dailyOts || []).map((ot) => (
                            <SelectItem key={ot.id} value={ot.id}>{ot.otNumber || 'OT'}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Unidad"><Input className="rounded-xl" value={item.unit || ''} disabled={!editable} onChange={(e) => updateArray('structuredActivities', replaceAt(draft.structuredActivities || [], index, { ...item, unit: e.target.value }))} /></Field>
                    <Field label="Programado"><Input className="rounded-xl" type="number" inputMode="decimal" value={item.plannedQuantity ?? ''} disabled={!editable} onChange={(e) => updateArray('structuredActivities', replaceAt(draft.structuredActivities || [], index, { ...item, plannedQuantity: e.target.value === '' ? undefined : Number(e.target.value) }))} /></Field>
                    <Field label="Cantidad"><Input className="rounded-xl" type="number" inputMode="decimal" value={item.quantity ?? ''} disabled={!editable} onChange={(e) => updateArray('structuredActivities', replaceAt(draft.structuredActivities || [], index, { ...item, quantity: e.target.value === '' ? undefined : Number(e.target.value) }))} /></Field>
                    <Field label="Avance %"><Input className="rounded-xl" type="number" inputMode="decimal" value={item.progress ?? ''} disabled={!editable} onChange={(e) => updateArray('structuredActivities', replaceAt(draft.structuredActivities || [], index, { ...item, progress: e.target.value === '' ? undefined : Math.max(0, Math.min(100, Number(e.target.value))) }))} /></Field>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="mt-4 rounded-xl" onClick={() => updateArray('structuredActivities', [...(draft.structuredActivities || []), { ...EMPTY_ACTIVITY, id: uid() }])} disabled={!editable}><Plus className="h-4 w-4 mr-2" /> + Agregar Actividad</Button>
          </Section>
          )}

          {!consolidating && (
          <Section title="Detalle del personal en obra">
            <div className="space-y-3">
              {(draft.labor || []).map((item, index) => (
                <div key={item.id} className="rounded-[1.5rem] border p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3">
                    <Input className="rounded-xl" placeholder="Nombre y apellidos" value={item.name} disabled={!editable} onChange={(e) => updateArray('labor', replaceAt(draft.labor, index, { ...item, name: e.target.value }))} />
                    <Input className="rounded-xl" placeholder="Cargo" value={item.role} disabled={!editable} onChange={(e) => updateArray('labor', replaceAt(draft.labor, index, { ...item, role: e.target.value }))} />
                    <Input className="rounded-xl" placeholder="Causa ausencia (opcional)" value={item.absenceReason || ''} disabled={!editable} onChange={(e) => updateArray('labor', replaceAt(draft.labor, index, { ...item, absenceReason: e.target.value }))} />
                    <Button size="icon" variant="ghost" className="rounded-xl" disabled={!editable} onClick={() => updateArray('labor', draft.labor.filter((x) => x.id !== item.id))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  {(draft.dailyOts || []).length > 0 && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Horas por OT</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(draft.dailyOts || []).map((ot) => (
                          <Field key={ot.id} label={ot.otNumber || 'OT'}>
                            <Input className="rounded-xl" type="number" inputMode="decimal" value={item.hours?.[ot.id] ?? ''} disabled={!editable} onChange={(e) => setLaborHours(index, ot.id, e.target.value)} />
                          </Field>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Field label="Colación"><Input className="rounded-xl" type="number" inputMode="decimal" value={item.colacion ?? ''} disabled={!editable} onChange={(e) => updateArray('labor', replaceAt(draft.labor, index, { ...item, colacion: e.target.value === '' ? undefined : Number(e.target.value) }))} /></Field>
                    <Field label="Documentación"><Input className="rounded-xl" type="number" inputMode="decimal" value={item.documentacion ?? ''} disabled={!editable} onChange={(e) => updateArray('labor', replaceAt(draft.labor, index, { ...item, documentacion: e.target.value === '' ? undefined : Number(e.target.value) }))} /></Field>
                    <Field label="Traslados"><Input className="rounded-xl" type="number" inputMode="decimal" value={item.traslados ?? ''} disabled={!editable} onChange={(e) => updateArray('labor', replaceAt(draft.labor, index, { ...item, traslados: e.target.value === '' ? undefined : Number(e.target.value) }))} /></Field>
                    <Field label="H. Extra"><Input className="rounded-xl" type="number" inputMode="decimal" value={item.overtimeHours ?? ''} disabled={!editable} onChange={(e) => updateArray('labor', replaceAt(draft.labor, index, { ...item, overtimeHours: e.target.value === '' ? undefined : Number(e.target.value) }))} /></Field>
                  </div>
                  <div className="flex justify-end gap-4 text-xs border-t pt-2">
                    <span className="text-muted-foreground">Sub HH: <b className="text-foreground tabular-nums">{laborSubtotal(item)}</b></span>
                    <span className="text-muted-foreground">Total: <b className="text-foreground tabular-nums">{laborTotal(item)}</b></span>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="mt-4 rounded-xl" onClick={() => updateArray('labor', [...draft.labor, { ...EMPTY_LABOR, id: uid() }])} disabled={!editable}><Plus className="h-4 w-4 mr-2" /> + Agregar Trabajador</Button>
          </Section>
          )}

          {!consolidating && (
          <Section title="Equipos y maquinaria">
            <div className="space-y-3">
              {(draft.equipment || []).map((item, index) => (
                <div key={item.id} className="rounded-[1.5rem] border p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                    <AssetCombobox
                      materials={materials || []}
                      value={item.equipmentId || null}
                      disabled={!editable}
                      onSelect={(m) => updateArray('equipment', replaceAt(draft.equipment, index, { ...item, equipmentId: m.id, equipment: m.name, code: m.internalCode || item.code || '' }))}
                    />
                    <Button size="icon" variant="ghost" className="rounded-xl" disabled={!editable} onClick={() => updateArray('equipment', draft.equipment.filter((x) => x.id !== item.id))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Field label="Equipo"><Input className="rounded-xl" placeholder="Equipo" value={item.equipment} disabled={!editable} onChange={(e) => updateArray('equipment', replaceAt(draft.equipment, index, { ...item, equipment: e.target.value, equipmentId: null }))} /></Field>
                    <Field label="Código"><Input className="rounded-xl" placeholder="Cód. interno" value={item.code || ''} disabled={!editable} onChange={(e) => updateArray('equipment', replaceAt(draft.equipment, index, { ...item, code: e.target.value }))} /></Field>
                    <Field label="Tipo"><Input className="rounded-xl" placeholder="Tipo" value={item.type} disabled={!editable} onChange={(e) => updateArray('equipment', replaceAt(draft.equipment, index, { ...item, type: e.target.value }))} /></Field>
                    <Field label="Hrs. activ."><Input className="rounded-xl" type="number" inputMode="decimal" placeholder="HM" value={item.hours} disabled={!editable} onChange={(e) => updateArray('equipment', replaceAt(draft.equipment, index, { ...item, hours: Number(e.target.value) }))} /></Field>
                  </div>
                  <Field label="Actividad"><Input className="rounded-xl" placeholder="Actividad realizada" value={item.activity} disabled={!editable} onChange={(e) => updateArray('equipment', replaceAt(draft.equipment, index, { ...item, activity: e.target.value }))} /></Field>
                </div>
              ))}
            </div>
            <Button variant="outline" className="mt-4 rounded-xl" onClick={() => updateArray('equipment', [...draft.equipment, { ...EMPTY_EQUIPMENT, id: uid() }])} disabled={!editable}><Plus className="h-4 w-4 mr-2" /> + Agregar Equipo</Button>
          </Section>
          )}

          <Section title="Improductividad / interferencias">
            <div className="space-y-3">
              {(draft.interferences || []).map((item, index) => (
                <div key={item.id} className="rounded-[1.5rem] border p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                    <Input className="rounded-xl" placeholder="Motivo de la interferencia / improductividad" value={item.reason} disabled={!editable} onChange={(e) => updateArray('interferences', replaceAt(draft.interferences || [], index, { ...item, reason: e.target.value }))} />
                    <Button size="icon" variant="ghost" className="rounded-xl" disabled={!editable} onClick={() => updateArray('interferences', (draft.interferences || []).filter((x) => x.id !== item.id))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <Field label="OT">
                      <Select value={item.otId || ''} onValueChange={(v) => updateArray('interferences', replaceAt(draft.interferences || [], index, { ...item, otId: v }))} disabled={!editable || !(draft.dailyOts || []).length}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sin OT" /></SelectTrigger>
                        <SelectContent>
                          {(draft.dailyOts || []).map((ot) => (
                            <SelectItem key={ot.id} value={ot.id}>{ot.otNumber || 'OT'}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Responsable"><Input className="rounded-xl" value={item.responsible || ''} disabled={!editable} onChange={(e) => updateArray('interferences', replaceAt(draft.interferences || [], index, { ...item, responsible: e.target.value }))} /></Field>
                    <Field label="Horas"><Input className="rounded-xl" type="number" inputMode="decimal" value={item.hours ?? ''} disabled={!editable} onChange={(e) => updateArray('interferences', replaceAt(draft.interferences || [], index, { ...item, hours: e.target.value === '' ? undefined : Number(e.target.value) }))} /></Field>
                    <Field label="N° trab."><Input className="rounded-xl" type="number" inputMode="numeric" value={item.workerCount ?? ''} disabled={!editable} onChange={(e) => updateArray('interferences', replaceAt(draft.interferences || [], index, { ...item, workerCount: e.target.value === '' ? undefined : Number(e.target.value) }))} /></Field>
                    <Field label="Total HH"><div className="flex h-10 items-center rounded-xl border bg-muted/40 px-3 text-sm tabular-nums">{interferenceTotalHH(item)}</div></Field>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="mt-4 rounded-xl" onClick={() => updateArray('interferences', [...(draft.interferences || []), { ...EMPTY_INTERFERENCE, id: uid() }])} disabled={!editable}><Plus className="h-4 w-4 mr-2" /> + Agregar Interferencia</Button>
          </Section>

          {!consolidating && (
          <DynamicSection title="Materiales utilizados" action="+ Agregar Material" onAdd={() => updateArray('materials', [...draft.materials, { ...EMPTY_MATERIAL, id: uid() }])} disabled={!editable}>
            {(draft.materials || []).map((item, index) => (
              <CompactRow key={item.id} onDelete={() => updateArray('materials', draft.materials.filter((x) => x.id !== item.id))} disabled={!editable}>
                <Input className="rounded-xl" placeholder="Material" value={item.material} disabled={!editable} onChange={(e) => updateArray('materials', replaceAt(draft.materials, index, { ...item, material: e.target.value }))} />
                <Input className="rounded-xl" placeholder="Unidad" value={item.unit} disabled={!editable} onChange={(e) => updateArray('materials', replaceAt(draft.materials, index, { ...item, unit: e.target.value }))} />
                <Input className="rounded-xl" type="number" placeholder="Cantidad" value={item.quantity} disabled={!editable} onChange={(e) => updateArray('materials', replaceAt(draft.materials, index, { ...item, quantity: Number(e.target.value) }))} />
                <Input className="rounded-xl sm:col-span-3" placeholder="Observaciones" value={item.observations || ''} disabled={!editable} onChange={(e) => updateArray('materials', replaceAt(draft.materials, index, { ...item, observations: e.target.value }))} />
              </CompactRow>
            ))}
          </DynamicSection>
          )}

          <Section title="Programación día siguiente">
            <div className="space-y-3">
              {(draft.nextDayPlan || []).map((item, index) => (
                <div key={item.id} className="rounded-[1.5rem] border p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                    <Input className="rounded-xl" placeholder="Descripción de actividades a ejecutar" value={item.description} disabled={!editable} onChange={(e) => updateArray('nextDayPlan', replaceAt(draft.nextDayPlan || [], index, { ...item, description: e.target.value }))} />
                    <Button size="icon" variant="ghost" className="rounded-xl" disabled={!editable} onClick={() => updateArray('nextDayPlan', (draft.nextDayPlan || []).filter((x) => x.id !== item.id))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Field label="Área"><Input className="rounded-xl" value={item.area || ''} disabled={!editable} onChange={(e) => updateArray('nextDayPlan', replaceAt(draft.nextDayPlan || [], index, { ...item, area: e.target.value }))} /></Field>
                    <Field label="Equipos a ocupar"><Input className="rounded-xl" value={item.equipment || ''} disabled={!editable} onChange={(e) => updateArray('nextDayPlan', replaceAt(draft.nextDayPlan || [], index, { ...item, equipment: e.target.value }))} /></Field>
                    <Field label="Herramienta mayor"><Input className="rounded-xl" value={item.tools || ''} disabled={!editable} onChange={(e) => updateArray('nextDayPlan', replaceAt(draft.nextDayPlan || [], index, { ...item, tools: e.target.value }))} /></Field>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="mt-4 rounded-xl" onClick={() => updateArray('nextDayPlan', [...(draft.nextDayPlan || []), { ...EMPTY_NEXT_DAY, id: uid() }])} disabled={!editable}><Plus className="h-4 w-4 mr-2" /> + Agregar Actividad</Button>
          </Section>

          <Section title="Registro fotografico">
            {consolidating ? (
              consolidatedPhotos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Las fotografías se cargan en cada <button type="button" className="text-primary underline" onClick={() => router.push('/dashboard/work-reports/ot')}>OT / Reporte de Trabajo</button> y se consolidan aquí automáticamente.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {consolidatedPhotos.map((p) => (
                    <Card key={p.id} className="rounded-[1.5rem] overflow-hidden">
                      <img src={p.url} alt={p.description || 'Foto'} className="h-48 w-full object-cover" />
                      <CardContent className="p-4 space-y-2">
                        <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">{p.description || 'Sin descripción'}</p>
                        <Badge variant="outline" className="rounded-lg">OT {p.otNumber || '—'}</Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            ) : (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
              <Input className="rounded-xl" value={photoDescription} onChange={(e) => setPhotoDescription(e.target.value)} placeholder="Descripcion para las proximas fotografias" disabled={!editable} />
              <FileButton icon={<Camera className="h-4 w-4" />} label="Camara" capture files={(files) => handleFiles(files)} disabled={!editable} />
              <FileButton icon={<ImagePlus className="h-4 w-4" />} label="Galeria" files={(files) => handleFiles(files)} disabled={!editable} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
              {(draft.photos || []).map((p, index) => (
                <Card key={p.id} className="rounded-[1.5rem] overflow-hidden">
                  <img src={p.url} alt={p.description || 'Foto del reporte'} className="h-48 w-full object-cover" />
                  <CardContent className="p-4 space-y-3">
                    <Input className="rounded-xl" placeholder="Título / descripción" value={p.description} disabled={!editable} onChange={(e) => updateArray('photos', replaceAt(draft.photos, index, { ...p, description: e.target.value }))} />
                    <Field label="OT">
                      <Select value={p.otId || ''} onValueChange={(v) => updateArray('photos', replaceAt(draft.photos, index, { ...p, otId: v }))} disabled={!editable || !(draft.dailyOts || []).length}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sin OT" /></SelectTrigger>
                        <SelectContent>
                          {(draft.dailyOts || []).map((ot) => (
                            <SelectItem key={ot.id} value={ot.id}>{ot.otNumber || 'OT'}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Ejecutor"><Input className="rounded-xl" value={p.executor || ''} disabled={!editable} onChange={(e) => updateArray('photos', replaceAt(draft.photos, index, { ...p, executor: e.target.value }))} /></Field>
                      <Field label="Visado"><Input className="rounded-xl" value={p.approver || ''} disabled={!editable} onChange={(e) => updateArray('photos', replaceAt(draft.photos, index, { ...p, approver: e.target.value }))} /></Field>
                    </div>
                    <div className="flex gap-2">
                      <Button size="icon" variant="outline" disabled={!editable || index === 0} onClick={() => updateArray('photos', moveAt(draft.photos, index, index - 1))}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="outline" disabled={!editable || index === draft.photos.length - 1} onClick={() => updateArray('photos', moveAt(draft.photos, index, index + 1))}><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="destructive" disabled={!editable} onClick={() => removePhoto(p)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            </>
            )}
          </Section>

          <Section title="Avance del trabajo">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <TextField label="Porcentaje avance" type="number" value={String(draft.progressPercent)} onChange={(v) => patchDraft({ progressPercent: Math.max(0, Math.min(100, Number(v))) })} disabled={!editable} />
              <Field label="Estado trabajo">
                <Select value={draft.executionStatus} onValueChange={(v: WorkExecutionStatus) => patchDraft({ executionStatus: v })} disabled={!editable}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(EXECUTION_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button variant="outline" className="rounded-xl w-full" disabled={!editable} onClick={() => addProgressSnapshot({})}>Guardar hito de avance</Button>
              </div>
            </div>
            <Textarea className="mt-4 rounded-xl" value={draft.progressObservations || ''} disabled={!editable} onChange={(e) => patchDraft({ progressObservations: e.target.value })} placeholder="Observaciones: falta material, clima, autorizaciones." />
          </Section>

          <Section title="Housekeeping (página 4)">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <TextField label="Subtítulo" value={hk.subtitle || ''} onChange={(v) => patchHk({ subtitle: v })} disabled={!editable} />
              <TextField label="Sector" value={hk.sector || ''} onChange={(v) => patchHk({ sector: v })} disabled={!editable} />
              <TextField label="Inspección (hora · fecha)" value={hk.inspection || ''} onChange={(v) => patchHk({ inspection: v })} disabled={!editable} />
              <TextField label="Código" value={hk.code || ''} onChange={(v) => patchHk({ code: v })} disabled={!editable} />
              <TextField label="Rev." value={hk.rev || ''} onChange={(v) => patchHk({ rev: v })} disabled={!editable} />
            </div>

            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-6 mb-2">Verificación de cumplimientos</p>
            <div className="space-y-2">
              {(hk.items || []).map((item, index) => (
                <div key={item.id} className="rounded-[1.25rem] border p-3 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-sm">{item.text}</span>
                    <HkStatus value={item.status} disabled={!editable} onChange={(v) => patchHkItem('items', index, { status: v })} />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input className="rounded-xl flex-1" placeholder="Observaciones" value={item.observations || ''} disabled={!editable} onChange={(e) => patchHkItem('items', index, { observations: e.target.value })} />
                    {item.photo ? (
                      <div className="relative h-16 w-16 shrink-0 rounded-xl overflow-hidden border">
                        <img src={item.photo} alt="Foto del punto" className="h-full w-full object-cover" />
                        <button type="button" disabled={!editable} onClick={() => patchHkItem('items', index, { photo: '' })} className="absolute top-0.5 right-0.5 rounded-full bg-destructive text-destructive-foreground p-0.5 disabled:opacity-50">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="shrink-0">
                        <FileButton icon={<ImagePlus className="h-4 w-4" />} label="Foto (opcional)" files={(files) => handleHkItemPhoto(index, files)} disabled={!editable} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-6 mb-2">Observaciones generales</p>
            <Textarea className="rounded-xl" value={hk.observations || ''} disabled={!editable} onChange={(e) => patchHk({ observations: e.target.value })} placeholder="Observaciones del protocolo de housekeeping." />

            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-6 mb-2">Registro fotográfico (4 fotos)</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => {
                const url = (hk.photos || [])[i] || '';
                return (
                  <div key={i} className="rounded-[1.25rem] border overflow-hidden">
                    {url ? (
                      <>
                        <img src={url} alt={`Housekeeping ${i + 1}`} className="h-32 w-full object-cover" />
                        <div className="p-2">
                          <Button size="sm" variant="destructive" className="w-full rounded-xl" disabled={!editable} onClick={() => patchHk({ photos: Object.assign([...(hk.photos || ['', '', '', ''])], { [i]: '' }) })}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </>
                    ) : (
                      <div className="h-32 flex items-center justify-center p-2">
                        <FileButton icon={<ImagePlus className="h-4 w-4" />} label={`Foto ${i + 1}`} files={(files) => handleHkPhoto(i, files)} disabled={!editable} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-6 mb-2">Verificación de cumplimiento (Jefe de Operaciones)</p>
            <div className="space-y-2">
              {(hk.jefeItems || []).map((item, index) => (
                <div key={item.id} className="rounded-[1.25rem] border p-3 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-sm">{item.text}</span>
                    <HkStatus value={item.status} disabled={!editable} onChange={(v) => patchHkItem('jefeItems', index, { status: v })} />
                  </div>
                  <Input className="rounded-xl" placeholder="Observaciones" value={item.observations || ''} disabled={!editable} onChange={(e) => patchHkItem('jefeItems', index, { observations: e.target.value })} />
                </div>
              ))}
            </div>
          </Section>
        </div>

        <aside className="space-y-6">
          <Card className="rounded-[1.5rem] sticky top-4">
            <CardContent className="p-5 space-y-5">
              <Badge className="rounded-xl">{STATUS_LABEL[draft.status]}</Badge>
              <div className="grid grid-cols-3 gap-3">
                <Mini label="Trab." value={totals.workers} />
                <Mini label="HH" value={totals.hh} />
                <Mini label="HM" value={totals.hm} />
              </div>
              {can('work_reports:submit') && (draft.status === 'draft' || draft.status === 'observed') && (
                <Button className="w-full rounded-xl" onClick={() => openSignatureDialog('supervisor')}>
                  <Send className="h-4 w-4 mr-2" /> Firmar y enviar
                </Button>
              )}
              {/* Aprobación en paralelo: Jefe de Operaciones y ADC pueden firmar en
                  cualquier orden mientras el informe esté en revisión (pending_review)
                  o con una sola de las dos firmas (operations_approved = "1 de 2"). */}
              {isAwaitingApproval && (
                <div className="space-y-2">
                  {draft.operationsApprovedAt && (
                    <p className="text-[10px] font-bold text-success-subtle-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Jefe de Operaciones firmó el {new Date(draft.operationsApprovedAt as any).toLocaleString('es-CL')}
                    </p>
                  )}
                  {draft.finalApprovedAt && (
                    <p className="text-[10px] font-bold text-success-subtle-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" /> ADC firmó el {new Date(draft.finalApprovedAt as any).toLocaleString('es-CL')}
                    </p>
                  )}
                  {can('work_reports:review_operations') && !draft.operationsApprovedAt && (
                    <Button className="w-full rounded-xl" onClick={() => openSignatureDialog('operations')}><CheckCircle2 className="h-4 w-4 mr-2" /> Aprobar como Jefe de Operaciones</Button>
                  )}
                  {can('work_reports:final_approve') && !draft.finalApprovedAt && (
                    <Button className="w-full rounded-xl" onClick={() => openSignatureDialog('final')}><Signature className="h-4 w-4 mr-2" /> Firma final (ADC)</Button>
                  )}
                  {(can('work_reports:review_operations') || can('work_reports:final_approve')) && (
                    <Button variant="outline" className="w-full rounded-xl" onClick={sendBackToObserved}><XCircle className="h-4 w-4 mr-2" /> Observar</Button>
                  )}
                </div>
              )}
              {isSuperAdmin && (
                <div className="space-y-2 rounded-xl border border-dashed p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Forzar estado (Super Admin)</p>
                  <Select value={forceStatus} onValueChange={(v) => setForceStatus(v as WorkReportStatus)}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecciona un estado" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" className="w-full rounded-xl" disabled={!forceStatus || forceStatus === draft.status} onClick={applyForceStatus}>
                    Aplicar estado
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Historial de avance</p>
                {(draft.progressHistory || []).slice(-5).reverse().map((h) => (
                  <div key={h.id} className="rounded-xl border p-3 text-xs">
                    <div className="font-bold">{h.percent}% · {EXECUTION_LABEL[h.status]}</div>
                    <div className="text-muted-foreground">{new Date(h.date).toLocaleString('es-CL')}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <AlertDialog open={!!missingFields} onOpenChange={(open) => !open && setMissingFields(null)}>
        <AlertDialogContent className="rounded-[1.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Faltan datos para enviar a revisión</AlertDialogTitle>
            <AlertDialogDescription>
              Completa los siguientes campos antes de firmar y enviar el informe:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground">
            {(missingFields || []).map((m) => <li key={m}>{m}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogAction className="rounded-xl" onClick={() => setMissingFields(null)}>Entendido</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!signatureOpen} onOpenChange={(open) => !open && setSignatureOpen(null)}>
        <DialogContent className="rounded-[1.5rem]">
          <DialogHeader><DialogTitle>Firma digital</DialogTitle></DialogHeader>
          {savedSignature && useSavedSignature ? (
            <div className="space-y-2">
              <div className="h-40 rounded-xl border bg-card overflow-hidden flex items-center justify-center p-4">
                <img src={savedSignature} alt="Firma guardada" className="max-h-full object-contain" />
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                Se usará tu firma digital guardada en tu perfil.{' '}
                <button type="button" className="underline font-bold" onClick={() => { setUseSavedSignature(false); setSignatureData(''); }}>
                  Firmar manualmente en su lugar
                </button>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="h-48 rounded-xl border bg-card overflow-hidden"><SignaturePad onEnd={setSignatureData} /></div>
              {savedSignature && (
                <p className="text-[10px] text-muted-foreground text-center">
                  <button type="button" className="underline font-bold" onClick={() => { setUseSavedSignature(true); setSignatureData(savedSignature); }}>
                    Usar mi firma guardada en su lugar
                  </button>
                </p>
              )}
            </div>
          )}
          <Textarea className="rounded-xl" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Notas u observaciones" />
          <DialogFooter>
            {signatureOpen === 'supervisor' && <Button onClick={() => signedTransition('supervisor', 'Enviado a revision', 'pending_review')}>Enviar a revision</Button>}
            {signatureOpen === 'operations' && <Button onClick={() => signedTransition('operations', 'Aprobado por operaciones')}>Aprobar</Button>}
            {signatureOpen === 'final' && <Button onClick={() => signedTransition('final', 'Aprobacion final')}>Aprobar final</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="rounded-[1.5rem]">
          <DialogHeader><DialogTitle>Enviar reporte</DialogTitle></DialogHeader>
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Destinatarios</Label>
          <Textarea className="rounded-xl" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="cliente@empresa.cl; control@empresa.cl; rrhh@empresa.cl" />
          <DialogFooter><Button onClick={sendPdf}><Mail className="h-4 w-4 mr-2" /> Enviar PDF</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el informe {draft.internalCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará el informe y sus fotos de forma permanente. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" disabled={deleting} onClick={confirmDelete}>
              {deleting ? 'Eliminando…' : 'Sí, eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-[1.5rem]">
      <CardHeader><CardTitle className="text-lg font-bold">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DynamicSection({ title, action, onAdd, disabled, children }: { title: string; action: string; onAdd: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Section title={title}>
      <div className="space-y-3">{children}</div>
      <Button variant="outline" className="mt-4 rounded-xl" onClick={onAdd} disabled={disabled}><Plus className="h-4 w-4 mr-2" /> {action}</Button>
    </Section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</Label>{children}</div>;
}

function TextField({ label, value, onChange, type = 'text', disabled }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return <Field label={label}><Input className="rounded-xl" type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></Field>;
}

function ReadOnly({ value }: { value?: string | null }) {
  return <div className="flex h-10 items-center rounded-xl border bg-muted/40 px-3 text-sm text-foreground">{value || '—'}</div>;
}

function CompactRow({ children, onDelete, disabled }: { children: React.ReactNode; onDelete: () => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_110px_auto] gap-3 rounded-[1.5rem] border p-3">
      {children}
      <Button size="icon" variant="ghost" className="rounded-xl" onClick={onDelete} disabled={disabled}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

function AssetCombobox({ materials, value, onSelect, disabled }: { materials: Material[]; value: string | null; onSelect: (m: Material) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const selected = materials.find((m) => m.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between rounded-xl font-normal" disabled={disabled}>
          <span className="truncate">{selected ? selected.name : 'Buscar en catálogo de activos…'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Buscar activo…" />
          <CommandList>
            <CommandEmpty>No se encontró el activo.</CommandEmpty>
            <CommandGroup>
              {materials.map((m) => (
                <CommandItem key={m.id} value={m.name} onSelect={() => { onSelect(m); setOpen(false); }} className="flex justify-between">
                  <div className="flex items-center"><Check className={cn('mr-2 h-4 w-4', value === m.id ? 'opacity-100' : 'opacity-0')} />{m.name}</div>
                  {m.internalCode && <span className="text-xs text-muted-foreground">{m.internalCode}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function HkStatus({ value, onChange, disabled }: { value?: string; onChange: (v: 'cumple' | 'nocumple' | 'na' | '') => void; disabled?: boolean }) {
  const opts: { v: 'cumple' | 'nocumple' | 'na'; label: string }[] = [
    { v: 'cumple', label: 'Cumple' },
    { v: 'nocumple', label: 'No cumple' },
    { v: 'na', label: 'N/A' },
  ];
  return (
    <div className="flex gap-1 shrink-0">
      {opts.map((o) => (
        <Button key={o.v} type="button" size="sm" variant={value === o.v ? 'default' : 'outline'} className="rounded-xl h-8 px-2.5 text-xs" disabled={disabled} onClick={() => onChange(value === o.v ? '' : o.v)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function FileButton({ label, icon, files, capture, disabled }: { label: string; icon: React.ReactNode; files: (f: FileList | null) => void; capture?: boolean; disabled?: boolean }) {
  return (
    <Button asChild variant="outline" className="rounded-xl" disabled={disabled}>
      <label className={disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}>
        {icon}<span className="ml-2">{label}</span>
        <input type="file" accept="image/*" capture={capture ? 'environment' : undefined} multiple className="hidden" onChange={(e) => files(e.target.files)} />
      </label>
    </Button>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border p-3 text-center"><div className="font-black tabular-nums">{value}</div><div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div></div>;
}

function replaceAt<T>(items: T[], index: number, item: T) {
  return items.map((x, i) => i === index ? item : x);
}

function moveAt<T>(items: T[], from: number, to: number) {
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
