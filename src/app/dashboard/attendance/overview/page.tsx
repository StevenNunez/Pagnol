"use client";

import React, { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Badge } from "@/components/ui/badge";
import { isRestDay } from "@/modules/core/hooks/use-attendance";
import {
  Users, UserCheck, UserX, Bed, Building2, MapPin, ChevronRight, AlertTriangle,
} from "lucide-react";
import type { Contract, User, AttendanceLog } from "@/modules/core/lib/data";
import { useRouter } from "next/navigation";

type ContractFilter = 'all' | 'own' | 'subcontractor';

interface ContractStats {
  contract: Contract;
  total: number;
  present: number;
  absent: number;
  restDay: number;
  onLM: number;
  subContracts: Contract[];
}

const today = new Date();
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

export default function AttendanceOverviewPage() {
  const { contracts, contractWorkers, users, attendanceLogs, shiftSchedules } = useAppState();
  const router = useRouter();
  const [filter, setFilter] = useState<ContractFilter>('all');

  const activeContracts = useMemo(
    () => contracts.filter((c: Contract) => c.status === 'active'),
    [contracts]
  );

  const contractStats = useMemo((): ContractStats[] => {
    const todayLogs = (attendanceLogs || []).filter((l: AttendanceLog) => l.date === todayStr);

    return activeContracts.map((contract: Contract) => {
      const cwList = contractWorkers.filter(
        cw => cw.contractId === contract.id && !cw.endDate
      );
      const workerIds = new Set(cwList.map(cw => cw.userId));
      const contractUsers = (users || []).filter((u: User) => workerIds.has(u.id));

      let present = 0, absent = 0, restDay = 0, onLM = 0;

      contractUsers.forEach((u: User) => {
        const cw = cwList.find(w => w.userId === u.id);
        const shift = cw?.shiftScheduleId
          ? shiftSchedules.find(s => s.id === cw.shiftScheduleId)
          : null;

        if (shift && isRestDay(today, shift)) { restDay++; return; }

        // Check LM mark
        const todayUserLogs = todayLogs.filter((l: AttendanceLog) => l.userId === u.id);
        const hasLM = todayUserLogs.some((l: AttendanceLog) => l.markType === 'LM');
        if (hasLM) { onLM++; return; }

        const hasEntry = todayUserLogs.some((l: AttendanceLog) => l.type === 'in');
        if (hasEntry) present++; else absent++;
      });

      // Sub-contratos relacionados
      const subContracts = activeContracts.filter(
        (c: Contract) => c.parentContractId === contract.id
      );

      return { contract, total: contractUsers.length, present, absent, restDay, onLM, subContracts };
    });
  }, [activeContracts, contractWorkers, users, attendanceLogs, shiftSchedules]);

  const globalStats = useMemo(() => {
    const seen = new Set<string>();
    let total = 0, present = 0, absent = 0, restDay = 0, onLM = 0;
    contractStats.forEach(s => {
      const cw = contractWorkers.filter(c => c.contractId === s.contract.id && !c.endDate);
      cw.forEach(w => {
        if (seen.has(w.userId)) return;
        seen.add(w.userId);
        total++;
      });
      present += s.present;
      absent += s.absent;
      restDay += s.restDay;
      onLM += s.onLM;
    });
    return { total, present, absent, restDay, onLM };
  }, [contractStats, contractWorkers]);

  const displayed = useMemo(() => {
    if (filter === 'own') return contractStats.filter(s => !s.contract.isSubcontractor && !s.contract.parentContractId);
    if (filter === 'subcontractor') return contractStats.filter(s => s.contract.isSubcontractor || !!s.contract.parentContractId);
    return contractStats;
  }, [contractStats, filter]);

  const filterBtns: { value: ContractFilter; label: string }[] = [
    { value: 'all',           label: `Todos (${contractStats.length})` },
    { value: 'own',           label: 'Contratos Propios' },
    { value: 'subcontractor', label: 'Subcontratos' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vista General — Todos los Contratos"
        description={today.toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      />

      {/* KPIs globales */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Dotación Total',   value: globalStats.total,   icon: Users,      color: 'text-slate-700', bg: 'bg-slate-100' },
          { label: 'Presentes',        value: globalStats.present,  icon: UserCheck,  color: 'text-green-700', bg: 'bg-green-50' },
          { label: 'Ausentes',         value: globalStats.absent,   icon: UserX,      color: 'text-red-600',   bg: 'bg-red-50' },
          { label: 'En Descanso',      value: globalStats.restDay,  icon: Bed,        color: 'text-indigo-600',bg: 'bg-indigo-50' },
          { label: 'Lic. Médica',      value: globalStats.onLM,     icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`${bg} rounded-2xl p-4 flex items-center gap-3`}>
            <Icon size={20} className={`${color} shrink-0`} />
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className={`text-2xl font-black tracking-tighter ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Barra de cobertura global */}
      {globalStats.total > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-2">
          <div className="flex justify-between items-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cobertura Global Hoy</p>
            <p className="text-[10px] font-black text-muted-foreground">
              {Math.round(((globalStats.present) / Math.max(globalStats.total - globalStats.restDay, 1)) * 100)}% de dotación activa
            </p>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
            <div className="bg-green-500 h-full transition-all duration-700" style={{ width: `${(globalStats.present / globalStats.total) * 100}%` }} />
            <div className="bg-amber-400 h-full transition-all duration-700" style={{ width: `${(globalStats.onLM / globalStats.total) * 100}%` }} />
            <div className="bg-indigo-200 h-full transition-all duration-700" style={{ width: `${(globalStats.restDay / globalStats.total) * 100}%` }} />
            <div className="bg-red-200 h-full transition-all duration-700" style={{ width: `${(globalStats.absent / globalStats.total) * 100}%` }} />
          </div>
          <div className="flex gap-4 text-[9px] font-black uppercase tracking-widest flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Presentes</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Lic. Médica</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-200 inline-block" />Descanso</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-200 inline-block" />Ausentes</span>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {filterBtns.map(btn => (
          <button
            key={btn.value}
            onClick={() => setFilter(btn.value)}
            className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border ${
              filter === btn.value
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-transparent text-muted-foreground border-border hover:border-slate-400'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Grid de contratos */}
      {displayed.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted-foreground text-sm">
          No hay contratos activos que mostrar.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayed.map(({ contract, total, present, absent, restDay, onLM, subContracts }) => {
            const coverage = total > 0 ? Math.round((present / Math.max(total - restDay, 1)) * 100) : 0;
            return (
              <div
                key={contract.id}
                className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4 hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer group"
                onClick={() => router.push(`/dashboard/attendance?contract=${contract.id}`)}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-black text-sm truncate">{contract.name}</p>
                      {contract.isSubcontractor && (
                        <Badge variant="outline" className="text-[8px] font-black h-4 px-1.5 border-amber-400 text-amber-600">
                          Subcontrato
                        </Badge>
                      )}
                      {subContracts.length > 0 && (
                        <Badge variant="outline" className="text-[8px] font-black h-4 px-1.5">
                          {subContracts.length} sub
                        </Badge>
                      )}
                    </div>
                    {contract.clientName && (
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                        <Building2 size={9} />
                        {contract.clientName}
                      </p>
                    )}
                    {contract.location && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin size={9} />
                        {contract.location}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Total',     value: total,   color: 'text-slate-700', dot: 'bg-slate-400' },
                    { label: 'Presentes', value: present,  color: 'text-green-700', dot: 'bg-green-500' },
                    { label: 'Ausentes',  value: absent,   color: 'text-red-600',   dot: 'bg-red-400' },
                    { label: 'Descanso',  value: restDay,  color: 'text-indigo-600',dot: 'bg-indigo-300' },
                  ].map(({ label, value, color, dot }) => (
                    <div key={label} className="text-center">
                      <p className={`text-xl font-black ${color}`}>{value}</p>
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground flex items-center justify-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${dot} inline-block`} />
                        {label}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Coverage bar */}
                {total > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Cobertura</p>
                      <p className="text-[9px] font-black text-muted-foreground">{coverage}%</p>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
                      <div className="bg-green-500 h-full transition-all duration-700" style={{ width: `${(present / total) * 100}%` }} />
                      {onLM > 0 && <div className="bg-amber-400 h-full transition-all duration-700" style={{ width: `${(onLM / total) * 100}%` }} />}
                      <div className="bg-indigo-200 h-full transition-all duration-700" style={{ width: `${(restDay / total) * 100}%` }} />
                    </div>
                  </div>
                )}

                {/* Sub-contratos */}
                {subContracts.length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">Subcontratistas</p>
                    <div className="flex flex-col gap-1">
                      {subContracts.map((sc: Contract) => {
                        const scStats = contractStats.find(s => s.contract.id === sc.id);
                        return (
                          <div
                            key={sc.id}
                            className="flex items-center justify-between px-2 py-1.5 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                            onClick={e => { e.stopPropagation(); router.push(`/dashboard/attendance?contract=${sc.id}`); }}
                          >
                            <div>
                              <p className="text-[10px] font-bold truncate">{sc.subcontractorCompany || sc.name}</p>
                              {sc.subcontractorRut && (
                                <p className="text-[9px] text-muted-foreground">RUT: {sc.subcontractorRut}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-[9px] font-black text-green-600">{scStats?.present ?? 0} P</span>
                              <span className="text-[9px] font-black text-red-500">{scStats?.absent ?? 0} A</span>
                              <span className="text-[9px] font-black text-slate-500">{scStats?.total ?? 0} T</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
