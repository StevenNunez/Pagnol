'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, PenLine, RotateCcw, Save } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { LoadingState } from '@/components/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SignaturePad from '@/components/signature-pad';
import { CatalogCombobox } from '@/components/catalog-combobox';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { supabase } from '@/modules/core/lib/supabase';
import { consolidateWeekly } from '@/modules/core/lib/work-order-consolidation';
import { WORK_REPORT_STATUS_LABEL } from '@/modules/core/lib/work-report-labels';
import type { WorkReport, WorkReportSignature, WorkWeeklyReport } from '@/modules/core/lib/data';

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateOnly(value: any): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Evita el corrimiento de un día por zona horaria que produce
// `new Date('YYYY-MM-DD').toLocaleDateString()` (se parsea como UTC).
function fmtDate(value: any) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-CL');
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL');
}

export default function WeeklyReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    workWeeklyReports,
    workReports,
    workOrders,
    workReportAreas,
    workReportSpecialties,
    workReportCatalogs,
    addWorkReportCatalog,
    users,
    updateWorkWeeklyReport,
    deleteWorkWeeklyReport,
    can,
    notify,
    isLoading,
  } = useAppState();

  const wr = (workWeeklyReports || []).find((w) => w.id === params.id);

  // Cliente y contrato salen del catálogo de Reportes de Trabajo; faena y obra
  // no tienen catálogo propio, así que se ofrecen los valores que ya se usaron
  // en Diarios y Semanales anteriores. En los cuatro casos se puede escribir uno
  // nuevo: son campos abiertos, sólo dejan de obligar a tipear lo de siempre.
  const catalogNames = React.useCallback(
    (kind: string) => (workReportCatalogs || []).filter((c) => c.kind === kind).map((c) => c.name),
    [workReportCatalogs],
  );

  const usedNames = React.useCallback(
    (pick: (row: any) => string | undefined | null) => [
      ...(workReports || []).map(pick),
      ...(workWeeklyReports || []).map(pick),
    ],
    [workReports, workWeeklyReports],
  );

  const asOptions = (values: (string | undefined | null)[]) => {
    const seen = new Set<string>();
    const options: { id: string; name: string }[] = [];
    for (const value of values) {
      const name = (value || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      options.push({ id: name, name });
    }
    return options.sort((a, b) => a.name.localeCompare(b.name));
  };

  const clientOptions = React.useMemo(
    () => asOptions([...catalogNames('client'), ...usedNames((r) => r.client)]),
    [catalogNames, usedNames],
  );
  const contractOptions = React.useMemo(
    () => asOptions([...catalogNames('contract'), ...usedNames((r) => r.contractNumber)]),
    [catalogNames, usedNames],
  );
  const faenaOptions = React.useMemo(() => asOptions(usedNames((r) => r.faena)), [usedNames]);
  const obraOptions = React.useMemo(() => asOptions(usedNames((r) => r.obra)), [usedNames]);

  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super-admin';
  const savedSignature = user?.signature || null;

  const draftInit = React.useRef(false);
  const [draft, setDraft] = React.useState<WorkWeeklyReport | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [signatureOpen, setSignatureOpen] = React.useState<null | 'supervisor' | 'operations'>(null);
  const [signatureData, setSignatureData] = React.useState('');
  const [useSavedSignature, setUseSavedSignature] = React.useState(true);

  React.useEffect(() => {
    if (wr && !draftInit.current) {
      setDraft(JSON.parse(JSON.stringify(wr)));
      draftInit.current = true;
    }
  }, [wr]);

  // Diarios seleccionados + candidatos dentro del rango de fechas. Una vez
  // firmado (status !== 'draft') se usa la copia congelada
  // (consolidatedReportsSnapshot) en vez de los Diarios en vivo, para que el
  // Semanal ya firmado no cambie si alguien reabre/edita un Diario después.
  // Memoizado (a diferencia de las colecciones del estado global, `draft` SÍ puede
  // ser undefined, así que el `|| []` hace falta): sin esto era un array nuevo por
  // render y recalculaba `selectedReports` y `candidates` sin que cambiara nada.
  const selectedIds = React.useMemo(() => draft?.consolidatedReportIds || [], [draft]);
  const usingSnapshot = !!draft && draft.status !== 'draft' && !!draft.consolidatedReportsSnapshot?.length;
  const selectedReports = React.useMemo(() => {
    if (usingSnapshot) return draft!.consolidatedReportsSnapshot as WorkReport[];
    return (workReports || []).filter((r) => selectedIds.includes(r.id));
  }, [usingSnapshot, draft, workReports, selectedIds]);
  const consolidation = React.useMemo(
    () => consolidateWeekly(selectedReports, workOrders || []),
    [selectedReports, workOrders],
  );
  const candidates = React.useMemo(() => {
    if (!draft) return [];
    const from = dateOnly(draft.startDate);
    const to = dateOnly(draft.endDate);
    return (workReports || [])
      .filter((r) => {
        const d = dateOnly(r.workDate);
        return selectedIds.includes(r.id) || (d >= from && d <= to);
      })
      .sort((a, b) => dateOnly(a.workDate).localeCompare(dateOnly(b.workDate)));
  }, [workReports, draft, selectedIds]);

  // Limpieza de Semanal "fantasma": si el usuario crea uno y sale sin
  // capturar nada, se borra solo al salir de la página (mismo patrón que OT
  // y Diarios).
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  React.useEffect(() => {
    return () => {
      const d = draftRef.current;
      if (!d || d.status !== 'draft') return;
      const pristine = !d.title?.trim() && !d.client?.trim() && !d.faena?.trim()
        && !(d.consolidatedReportIds || []).length
        && !d.observations?.trim() && !d.shiftHandover?.trim()
        && !(d.signatures || []).length;
      if (pristine) deleteWorkWeeklyReport(d.id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!draft) {
    if (!isLoading && !wr) {
      return (
        <PageShell title="Reporte semanal no encontrado" description="No existe o no tienes acceso.">
          <Button variant="outline" className="rounded-xl" onClick={() => router.push('/dashboard/work-reports/semanal')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Volver al listado
          </Button>
        </PageShell>
      );
    }
    return <LoadingState />;
  }

  // El contenido solo es editable en borrador (o siempre para super-admin).
  // Firmar como supervisor pasa el estado a 'ready' y, con eso, congela todo
  // — evita que un documento con firma digital mute después de firmado.
  const editable = isSuperAdmin || (draft.status === 'draft' && can('work_reports:edit'));
  // Jefe de Operaciones firma DESPUÉS del supervisor (orden lógico: aprueba lo
  // que el supervisor ya envió), y requiere su propio permiso — antes
  // cualquiera con permiso de creación podía firmar como Jefe de Operaciones.
  const canSignOperations = draft.status === 'ready' && (isSuperAdmin || can('work_reports:review_operations'));
  const canReopen = draft.status === 'ready' && (isSuperAdmin || can('work_reports:edit'));

  const patchDraft = (patch: Partial<WorkWeeklyReport>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const toggleReport = (id: string) => {
    const ids = draft.consolidatedReportIds || [];
    const nextIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    const nextReports = (workReports || []).filter((r) => nextIds.includes(r.id));
    // Hereda la cabecera del primer Diario seleccionado — igual que el Diario
    // hereda de la OT — para no volver a digitar cliente/faena/obra/contrato
    // que el Diario ya trae.
    const rep = nextReports[0];
    const header: Partial<WorkWeeklyReport> = rep ? {
      client: rep.client || draft.client,
      faena: rep.faena || draft.faena,
      obra: rep.obra || draft.obra,
      contractNumber: rep.contractNumber || draft.contractNumber,
      area: rep.area || draft.area,
      specialty: rep.specialty || draft.specialty,
      supervisorId: rep.supervisorId || draft.supervisorId,
      supervisorName: rep.supervisorName || draft.supervisorName,
    } : {};
    patchDraft({ consolidatedReportIds: nextIds, ...header });
  };

  const getMissingForSignature = (): string[] => [
    !draft.title?.trim() && 'Título',
    !draft.faena?.trim() && 'Faena',
    !(draft.consolidatedReportIds || []).length && 'Al menos un Diario consolidado',
    dateOnly(draft.startDate) > dateOnly(draft.endDate) && 'Rango de fechas inválido (Desde posterior a Hasta)',
  ].filter((x): x is string => !!x);

  const openSignatureDialog = (step: 'supervisor' | 'operations') => {
    if (step === 'supervisor') {
      const missing = getMissingForSignature();
      if (missing.length) { notify(`Faltan datos para firmar: ${missing.join(', ')}.`, 'destructive'); return; }
    }
    setUseSavedSignature(!!savedSignature);
    setSignatureData(savedSignature || '');
    setSignatureOpen(step);
  };

  const reopenDraft = async () => {
    const next: WorkWeeklyReport = { ...draft, status: 'draft', signatures: [], consolidatedReportsSnapshot: null };
    setDraft(next);
    try {
      await updateWorkWeeklyReport(draft.id, next);
      notify('Reporte reabierto como borrador. Deberás volver a firmar.', 'default');
    } catch (e: any) {
      notify(e?.message || 'No se pudo reabrir el reporte.', 'destructive');
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateWorkWeeklyReport(draft.id, draft);
      notify('Reporte semanal guardado.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo guardar.', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
      await save();
      const res = await fetch(`/api/work-weekly-reports/${draft.id}/pdf`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo generar el PDF.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Semanal-${draft.title || draft.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e: any) {
      notify(e?.message || 'No se pudo generar el PDF.', 'destructive');
    }
  };

  const signStep = async (step: 'supervisor' | 'operations') => {
    if (!signatureData) { notify('La firma digital es obligatoria.', 'destructive'); return; }
    if (step === 'operations' && !canSignOperations) {
      notify('El supervisor debe firmar primero.', 'destructive');
      return;
    }
    const signature: WorkReportSignature = {
      id: uid(),
      step,
      userId: user?.id || draft.supervisorId || '',
      userName: user?.name || draft.supervisorName,
      userRole: user?.role || step,
      signature: signatureData,
      date: new Date().toISOString(),
      action: step === 'supervisor' ? 'Firma supervisor' : 'Aprobación jefe de operaciones',
    };
    // Reemplaza cualquier firma previa del mismo paso (re-firma).
    const signatures = [...(draft.signatures || []).filter((s) => s.step !== step), signature];
    // Al firmar el supervisor se congela una copia de los Diarios
    // consolidados (en ese momento `selectedReports` todavía es la lista en
    // vivo, porque el estado sigue en 'draft' hasta esta misma actualización)
    // — evita que el Semanal cambie si alguien reabre/edita un Diario después.
    const next: WorkWeeklyReport = {
      ...draft,
      signatures,
      status: step === 'supervisor' ? 'ready' : draft.status,
      consolidatedReportsSnapshot: step === 'supervisor' ? selectedReports : draft.consolidatedReportsSnapshot,
    };
    setDraft(next);
    try {
      await updateWorkWeeklyReport(draft.id, next);
      setSignatureOpen(null);
      setSignatureData('');
      notify('Firma registrada.', 'success');
    } catch (e: any) {
      notify(e?.message || 'No se pudo registrar la firma.', 'destructive');
    }
  };

  const findSig = (step: 'supervisor' | 'operations') =>
    [...(draft.signatures || [])].reverse().find((s) => s.step === step);

  return (
    <PageShell
      title={draft.title || 'Reporte Semanal'}
      description="Consolida los Reportes Diarios de un rango de fechas."
      toolbar={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => router.push('/dashboard/work-reports/semanal')}><ArrowLeft className="h-4 w-4 mr-2" /> Volver</Button>
          <Button variant="outline" className="rounded-xl" onClick={downloadPdf}><FileText className="h-4 w-4 mr-2" /> PDF</Button>
          {canReopen && <Button variant="outline" className="rounded-xl" onClick={reopenDraft}><RotateCcw className="h-4 w-4 mr-2" /> Reabrir borrador</Button>}
          {editable && <Button className="rounded-xl" onClick={save} disabled={saving}><Save className="h-4 w-4 mr-2" /> Guardar</Button>}
        </div>
      }
    >
      <Section title="Información general">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <TextField label="Título" value={draft.title} onChange={(v) => patchDraft({ title: v })} disabled={!editable} />
          <Field label="Cliente">
            <CatalogCombobox
              value={draft.client} options={clientOptions} disabled={!editable}
              placeholder="Selecciona o escribe…"
              onChange={(v) => patchDraft({ client: v })}
              onCreate={(name) => addWorkReportCatalog('client', name)}
            />
          </Field>
          <Field label="Faena">
            <CatalogCombobox
              value={draft.faena} options={faenaOptions} disabled={!editable}
              placeholder="Selecciona o escribe…"
              onChange={(v) => patchDraft({ faena: v })}
              onCreate={async () => { /* la faena no tiene catálogo: queda como texto del reporte */ }}
            />
          </Field>
          <Field label="Obra">
            <CatalogCombobox
              value={draft.obra || ''} options={obraOptions} disabled={!editable}
              placeholder="Selecciona o escribe…"
              onChange={(v) => patchDraft({ obra: v })}
              onCreate={async () => { /* la obra no tiene catálogo: queda como texto del reporte */ }}
            />
          </Field>
          <Field label="N° Contrato">
            <CatalogCombobox
              value={draft.contractNumber || ''} options={contractOptions} disabled={!editable}
              placeholder="Selecciona o escribe…"
              onChange={(v) => patchDraft({ contractNumber: v })}
              onCreate={(name) => addWorkReportCatalog('contract', name)}
            />
          </Field>
          <CatalogSelect label="Área" value={draft.area || ''} options={workReportAreas} onChange={(v) => patchDraft({ area: v })} disabled={!editable} />
          <CatalogSelect label="Especialidad" value={draft.specialty || ''} options={workReportSpecialties} onChange={(v) => patchDraft({ specialty: v })} disabled={!editable} />
          <Field label="Supervisor responsable">
            <Select value={draft.supervisorId || ''} onValueChange={(id) => patchDraft({ supervisorId: id, supervisorName: (users || []).find((u) => u.id === id)?.name || draft.supervisorName })} disabled={!editable}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
              <SelectContent>
                {(users || []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <TextField label="Desde" type="date" value={dateOnly(draft.startDate)} onChange={(v) => patchDraft({ startDate: v })} disabled={!editable} />
          <TextField label="Hasta" type="date" value={dateOnly(draft.endDate)} onChange={(v) => patchDraft({ endDate: v })} disabled={!editable} />
          <Field label="Estado">
            <div className="h-10 flex items-center">
              <Badge className="rounded-xl" variant={draft.status === 'ready' ? 'default' : 'secondary'}>
                {draft.status === 'ready' ? 'Listo (firmado)' : 'Borrador'}
              </Badge>
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Reportes Diarios a consolidar">
        {usingSnapshot ? (
          <>
            <p className="text-[10px] text-muted-foreground mb-3">Este Semanal ya fue firmado: los Diarios quedaron congelados en ese momento. Si alguien reabre y edita uno de estos Diarios después, este Semanal no cambia.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedReports.map((r) => (
                <div key={r.id} className="rounded-xl border p-3 bg-muted/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm truncate">{r.otNumber || 'Diario'} · {fmtDate(r.workDate)}</span>
                    <Badge variant="outline" className="rounded-lg shrink-0">Congelado</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{r.faena || r.area || 'Sin faena'}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-[10px] text-muted-foreground mb-3">Se muestran los diarios dentro del rango de fechas. Marca los que entran en esta semana. Solo se pueden consolidar Diarios ya enviados a revisión (no borradores).</p>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay Reportes Diarios en el rango seleccionado.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {candidates.map((r) => {
                  const selected = selectedIds.includes(r.id);
                  const selectable = selected || (r.status !== 'draft' && r.status !== 'observed');
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={!editable || !selectable}
                      title={!selectable ? 'Este Diario sigue en borrador — envíalo a revisión para poder consolidarlo.' : undefined}
                      onClick={() => toggleReport(r.id)}
                      className={`text-left rounded-xl border p-3 transition disabled:opacity-60 ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm truncate">{r.otNumber || 'Diario'} · {fmtDate(r.workDate)}</span>
                        <Badge variant="outline" className="rounded-lg shrink-0">{WORK_REPORT_STATUS_LABEL[r.status] || r.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{r.faena || r.area || 'Sin faena'}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Section>

      {consolidation.reportCount > 0 && (
        <Section title="Consolidación de la semana">
          <div className="flex flex-wrap gap-4 text-sm mb-4">
            <span className="text-muted-foreground">Diarios: <b className="text-foreground">{consolidation.reportCount}</b></span>
            <span className="text-muted-foreground">OT (acum.): <b className="text-foreground">{consolidation.otTotal}</b></span>
            <span className="text-muted-foreground">HH total: <b className="text-foreground tabular-nums">{consolidation.hhTotal}</b></span>
            <span className="text-muted-foreground">Dotación máx.: <b className="text-foreground tabular-nums">{consolidation.workersMax}</b></span>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr><th className="text-left p-2">Fecha</th><th className="text-left p-2">OT principal</th><th className="text-right p-2">OT</th><th className="text-right p-2">Personal (día)</th><th className="text-right p-2">HH</th><th className="text-left p-2">Estado</th></tr>
              </thead>
              <tbody>
                {consolidation.dias.map((d) => (
                  <tr key={d.reportId} className="border-t">
                    <td className="p-2 font-medium">{fmtDate(d.fecha)}</td>
                    <td className="p-2 text-muted-foreground truncate max-w-[12rem]">{d.otNumber || '—'}</td>
                    <td className="p-2 text-right tabular-nums">{d.otCount}</td>
                    <td className="p-2 text-right tabular-nums">{d.workers}</td>
                    <td className="p-2 text-right tabular-nums">{d.hh}</td>
                    <td className="p-2">{(WORK_REPORT_STATUS_LABEL as Record<string, string>)[d.estado] || d.estado}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="p-2" colSpan={2}>Total semana</td>
                  <td className="p-2 text-right tabular-nums">{consolidation.otTotal}</td>
                  <td className="p-2 text-right tabular-nums" title="Mayor dotación en un solo día, no la suma de la semana">máx. {consolidation.workersMax}</td>
                  <td className="p-2 text-right tabular-nums">{consolidation.hhTotal}</td>
                  <td className="p-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      )}

      <Section title="Observaciones de la semana">
        <Textarea className="min-h-[100px] rounded-xl" value={draft.observations || ''} disabled={!editable} onChange={(e) => patchDraft({ observations: e.target.value })} placeholder="Resumen general, hitos cumplidos, desviaciones…" />
      </Section>

      <Section title="Entrega de turno">
        <Textarea className="min-h-[100px] rounded-xl" value={draft.shiftHandover || ''} disabled={!editable} onChange={(e) => patchDraft({ shiftHandover: e.target.value })} placeholder="Pendientes, riesgos, instrucciones para el turno entrante…" />
      </Section>

      <Section title="Firmas y aprobación">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(['supervisor', 'operations'] as const).map((step) => {
            const sig = findSig(step);
            const label = step === 'supervisor' ? 'Supervisor responsable' : 'Jefe de operaciones';
            // El supervisor firma para cerrar el borrador (requiere poder editar
            // contenido); Jefe de Operaciones firma DESPUÉS, sobre el contenido
            // ya congelado, y necesita su propio permiso de revisión.
            const canSignThis = step === 'supervisor' ? editable : canSignOperations;
            return (
              <div key={step} className="rounded-[1.5rem] border p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                {sig ? (
                  <div className="space-y-1">
                    <div className="h-20 rounded-xl border bg-card flex items-center justify-center p-2">
                      <img src={sig.signature} alt="Firma" className="max-h-full object-contain" />
                    </div>
                    <p className="text-sm font-medium">{sig.userName}</p>
                    <p className="text-xs text-muted-foreground">{new Date(sig.date).toLocaleString('es-CL')}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {step === 'operations' && draft.status !== 'ready' ? 'Falta la firma del supervisor.' : 'Sin firmar.'}
                  </p>
                )}
                {canSignThis && (
                  <Button variant="outline" className="rounded-xl w-full" onClick={() => openSignatureDialog(step)}>
                    <PenLine className="h-4 w-4 mr-2" /> {sig ? 'Re-firmar' : 'Firmar'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {findSig('supervisor') && <p className="text-[10px] text-muted-foreground mt-3">Al firmar el supervisor, el reporte queda <b>Listo</b> y su contenido se bloquea (usa &ldquo;Reabrir borrador&rdquo; para corregirlo).</p>}
      </Section>

      <Dialog open={!!signatureOpen} onOpenChange={(o) => { if (!o) setSignatureOpen(null); }}>
        <DialogContent className="rounded-[1.5rem]">
          <DialogHeader><DialogTitle>Firma {signatureOpen === 'operations' ? 'Jefe de operaciones' : 'Supervisor'}</DialogTitle></DialogHeader>
          {useSavedSignature && savedSignature ? (
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
          <DialogFooter>
            <Button onClick={() => signStep(signatureOpen!)} disabled={!signatureData}>Firmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function CatalogSelect({ label, value, options, onChange, disabled }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange} disabled={disabled || !(options || []).length}>
        <SelectTrigger className="rounded-xl"><SelectValue placeholder={(options || []).length ? 'Selecciona…' : 'Sin opciones (ver Catálogos)'} /></SelectTrigger>
        <SelectContent>
          {(options || []).map((o) => <SelectItem key={o.id} value={o.name}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}
