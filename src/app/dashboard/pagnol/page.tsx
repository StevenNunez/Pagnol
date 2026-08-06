'use client';
import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import {
  PlusCircle,
  ShieldAlert,
  TrendingUp,
  Box,
  ArrowRight,
  Target,
  Lock,
  ArrowUpRight,
  ArrowDownRight,
  Wrench,
  Image as ImageIcon,
  Loader2,
  ShoppingCart,
  X,
} from 'lucide-react';
import { LoadingState } from '@/components/loading-state';
import type { MaterialRequest } from '@/modules/core/lib/data';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useReportData } from '@/components/pagnol-reports/use-report-data';
import { STAGE_META, criticalThreshold, formatCompactCLP, isReturnable } from '@/components/pagnol-reports/report-utils';

export default function PagnolMainPage() {
  const { requests, updateMaterialRequestStatus, notify } = useAppState();
  const { user: currentUser, can } = useAuth();
  const router = useRouter();

  // Fuente única de datos (la misma de Reportes y Activos): transacciones con
  // custodio real, posesión vía computeToolHolderMap, stock crítico por minStock.
  const data = useReportData();
  const { activeMaterials, materialsMap, transactions, holderMap, criticalStock, totalValue, operabilityPct, maintenance } = data;

  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const formatRelativeTime = (timestamp: Date) => {
    const diffInSeconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
    if (diffInSeconds < 60) return 'Hace unos segundos';
    const mins = Math.floor(diffInSeconds / 60);
    if (mins < 60) return `Hace ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Ayer';
    return `Hace ${days} días`;
  };

  // Inbox de aprobación: solicitudes pendientes que ESTE usuario puede resolver,
  // directamente desde la colección (con cantidades, notas y contrato).
  const actionableRequests = useMemo(() => {
    if (!currentUser) return [];
    return ((requests || []) as MaterialRequest[]).filter(r => {
      if (r.status !== 'pending') return false;
      // Gate ADC: solo las ya autorizadas por el Administrador de Contrato
      // llegan al pañol para aprobación (mismo criterio que la bandeja).
      if (!r.adcAuthorizedAt) return false;
      const cls = r.highestClass || 'C';
      if (cls === 'A') return can('material_requests:approve_class_a');
      if (cls === 'B') return can('material_requests:approve_class_b');
      return can('material_requests:approve_class_c');
    }).sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());
  }, [requests, can, currentUser]);

  const stats = useMemo(() => {
    const available = activeMaterials.filter(a => (a.stock ?? 0) > 0).length;
    // En terreno REAL: SOLO retornables en poder de alguien (mismo criterio que
    // la pestaña Personal de Reportes) — los consumibles entregados no "vuelven".
    let inField = 0;
    holderMap.forEach((_h, materialId) => {
      if (isReturnable(materialsMap.get(materialId))) inField++;
    });
    const planned = activeMaterials.filter(m => m.requiresMaintenance === true && m.nextMaintenanceDate);
    const overdueCount = maintenance.overdue.length;
    const maintenanceCompliance = planned.length > 0
      ? Math.round(((planned.length - overdueCount) / planned.length) * 100)
      : 100;
    return { available, inField, maintenanceCompliance, overdueCount, alertCount: actionableRequests.length };
  }, [activeMaterials, holderMap, materialsMap, maintenance.overdue.length, actionableRequests.length]);

  const recentWithdrawals = useMemo(() => transactions.filter(t => t.type === 'WITHDRAWAL').slice(0, 4), [transactions]);
  const recentReturns = useMemo(() => transactions.filter(t => t.type === 'RETURN').slice(0, 4), [transactions]);

  // Actividad de los últimos 7 días en una sola pasada.
  const flowData = useMemo(() => {
    const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return { name: DAY_NAMES[day.getDay()], salidas: 0, entradas: 0 };
    });
    transactions.forEach(tx => {
      const idx = Math.floor((tx.timestamp.getTime() - start.getTime()) / 86400000);
      if (idx < 0 || idx > 6) return;
      if (tx.type === 'WITHDRAWAL') buckets[idx].salidas++;
      else buckets[idx].entradas++;
    });
    return buckets;
  }, [transactions]);

  // El Realtime actualiza la colección solo — sin refreshData() masivo.
  const handleResolve = async (requestId: string, status: 'approved' | 'rejected') => {
    if (processingIds.has(requestId)) return;
    setProcessingIds(prev => new Set(prev).add(requestId));
    try {
      await updateMaterialRequestStatus(requestId, status);
      notify(status === 'approved' ? 'Solicitud autorizada exitosamente.' : 'Solicitud rechazada.', 'success');
    } catch (e: any) {
      console.error(e);
      notify(e.message || 'Error al resolver la solicitud.', 'destructive');
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(requestId); return s; });
    }
  };

  const onNavigate = (path: string) => {
    router.push(`/dashboard/pagnol/${path}`);
  };

  const healthLabel = operabilityPct >= 80 ? 'Óptimo' : operabilityPct >= 50 ? 'Estable' : 'Crítico';

  if (!currentUser) {
    return <LoadingState fullHeight />;
  }

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-top-4 duration-1000 font-outfit">

      {/* COMMAND CENTER HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 px-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-2 h-2 rounded-full bg-pagnol-orange animate-pulse"></span>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">Pagnol ASSET MANAGEMENT</span>
            {maintenance.overdue.length > 0 && (
              <button
                onClick={() => onNavigate('reports')}
                className="text-[8px] font-black uppercase tracking-widest bg-destructive text-destructive-foreground px-2 py-0.5 rounded-lg animate-pulse"
              >
                {maintenance.overdue.length} Mantenimiento{maintenance.overdue.length > 1 ? 's' : ''} Vencido{maintenance.overdue.length > 1 ? 's' : ''}
              </button>
            )}
          </div>
          <h1 className="text-4xl font-black tracking-tighter text-foreground">Control de Activos</h1>
        </div>
        {can('material_requests:create') && (
          <button
            onClick={() => onNavigate('movimientos')}
            className="bg-foreground border-b-4 border-foreground/80 active:border-b-0 active:translate-y-1 hover:bg-foreground/90 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest text-background transition-all shadow-xl flex items-center gap-2 whitespace-nowrap w-fit"
          >
            <PlusCircle size={14} /> Nuevo Despacho
          </button>
        )}
      </div>

      {/* MONITOR ESTRATÉGICO */}
      <div className={`rounded-[2.5rem] p-8 sm:p-12 text-white relative overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] flex flex-col lg:flex-row items-center justify-between transition-all duration-700 ${stats.alertCount > 0 ? 'bg-pagnol-dark border border-red-900/30' : 'bg-pagnol-dark'}`}>
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-pagnol-orange to-transparent blur-[120px] rounded-full translate-x-1/4 -translate-y-1/4"></div>
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-blue-600 to-transparent blur-[100px] rounded-full -translate-x-1/4 translate-y-1/4"></div>
        </div>

        <div className="relative z-10 space-y-6 text-center lg:text-left flex-1">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border-t border-white/10 ${stats.alertCount > 0 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-white/60'}`}>
            <ShieldAlert size={14} className={stats.alertCount > 0 ? 'animate-pulse' : ''} />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">
              {stats.alertCount > 0 ? 'Aprobaciones Pendientes' : 'Sin aprobaciones pendientes'}
            </span>
          </div>

          <div className="space-y-2">
            <h2 className="text-4xl sm:text-6xl font-black tracking-tighter leading-tight font-outfit">
              {stats.alertCount > 0 ? (
                <span className="text-red-500">Autorización<br />Requerida</span>
              ) : (
                <span>Bienvenido,<br />{currentUser?.name?.split(' ')[0] || 'Usuario'}</span>
              )}
            </h2>
            <p className="text-white/40 text-sm sm:text-base max-w-xl font-medium leading-relaxed">
              {stats.alertCount > 0
                ? `Hay ${stats.alertCount} solicitud${stats.alertCount > 1 ? 'es' : ''} de despacho esperando tu aprobación según su clase de criticidad.`
                : `El inventario se encuentra balanceado. Hay ${stats.available} ítems con stock listos para despacho.`
              }
            </p>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-4 pt-4 justify-center lg:justify-start">
            {stats.alertCount > 0 && (
              <button
                onClick={() => document.getElementById('critical-alerts')?.scrollIntoView({ behavior: 'smooth' })}
                className="bg-red-600 hover:bg-red-700 px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-2xl shadow-red-900/20 flex items-center justify-center gap-2 group whitespace-nowrap"
              >
                Revisar Solicitudes <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </button>
            )}
            <button
              onClick={() => onNavigate('activos')}
              className="bg-white/5 border border-white/10 hover:bg-white/10 px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all backdrop-blur-md flex items-center justify-center gap-2 whitespace-nowrap"
            >
              Inventario Completo
            </button>
          </div>
        </div>

        <div className="hidden lg:flex flex-col items-center gap-6 relative z-10 bg-black/40 p-10 rounded-[3rem] border border-white/10 backdrop-blur-3xl ml-12">
          <div className="relative group">
            <svg className="w-40 h-40 transform -rotate-90">
              <circle cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-white/5" />
              <circle
                cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="12" fill="transparent"
                strokeDasharray={452.3}
                strokeDashoffset={452.3 - (452.3 * operabilityPct) / 100}
                className={`${operabilityPct < 50 ? 'text-red-500' : 'text-pagnol-orange'} transition-all duration-1000 ease-out`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-4xl font-black font-outfit">{operabilityPct}%</span>
              <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] mt-1">{healthLabel}</span>
            </div>
          </div>
          <p className="text-[8px] font-black text-white/30 uppercase tracking-[0.2em]">Activos disponibles</p>
        </div>
      </div>

      {/* KPI DASHBOARD */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        {[
          { label: 'Ítems con Stock', value: stats.available, trend: `de ${activeMaterials.length} activos`, icon: Box, iconCls: 'bg-info-subtle text-info' },
          { label: 'En Terreno', value: stats.inField, trend: 'Retornables prestados', icon: TrendingUp, iconCls: 'bg-orange-500/10 text-orange-500' },
          {
            label: 'Cumplimiento Mantenimiento',
            value: `${stats.maintenanceCompliance}%`,
            trend: stats.overdueCount > 0 ? `${stats.overdueCount} vencido${stats.overdueCount > 1 ? 's' : ''}` : 'Al día',
            icon: Wrench,
            iconCls: stats.maintenanceCompliance < 80 ? 'bg-destructive/10 text-destructive' : stats.maintenanceCompliance < 95 ? 'bg-warning-subtle text-warning' : 'bg-success-subtle text-success',
          },
          { label: 'Valorización Inventario', value: formatCompactCLP(totalValue), trend: 'Costo × stock', icon: Target, iconCls: 'bg-success-subtle text-success' },
        ].map((m, i) => (
          <Card key={i} className="p-8 rounded-[2rem] border-none shadow-sm hover:shadow-2xl transition-all duration-500 group relative overflow-hidden bg-card">
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:scale-110 transition-transform duration-700">
              <m.icon size={120} />
            </div>
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center justify-between mb-10">
                <div className={`p-4 rounded-2xl ${m.iconCls} shadow-sm`}>
                  <m.icon size={20} />
                </div>
                <Badge variant="outline" className={`border-none ${m.iconCls} text-[8px] font-black px-2 py-1`}>{m.trend}</Badge>
              </div>
              <div>
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{m.label}</p>
                <p className="text-4xl font-black text-foreground mt-1 font-outfit">{m.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* STOCK CRÍTICO — umbral real por material (minStock) */}
      {criticalStock.length > 0 && (
        <div className="bg-card p-10 rounded-[3rem] shadow-sm border border-border">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-destructive/10 text-destructive rounded-2xl shadow-sm">
                <ShieldAlert size={20} />
              </div>
              <div>
                <h3 className="text-xl font-black text-foreground uppercase tracking-tighter">Stock Crítico</h3>
                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mt-1">Bajo su umbral mínimo (minStock)</p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('reports')}
              className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
            >
              Ver Reporte <ArrowRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {criticalStock.slice(0, 5).map((m) => {
              const threshold = criticalThreshold(m);
              return (
                <div key={m.id} className="p-5 bg-muted/30 rounded-[1.5rem] border border-transparent hover:border-border hover:bg-card hover:shadow-lg transition-all duration-300 space-y-3 flex flex-col">
                  <div className="space-y-1">
                    <p className="text-xs font-black text-foreground uppercase tracking-tight leading-tight truncate" title={m.name}>{m.name}</p>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase truncate">{m.category}</p>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <span className={`text-2xl font-black font-outfit ${(m.stock ?? 0) === 0 ? 'text-destructive' : 'text-warning'}`}>{m.stock ?? 0}</span>
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">de {threshold} mín.</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${(m.stock ?? 0) === 0 ? 'bg-destructive' : 'bg-warning'}`}
                      style={{ width: `${Math.min(((m.stock ?? 0) / Math.max(threshold, 1)) * 100, 100)}%` }}
                    />
                  </div>
                  <button
                    onClick={() => router.push(`/dashboard/purchasing/purchase-request-form?materialId=${m.id}`)}
                    className="mt-auto pt-1 text-[9px] font-black uppercase tracking-widest text-destructive hover:text-destructive/80 transition-colors flex items-center gap-1.5"
                  >
                    <ShoppingCart size={11} /> Reponer
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* APROBACIONES PENDIENTES */}
      {stats.alertCount > 0 && (
        <div id="critical-alerts" className="p-8 sm:p-12 rounded-[3.5rem] bg-card border-2 border-red-500/20 dark:border-red-900/30 shadow-[0_40px_80px_-20px_rgba(239,68,68,0.08)] scroll-mt-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-12">
            <div className="space-y-1">
              <h3 className="text-2xl font-black tracking-tighter flex items-center gap-3 text-foreground leading-none">
                <div className="p-2 bg-destructive text-destructive-foreground rounded-xl shadow-lg shadow-red-500/20">
                  <ShieldAlert size={24} />
                </div>
                Autorizaciones Pendientes
              </h3>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-12">Solicitudes que requieren tu aprobación según su clase</p>
            </div>
            <Badge className="bg-destructive text-destructive-foreground text-[10px] font-black px-6 py-3 rounded-2xl animate-pulse uppercase tracking-widest shadow-xl shadow-red-500/30">Acción Requerida</Badge>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {actionableRequests.map((req) => {
              const cls = req.highestClass || 'C';
              const isProcessing = processingIds.has(req.id);
              return (
                <div key={req.id} className="bg-muted/30 border border-border rounded-[3rem] shadow-sm flex flex-col group hover:bg-card hover:shadow-2xl transition-all duration-500 overflow-hidden border-b-8 border-b-destructive">
                  <div className="p-8 border-b border-dashed border-border flex items-center justify-between bg-card gap-3">
                    <div className="flex items-center gap-5 min-w-0">
                      <div className={`p-4 rounded-2xl shadow-xl transition-all group-hover:rotate-6 shrink-0 ${cls === 'A' ? 'bg-pagnol-dark text-red-500' : cls === 'B' ? 'bg-pagnol-dark text-blue-500' : 'bg-pagnol-dark text-white/70'}`}>
                        <Lock size={20} />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <p className={`text-[10px] font-black uppercase tracking-widest ${cls === 'A' ? 'text-destructive' : cls === 'B' ? 'text-info' : 'text-muted-foreground'}`}>
                          DESPACHO CLASE {cls}
                        </p>
                        <p className="text-sm font-black text-foreground uppercase truncate">{req.userName || 'Solicitante'}</p>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tighter truncate">{req.internalCode || `REF: ${req.id.slice(0, 8).toUpperCase()}`}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">{formatRelativeTime(new Date(req.createdAt as any))}</p>
                      <div className="mt-2 space-y-1">
                        <Badge variant="secondary" className="text-[8px] font-black uppercase tracking-widest">{req.area}</Badge>
                        {req.contractName && (
                          <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{req.contractName}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-10 flex-1 space-y-6">
                    <div className="space-y-4">
                      {(req.items || []).map(item => {
                        const asset = materialsMap.get(item.materialId);
                        return (
                          <div key={item.materialId} className="flex items-center gap-5 p-5 bg-background rounded-[2rem] border border-border hover:border-pagnol-orange transition-all duration-300">
                            <div className="w-16 h-16 rounded-2xl overflow-hidden border border-border bg-muted shrink-0">
                              {asset?.photos && asset.photos.length > 0 ? (
                                <Image src={asset.photos[0]} width={80} height={80} className="w-full h-full object-cover" alt={asset.name} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center opacity-20"><ImageIcon size={24} /></div>
                              )}
                            </div>
                            <div className="flex-1 space-y-1 min-w-0">
                              <p className="text-sm font-black text-foreground uppercase leading-none truncate">{asset?.name || 'Activo desconocido'}</p>
                              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">SN: {asset?.serialNumber || 'N/A'}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xl font-black font-outfit text-pagnol-orange leading-none">{item.quantity}</p>
                              <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest mt-1">{asset?.unit || 'unid.'}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {req.notes && (
                      <div className="p-5 bg-muted rounded-2xl border border-dashed">
                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Justificación</p>
                        <p className="text-xs font-medium text-foreground leading-relaxed">{req.notes}</p>
                      </div>
                    )}
                  </div>

                  <div className="p-10 pt-0 mt-auto flex gap-4">
                    <button
                      onClick={() => handleResolve(req.id, 'rejected')}
                      disabled={isProcessing}
                      className="px-8 py-6 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 flex items-center justify-center gap-2 border border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                    >
                      <X size={16} /> Rechazar
                    </button>
                    <button
                      onClick={() => handleResolve(req.id, 'approved')}
                      disabled={isProcessing}
                      className={`flex-1 py-6 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-3 border-b-4 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 ${cls === 'A' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 border-red-800 shadow-red-500/20' : 'bg-info text-info-foreground hover:bg-info/90 border-blue-800 shadow-blue-500/20'}`}
                    >
                      {isProcessing
                        ? <><Loader2 size={18} className="animate-spin" /> Procesando...</>
                        : <>Autorizar Despacho <ArrowRight size={18} /></>
                      }
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ACTIVIDAD RECIENTE */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {[
          { title: 'Salidas', iconCls: 'bg-orange-500/10 text-orange-500', numCls: 'text-orange-500', icon: ArrowUpRight, data: recentWithdrawals },
          { title: 'Retornos', iconCls: 'bg-success-subtle text-success', numCls: 'text-success', icon: ArrowDownRight, data: recentReturns },
        ].map((col, idx) => (
          <div key={idx} className="bg-card p-10 rounded-[3rem] shadow-sm border border-border flex flex-col group">
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-4">
                <div className={`p-4 ${col.iconCls} rounded-2xl group-hover:rotate-12 transition-transform duration-500 shadow-sm`}>
                  <col.icon size={20} />
                </div>
                <h3 className="text-xl font-black text-foreground uppercase tracking-tighter">{col.title}</h3>
              </div>
            </div>
            <div className="space-y-4 flex-1">
              {col.data.length > 0 ? col.data.map((tx) => {
                const stage = STAGE_META[tx.stage];
                const primaryAsset = tx.assetIds.length === 1
                  ? (materialsMap.get(tx.assetIds[0])?.name || 'Activo desconocido')
                  : `${tx.assetIds.length} activos`;
                return (
                  <div key={tx.id} className="flex items-start justify-between p-6 bg-muted/30 rounded-[2rem] border border-transparent hover:border-border hover:bg-card hover:shadow-xl transition-all duration-300 gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className={`w-10 h-10 bg-card rounded-xl flex items-center justify-center shadow-sm border border-border shrink-0 ${col.numCls}`}>
                        <col.icon size={16} />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <p className="text-xs font-black text-foreground uppercase tracking-tight leading-none truncate" title={primaryAsset}>
                          {primaryAsset}
                        </p>
                        <p className="text-[9px] text-muted-foreground font-bold uppercase truncate">{tx.holderName}</p>
                        {tx.site && (
                          <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider truncate">{tx.site}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-[8px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                        {formatRelativeTime(tx.timestamp)}
                      </span>
                      <Badge className={`border-none text-[8px] font-black uppercase tracking-widest ${stage.cls}`}>
                        {stage.label}
                      </Badge>
                    </div>
                  </div>
                );
              }) : (
                <div className="py-20 text-center space-y-4 opacity-20">
                  <Box size={40} className="mx-auto" />
                  <p className="text-[10px] font-black uppercase tracking-[0.3em]">Sin actividad reciente</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ANALÍTICA */}
      <div className="bg-card p-10 rounded-[3rem] shadow-sm border border-border flex flex-col group">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h3 className="text-xl font-black text-foreground uppercase tracking-tighter">Tránsito Operativo</h3>
            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mt-1">Últimos 7 días</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-pagnol-orange"></span>
              <span className="text-[8px] font-black text-muted-foreground uppercase">Salidas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/30"></span>
              <span className="text-[8px] font-black text-muted-foreground uppercase">Entradas</span>
            </div>
          </div>
        </div>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={flowData}>
              <defs>
                <linearGradient id="colorSalida" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.15)" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'rgb(100,116,139)', fontSize: 10, fontWeight: 900 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'rgb(100,116,139)', fontSize: 10 }} allowDecimals={false} />
              <RechartsTooltip
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)', background: 'var(--card)' }}
                labelStyle={{ color: 'var(--foreground)', fontWeight: 900, fontSize: 10, textTransform: 'uppercase' }}
              />
              <Area type="monotone" dataKey="salidas" stroke="#f97316" strokeWidth={4} fillOpacity={1} fill="url(#colorSalida)" isAnimationActive={false} />
              <Area type="monotone" dataKey="entradas" stroke="rgb(148,163,184)" strokeWidth={2} fill="transparent" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
