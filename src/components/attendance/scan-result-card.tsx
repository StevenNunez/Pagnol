"use client";

import React, { useEffect, useState } from "react";
import { LogIn, LogOut, Briefcase, RotateCcw, Moon, Sun, AlertTriangle, Clock } from "lucide-react";
import type { ScanResult } from "@/modules/core/lib/data";
import { cn } from "@/lib/utils";

interface ScanResultCardProps {
  result: ScanResult | null;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function ScanResultCard({ result, onDismiss, autoDismissMs = 4000 }: ScanResultCardProps) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (!result) return;
    setProgress(100);
    const interval = setInterval(() => {
      setProgress(p => Math.max(0, p - (100 / (autoDismissMs / 100))));
    }, 100);
    const timeout = setTimeout(onDismiss, autoDismissMs);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [result, autoDismissMs, onDismiss]);

  if (!result) return null;

  const isIn = result.logType === 'in';
  const initials = result.workerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onDismiss}>
      <div
        className={cn(
          "w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden",
          isIn ? "bg-gradient-to-br from-green-500 to-emerald-600" : "bg-gradient-to-br from-slate-600 to-slate-800"
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="h-1 bg-white/20">
          <div
            className="h-full bg-white/60 transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-7 flex flex-col items-center text-white text-center gap-5">
          {/* IN / OUT badge */}
          <div className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-black uppercase tracking-widest",
            isIn ? "bg-white/20" : "bg-white/20"
          )}>
            {isIn ? <LogIn size={16} /> : <LogOut size={16} />}
            {isIn ? "INGRESO" : "SALIDA"}
          </div>

          {/* Worker avatar */}
          <div className="w-20 h-20 rounded-2xl bg-white/20 text-white font-black text-2xl flex items-center justify-center">
            {initials}
          </div>

          {/* Worker name */}
          <div>
            <h2 className="text-2xl font-black tracking-tight">{result.workerName}</h2>
            {result.workerCargo && (
              <p className="text-sm text-white/70 uppercase tracking-widest font-bold mt-0.5">{result.workerCargo}</p>
            )}
          </div>

          {/* Time */}
          <div className="flex items-center gap-2 text-3xl font-black tracking-tighter">
            <Clock size={20} className="opacity-70" />
            {result.logTime}
          </div>

          {/* Contract + shift info */}
          {(result.contractName || result.shiftName) && (
            <div className="w-full bg-white/10 rounded-2xl p-4 space-y-2 text-left">
              {result.contractName && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Briefcase size={14} className="opacity-70 shrink-0" />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Contrato</p>
                    <p className="font-bold">{result.contractName}</p>
                  </div>
                </div>
              )}
              {result.shiftName && (
                <div className="flex items-center gap-2.5 text-sm">
                  <div className="shrink-0 opacity-70">
                    {result.isNightShift ? <Moon size={14} /> : <Sun size={14} />}
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Turno</p>
                    <div className="flex items-center gap-2">
                      <p className="font-bold">{result.shiftName}</p>
                      {result.shiftType && (
                        <span className="text-[9px] font-black bg-white/20 px-1.5 py-0.5 rounded-md uppercase">
                          {result.shiftType}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rest day warning */}
          {result.isRestDay && (
            <div className="w-full flex items-center gap-3 bg-amber-500/30 border border-amber-400/40 rounded-2xl p-3 text-left">
              <AlertTriangle size={18} className="text-amber-300 shrink-0" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">Día de Descanso</p>
                <p className="text-xs text-white/80 mt-0.5">
                  Este trabajador está fuera de su ciclo de turno. El registro fue guardado como horas especiales.
                </p>
              </div>
            </div>
          )}

          {/* No contract assigned */}
          {!result.contractName && !result.shiftName && (
            <p className="text-sm text-white/50 italic">Sin contrato ni turno asignado</p>
          )}
        </div>
      </div>
    </div>
  );
}
