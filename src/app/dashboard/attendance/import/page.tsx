"use client";

import React, { useState, useCallback, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/modules/core/hooks/use-toast";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { supabase } from "@/modules/core/lib/supabase";
import {
  Upload, FileSpreadsheet, CheckCircle2, Loader2, AlertTriangle,
  ChevronDown, ChevronRight, Users,
} from "lucide-react";
import type { ParsedSheet, ParsedWorkerRow } from "@/app/api/attendance/parse-excel/route";
import { ATTENDANCE_MARK_LABELS } from "@/modules/core/lib/data";
import type { AttendanceMark } from "@/modules/core/lib/data";

const MARK_COLORS: Record<string, string> = {
  P:   'bg-green-100 text-green-700',
  A:   'bg-red-100 text-red-600',
  D:   'bg-indigo-50 text-indigo-500',
  LM:  'bg-amber-100 text-amber-700',
  PSG: 'bg-orange-100 text-orange-600',
  V:   'bg-blue-100 text-blue-600',
  PP:  'bg-purple-100 text-purple-600',
  MJ:  'bg-teal-100 text-teal-600',
  ATR: 'bg-yellow-100 text-yellow-700',
};

const MONTH_MAP: Record<string, number> = {
  ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,
  JULIO:7,AGOSTO:8,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12,
};

function dayToDate(year: number, month: string, day: number): string {
  const m = MONTH_MAP[month] ?? 1;
  return `${year}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

export default function AttendanceImportPage() {
  const { users, contracts, contractWorkers } = useAppState();
  const { user } = useAuth();
  const { toast } = useToast();

  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleExpanded = (key: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const processFile = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      toast({ variant: 'destructive', title: 'Formato inválido', description: 'Solo se aceptan archivos .xlsx o .xls' });
      return;
    }
    setLoading(true);
    setSheets(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/attendance/parse-excel', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al procesar');
      setSheets(data.sheets);
      if (data.sheets.length === 0) {
        toast({ title: 'Sin datos', description: 'No se encontraron trabajadores en el archivo.' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleConfirmImport = async () => {
    if (!sheets || !user) return;
    setSaving(true);

    // Build a name → userId map for matching
    const nameToId = new Map<string, string>();
    (users || []).forEach(u => nameToId.set(u.name.toUpperCase().trim(), u.id));

    const logsToInsert: any[] = [];
    let matched = 0, unmatched = 0;

    sheets.forEach(sheet => {
      sheet.workers.forEach((worker: ParsedWorkerRow) => {
        const userId = nameToId.get(worker.name.toUpperCase().trim());
        if (!userId) { unmatched++; return; }
        matched++;

        Object.entries(worker.marks).forEach(([dayStr, mark]) => {
          const day = parseInt(dayStr);
          const dateStr = dayToDate(sheet.year, sheet.month, day);

          logsToInsert.push({
            user_id:        userId,
            user_name:      worker.name,
            timestamp:      `${dateStr}T08:00:00`,
            type:           mark === 'P' || mark === 'ATR' || mark === 'MJ' ? 'in' : 'in',
            method:         'import',
            mark_type:      mark,
            registrar_id:   user.id,
            registrar_name: user.name,
            date:           dateStr,
            tenant_id:      user.tenantId,
            contract_id:    selectedContractId || null,
          });
        });
      });
    });

    if (logsToInsert.length === 0) {
      toast({ title: 'Sin coincidencias', description: `${unmatched} trabajadores no encontrados en el sistema.` });
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('attendance_logs').insert(logsToInsert);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: error.message });
    } else {
      toast({
        title: 'Importación exitosa',
        description: `${logsToInsert.length} registros importados. ${matched} trabajadores coincidieron, ${unmatched} no encontrados.`,
      });
      setSheets(null);
    }
    setSaving(false);
  };

  const totalWorkers = sheets?.reduce((a, s) => a + s.workers.length, 0) ?? 0;
  const totalMarks = sheets?.reduce((a, s) =>
    a + s.workers.reduce((b, w) => b + Object.keys(w.marks).length, 0), 0) ?? 0;

  const activeContracts = (contracts || []).filter(c => c.status === 'active');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Importar Planilla de Asistencia"
        description="Sube la planilla Excel en formato minería (TURNO A / TURNO B) para importar registros masivamente."
      />

      {/* Upload zone */}
      {!sheets && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 transition-all cursor-pointer ${
            dragging ? 'border-orange-400 bg-orange-50' : 'border-border hover:border-slate-400 hover:bg-slate-50/50'
          }`}
          onClick={() => fileRef.current?.click()}
        >
          {loading ? (
            <Loader2 size={40} className="animate-spin text-muted-foreground" />
          ) : (
            <FileSpreadsheet size={40} className="text-muted-foreground" />
          )}
          <div className="text-center">
            <p className="font-black text-sm">{loading ? 'Procesando planilla...' : 'Arrastra el archivo aquí'}</p>
            <p className="text-muted-foreground text-xs mt-1">o haz clic para seleccionar — .xlsx, .xls</p>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      )}

      {/* Preview */}
      {sheets && sheets.length > 0 && (
        <div className="flex flex-col gap-4">
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Hojas detectadas', value: sheets.length,    icon: FileSpreadsheet },
              { label: 'Trabajadores',     value: totalWorkers,     icon: Users },
              { label: 'Registros totales',value: totalMarks,       icon: CheckCircle2 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-slate-100 rounded-2xl p-4 flex items-center gap-3">
                <Icon size={18} className="text-slate-600 shrink-0" />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                  <p className="text-2xl font-black text-slate-700">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Contract selector */}
          <div className="bg-card border border-border rounded-2xl p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Asignar a contrato (opcional)</p>
            <select
              value={selectedContractId}
              onChange={e => setSelectedContractId(e.target.value)}
              className="flex-1 h-9 text-sm rounded-xl border border-border bg-background px-3 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Sin contrato asignado</option>
              {activeContracts.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Sheets preview */}
          {sheets.map(sheet => (
            <div key={sheet.sheetName} className="bg-card border border-border rounded-2xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50/50 transition-colors"
                onClick={() => toggleExpanded(sheet.sheetName)}
              >
                <div className="flex items-center gap-3">
                  {expanded.has(sheet.sheetName) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div className="text-left">
                    <p className="font-black text-sm">{sheet.sheetName}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                      {sheet.month} {sheet.year} — {sheet.workers.length} trabajadores
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[9px] font-black">
                  {sheet.workers.reduce((a, w) => a + Object.keys(w.marks).length, 0)} registros
                </Badge>
              </button>

              {expanded.has(sheet.sheetName) && (
                <div className="border-t border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-black text-[9px] uppercase tracking-widest text-muted-foreground">Nombre</th>
                        <th className="px-4 py-2 text-left font-black text-[9px] uppercase tracking-widest text-muted-foreground">Cargo</th>
                        <th className="px-4 py-2 text-left font-black text-[9px] uppercase tracking-widest text-muted-foreground">Turno</th>
                        <th className="px-4 py-2 text-left font-black text-[9px] uppercase tracking-widest text-muted-foreground">Marcas detectadas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sheet.workers.map((w, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2 font-bold">{w.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{w.cargo || '—'}</td>
                          <td className="px-4 py-2 text-muted-foreground">{w.turnName}</td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(w.marks).slice(0, 10).map(([day, mark]) => (
                                <span
                                  key={day}
                                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-black ${MARK_COLORS[mark] ?? 'bg-slate-100 text-slate-600'}`}
                                  title={`Día ${day}: ${ATTENDANCE_MARK_LABELS[mark as AttendanceMark] ?? mark}`}
                                >
                                  {day}/{mark}
                                </span>
                              ))}
                              {Object.keys(w.marks).length > 10 && (
                                <span className="text-[9px] text-muted-foreground">+{Object.keys(w.marks).length - 10} más</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {/* Warning */}
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Antes de importar</p>
              <p className="text-xs text-amber-600 mt-1">
                El sistema buscará coincidencias por nombre exacto. Los trabajadores que no estén registrados en Pagnol serán ignorados.
                Los registros existentes del mismo período NO serán eliminados — se agregarán como marcas adicionales.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => { setSheets(null); setSelectedContractId(''); }}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={saving}
              className="bg-pagnol-orange hover:bg-orange-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl"
            >
              {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Upload size={14} className="mr-2" />}
              Confirmar Importación
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
