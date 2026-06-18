'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, PenLine, Save } from 'lucide-react';
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
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { supabase } from '@/modules/core/lib/supabase';
import { consolidateWeekly } from '@/modules/core/lib/work-order-consolidation';
import { WORK_REPORT_STATUS_LABEL } from '@/modules/core/lib/work-report-labels';
import type { WorkReportSignature, WorkWeeklyReport } from '@/modules/core/lib/data';

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateOnly(value: any): string {
  const s = typeof value === 'string' ? value : new Date(value).toISOString();
  return s.slice(0, 10);
}
function fmtDate(value: any) {
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
    users,
    updateWorkWeeklyReport,
    can,
    notify,
    isLoading,
  } = useAppState();

  const editable = can('work_reports:create');
  const wr = (workWeeklyReports || []).find((w) => w.id === params.id);

  const { user } = useAuth();
  const savedSignature = user?.signature || null;

  const draftInit = React.useRef(false);
  const [draft, setDraft] = React.useState<WorkWeeklyReport | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [signatureOpen, setSignatureOpen] = React.useState<null | 'supervisor' | 'operations'>(null);
  const [signatureData, setSignatureData] = React.useState('');
  const [useSavedSignature, setUseSavedSignature] = React.useState(true);

  const openSignatureDialog = (step: 'supervisor' | 'operations') => {
    setUseSavedSignature(!!savedSignature);
    setSignatureData(savedSignature || '');
    setSignatureOpen(step);
  };

  React.useEffect(() => {
    if (wr && !draftInit.current) {
      setDraft(JSON.parse(JSON.stringify(wr)));
      draftInit.current = true;
    }
  }, [wr]);

  // Diarios seleccionados + candidatos dentro del rango de fechas.
  const selectedIds = draft?.consolidatedReportIds || [];
  const selectedReports = React.useMemo(
    () => (workReports || []).filter((r) => selectedIds.includes(r.id)),
    [workReports, selectedIds],
  );
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

  const patchDraft = (patch: Partial<WorkWeeklyReport>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const toggleReport = (id: string) => {
    const ids = draft.consolidatedReportIds || [];
    patchDraft({ consolidatedReportIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
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
    const next: WorkWeeklyReport = { ...draft, signatures, status: step === 'supervisor' ? 'ready' : draft.status };
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
          {editable && <Button className="rounded-xl" onClick={save} disabled={saving}><Save className="h-4 w-4 mr-2" /> Guardar</Button>}
        </div>
      }
    >
      <Section title="Información general">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <TextField label="Título" value={draft.title} onChange={(v) => patchDraft({ title: v })} disabled={!editable} />
          <TextField label="Cliente" value={draft.client} onChange={(v) => patchDraft({ client: v })} disabled={!editable} />
          <TextField label="Faena" value={draft.faena} onChange={(v) => patchDraft({ faena: v })} disabled={!editable} />
          <TextField label="Obra" value={draft.obra || ''} onChange={(v) => patchDraft({ obra: v })} disabled={!editable} />
          <TextField label="N° Contrato" value={draft.contractNumber || ''} onChange={(v) => patchDraft({ contractNumber: v })} disabled={!editable} />
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
            <Select value={draft.status} onValueChange={(v) => patchDraft({ status: v as WorkWeeklyReport['status'] })} disabled={!editable}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Borrador</SelectItem>
                <SelectItem value="ready">Listo</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Reportes Diarios a consolidar">
        <p className="text-[10px] text-muted-foreground mb-3">Se muestran los diarios dentro del rango de fechas. Marca los que entran en esta semana.</p>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay Reportes Diarios en el rango seleccionado.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {candidates.map((r) => {
              const selected = selectedIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={!editable}
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
                <tr><th className="text-left p-2">Fecha</th><th className="text-left p-2">OT principal</th><th className="text-right p-2">OT</th><th className="text-right p-2">Personal</th><th className="text-right p-2">HH</th><th className="text-left p-2">Estado</th></tr>
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
                  <td className="p-2 text-right tabular-nums">{consolidation.workersMax}</td>
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
                  <p className="text-sm text-muted-foreground">Sin firmar.</p>
                )}
                {editable && (
                  <Button variant="outline" className="rounded-xl w-full" onClick={() => openSignatureDialog(step)}>
                    <PenLine className="h-4 w-4 mr-2" /> {sig ? 'Re-firmar' : 'Firmar'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {findSig('supervisor') && <p className="text-[10px] text-muted-foreground mt-3">Al firmar el supervisor, el reporte queda marcado como <b>Listo</b>.</p>}
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
