'use client';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
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
  Zap
} from 'lucide-react';
import { askPagnol } from '@/actions/ask-ferro';
import type {
  Material,
  MaterialRequest,
  ReturnRequest,
  User,
  Tool
} from '@/modules/core/lib/data';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type DisplayTransaction = {
  id: string;
  assetIds: string[];
  type: 'WITHDRAWAL' | 'RETURN';
  site: string;
  employeeId: string;
  timestamp: string;
  description: string;
  status: string;
  needsApproval?: boolean;
  isApproved?: boolean;
  maxClass?: 'A' | 'B' | 'C';
  employeeName?: string;
};

export default function PagnolMainPage() {
  const {
    materials,
    tools,
    requests,
    returnRequests,
    users,
    updateMaterialRequestStatus,
    notify,
    refreshData,
  } = useAppState();
  const { user: currentUser, can } = useAuth();
  const router = useRouter();

  const [insight, setInsight] = useState<string>("Analizando inventario en tiempo real...");
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());

  // Compact AI context (~100 tokens)
  const fullContextString = useMemo(() => {
    const mats = materials || [];
    const tls = tools || [];
    const classA = mats.filter(m => m.class === 'A');
    const critical = mats.filter(m => m.stock <= 10 && m.stock > 0 && !m.archived);
    const outOfStock = mats.filter(m => m.stock === 0 && !m.archived);
    const pending = (requests || []).filter((r: any) => r.status === 'pending');
    return [
      `Inventario: ${mats.length} materiales, ${tls.length} herramientas.`,
      `Clase A: ${classA.length} activos críticos.`,
      `Stock crítico (≤10): ${critical.length > 0 ? critical.map(m => `${m.name} (${m.stock})`).join(', ') : 'ninguno'}.`,
      `Sin stock: ${outOfStock.length > 0 ? outOfStock.map(m => m.name).join(', ') : 'ninguno'}.`,
      `Solicitudes pendientes: ${pending.length}.`,
      `Fecha: ${new Date().toLocaleDateString('es-CL')}.`,
    ].join(' ');
  }, [materials, tools, requests]);

  useEffect(() => {
    refreshData();
  }, []);

  const hasFetchedInsight = React.useRef(false);

  const fetchInsight = useCallback(async (forced = false) => {
    if ((hasFetchedInsight.current && !forced) || materials.length === 0) return;
    hasFetchedInsight.current = true;
    setInsight("Analizando inventario con IA...");
    try {
      const res = await askPagnol("Dame un resumen del estado del inventario y alertas importantes.", fullContextString);
      if (res && res.ok && res.answer) {
        setInsight(res.answer);
      } else {
        setInsight("No se pudo obtener el diagnóstico. Intenta de nuevo.");
      }
    } catch (err) {
      console.error("Error calling askPagnol:", err);
      setInsight("Error al contactar al asistente de IA.");
    }
  }, [materials.length, fullContextString]);

  useEffect(() => {
    fetchInsight();
  }, [fetchInsight]);

  const formatRelativeTime = (timestamp: string) => {
    const now = new Date();
    const txDate = new Date(timestamp);
    const diffInSeconds = Math.floor((now.getTime() - txDate.getTime()) / 1000);
    if (diffInSeconds < 60) return 'Hace unos segundos';
    const mins = Math.floor(diffInSeconds / 60);
    if (mins < 60) return `Hace ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Ayer';
    return `Hace ${days} días`;
  };

  const getTxMaxClass = (tx: MaterialRequest): 'A' | 'B' | 'C' => {
    return tx.highestClass || 'C';
  };

  const allTransactions: DisplayTransaction[] = useMemo(() => {
    if (!requests && !returnRequests) return [];
    const withdrawalTxs = (requests || []).map((r: MaterialRequest) => ({
      id: r.id,
      assetIds: (r.items && Array.isArray(r.items)
        ? r.items
        : (r as any).materialId ? [{ materialId: (r as any).materialId, quantity: 1 }] : []
      ).map((i: any) => i.materialId),
      type: 'WITHDRAWAL' as const,
      site: r.area,
      employeeId: r.supervisorId,
      timestamp: r.createdAt ? new Date(r.createdAt as any).toISOString() : new Date().toISOString(),
      description: r.notes || '',
      status: r.status,
      needsApproval: r.status === 'pending',
      isApproved: r.status === 'approved',
      maxClass: getTxMaxClass(r),
      panoleroId: r.approverId || '',
      employeeName: r.userName || (users || []).find(u => u.id === r.supervisorId)?.name || 'Desconocido',
    }));
    const returnTxs = (returnRequests || []).map((r: ReturnRequest) => ({
      id: r.id,
      assetIds: [r.materialId],
      type: 'RETURN' as const,
      site: '',
      employeeId: r.supervisorId,
      timestamp: r.createdAt ? new Date(r.createdAt as any).toISOString() : new Date().toISOString(),
      description: r.notes || '',
      status: r.status,
      isApproved: r.status === 'completed',
      panoleroId: r.handlerId || '',
      employeeName: (users || []).find(u => u.id === r.supervisorId)?.name || 'Desconocido',
    }));
    return [...withdrawalTxs, ...returnTxs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [requests, returnRequests]);

  const actionableTransactions = useMemo(() => {
    if (!currentUser) return [];
    return allTransactions.filter(tx => {
      if (tx.type !== 'WITHDRAWAL' || !tx.needsApproval) return false;
      if (tx.maxClass === 'A' && can('material_requests:approve_class_a')) return true;
      if (tx.maxClass === 'B' && can('material_requests:approve_class_b')) return true;
      if (tx.maxClass === 'C' && can('material_requests:approve_class_c')) return true;
      return false;
    });
  }, [allTransactions, can, currentUser]);

  const isOverdue = (date: Date | string | undefined) => {
    if (!date) return false;
    return new Date(date as string) < new Date();
  };

  const stats = useMemo(() => {
    const mats = materials || [];
    const tls = tools || [];
    const totalAssets = mats.length + tls.length;
    const available = mats.filter(a => a.stock > 0 && !a.archived).length + tls.filter(t => t.status === 'available').length;
    const inUse = tls.filter(t => t.status === 'in-use').length + mats.reduce((acc, m) => acc + (m.inUse || 0), 0);
    const maint = tls.filter(t => t.status === 'maintenance').length + mats.filter(m => m.status === 'En Mantenimiento').length;
    const healthScore = totalAssets > 0 ? Math.round((available / totalAssets) * 100) : 100;
    const alertCount = actionableTransactions.length;
    const totalValue = mats.reduce((acc, item) => acc + (item.unitCost || 0) * (item.stock || 0), 0);
    const withSchedule = mats.filter(m => m.nextMaintenanceDate);
    const overdueCount = withSchedule.filter(m => isOverdue(m.nextMaintenanceDate)).length;
    const maintenanceCompliance = withSchedule.length > 0
      ? Math.round(((withSchedule.length - overdueCount) / withSchedule.length) * 100)
      : 100;
    const criticalRisk = mats.filter(m =>
      m.class === 'A' && (isOverdue(m.nextMaintenanceDate) || m.conditionScore === 'Crítico' || m.conditionScore === 'Obsoleto')
    ).length;
    return { total: totalAssets, available, inUse, maint, healthScore, alertCount, totalValue, maintenanceCompliance, criticalRisk, overdueCount };
  }, [materials, tools, actionableTransactions]);

  const formatCLPM = (amount: number) => `CLP$ ${(amount / 1000000).toFixed(1)}M`;

  const getAssetName = (assetId: string): string => {
    const mat = (materials || []).find(m => m.id === assetId);
    if (mat) return mat.name;
    const tool = (tools || []).find(t => t.id === assetId);
    if (tool) return tool.name;
    return 'Activo desconocido';
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending':    return { label: 'Pendiente',  cls: 'bg-yellow-500/10 text-yellow-600' };
      case 'approved':   return { label: 'Aprobado',   cls: 'bg-green-500/10 text-green-600' };
      case 'completed':  return { label: 'Completado', cls: 'bg-blue-500/10 text-blue-600' };
      case 'rejected':   return { label: 'Rechazado',  cls: 'bg-red-500/10 text-red-600' };
      default:           return { label: status,       cls: 'bg-muted text-muted-foreground' };
    }
  };

  const recentWithdrawals = allTransactions.filter(t => t.type === 'WITHDRAWAL').slice(0, 4);
  const recentReturns = allTransactions.filter(t => t.type === 'RETURN').slice(0, 4);

  // Real activity data — last 7 days from actual transactions
  const flowData = useMemo(() => {
    const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date();
      day.setDate(day.getDate() - (6 - i));
      day.setHours(0, 0, 0, 0);
      const nextDay = new Date(day);
      nextDay.setDate(day.getDate() + 1);
      return {
        name: DAY_NAMES[day.getDay()],
        salidas: allTransactions.filter(tx => tx.type === 'WITHDRAWAL' && new Date(tx.timestamp) >= day && new Date(tx.timestamp) < nextDay).length,
        entradas: allTransactions.filter(tx => tx.type === 'RETURN' && new Date(tx.timestamp) >= day && new Date(tx.timestamp) < nextDay).length,
      };
    });
  }, [allTransactions]);

  const handleApprove = async (txId: string) => {
    if (approvingIds.has(txId)) return;
    setApprovingIds(prev => new Set(prev).add(txId));
    try {
      await updateMaterialRequestStatus(txId, 'approved');
      notify('Solicitud autorizada exitosamente.', 'success');
      await refreshData();
    } catch (e: any) {
      console.error(e);
      notify(e.message || 'Error al autorizar la solicitud.', 'destructive');
      setApprovingIds(prev => { const s = new Set(prev); s.delete(txId); return s; });
    }
  };

  const onNavigate = (path: string) => {
    router.push(`/dashboard/pagnol/${path}`);
  };

  if (!currentUser) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-top-4 duration-1000 font-outfit">

      {/* COMMAND CENTER HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 px-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-2 h-2 rounded-full bg-pagnol-orange animate-pulse"></span>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">Pagnol ASSET MANAGEMENT</span>
            <span className="text-[8px] font-black uppercase tracking-widest bg-blue-600 text-white px-2 py-0.5 rounded-lg">ISO 55001 Aligned</span>
            {stats.criticalRisk > 0 && (
              <span className="text-[8px] font-black uppercase tracking-widest bg-red-500 text-white px-2 py-0.5 rounded-lg animate-pulse">
                {stats.criticalRisk} Activo{stats.criticalRisk > 1 ? 's' : ''} Clase A en Riesgo
              </span>
            )}
          </div>
          <h1 className="text-4xl font-black tracking-tighter text-foreground">Control de Activos</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end mr-2">
            <span className="text-[10px] font-black text-muted-foreground uppercase">Estado Operativo</span>
            <span className="text-xs font-black text-green-600 uppercase">Sistema Online</span>
          </div>
          {can('material_requests:create') && (
            <button
              onClick={() => onNavigate('movimientos')}
              className="bg-foreground border-b-4 border-foreground/80 active:border-b-0 active:translate-y-1 hover:bg-foreground/90 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest text-background transition-all shadow-xl flex items-center gap-2 whitespace-nowrap"
            >
              <PlusCircle size={14} /> Nuevo Despacho
            </button>
          )}
        </div>
      </div>

      {/* MONITOR ESTRATÉGICO */}
      <div className={`rounded-[2.5rem] p-8 sm:p-12 text-white relative overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] flex flex-col lg:flex-row items-center justify-between transition-all duration-700 ${stats.alertCount > 0 ? 'bg-slate-950 border border-red-900/30' : 'bg-slate-900'}`}>
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-pagnol-orange to-transparent blur-[120px] rounded-full translate-x-1/4 -translate-y-1/4"></div>
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-blue-600 to-transparent blur-[100px] rounded-full -translate-x-1/4 translate-y-1/4"></div>
        </div>

        <div className="relative z-10 space-y-6 text-center lg:text-left flex-1">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border-t border-white/10 ${stats.alertCount > 0 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-white/60'}`}>
            <ShieldAlert size={14} className={stats.alertCount > 0 ? 'animate-pulse' : ''} />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">
              {stats.alertCount > 0 ? 'Protocolo de Seguridad Activado' : 'Integridad de Red: 100%'}
            </span>
          </div>

          <div className="space-y-2">
            <h2 className="text-4xl sm:text-6xl font-black tracking-tighter leading-tight font-outfit">
              {stats.alertCount > 0 ? (
                <span className="text-red-500">Bloqueo de<br />Autorización</span>
              ) : (
                <span>Bienvenido,<br />{currentUser?.name?.split(' ')[0] || 'Usuario'}</span>
              )}
            </h2>
            <p className="text-white/40 text-sm sm:text-base max-w-xl font-medium leading-relaxed">
              {stats.alertCount > 0
                ? `Se han detectado ${stats.alertCount} solicitudes que exceden el límite de clase automática. Se requiere verificación biométrica o firma digital para liberar.`
                : `El inventario se encuentra balanceado. Hay ${stats.available} unidades listas para despacho inmediato en este momento.`
              }
            </p>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-4 pt-4 justify-center lg:justify-start">
            {stats.alertCount > 0 ? (
              <button
                onClick={() => document.getElementById('critical-alerts')?.scrollIntoView({ behavior: 'smooth' })}
                className="bg-red-600 hover:bg-red-700 px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-2xl shadow-red-900/20 flex items-center justify-center gap-2 group whitespace-nowrap"
              >
                Revisar Alertas <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </button>
            ) : (
              <button
                onClick={() => onNavigate('movimientos')}
                className="bg-pagnol-orange hover:bg-orange-600 px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-2xl shadow-pagnol-orange/20 flex items-center justify-center gap-2 group whitespace-nowrap"
              >
                Registrar Movimiento <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
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
                strokeDashoffset={452.3 - (452.3 * stats.healthScore) / 100}
                className={`${stats.healthScore < 50 ? 'text-red-500' : 'text-pagnol-orange'} transition-all duration-1000 ease-out`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-4xl font-black font-outfit">{stats.healthScore}%</span>
              <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] mt-1">Óptimo</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI DASHBOARD */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        {[
          { label: 'Unidades Disponibles', value: stats.available, trend: 'Efectivo', icon: Box, iconCls: 'bg-blue-500/10 text-blue-500' },
          { label: 'Tránsito Externo', value: stats.inUse, trend: 'En Faena', icon: TrendingUp, iconCls: 'bg-orange-500/10 text-orange-500' },
          {
            label: 'Cumplimiento Mantenimiento',
            value: `${stats.maintenanceCompliance}%`,
            trend: stats.overdueCount > 0 ? `${stats.overdueCount} vencido${stats.overdueCount > 1 ? 's' : ''}` : 'Al día',
            icon: Wrench,
            iconCls: stats.maintenanceCompliance < 80 ? 'bg-red-500/10 text-red-500' : stats.maintenanceCompliance < 95 ? 'bg-yellow-500/10 text-yellow-500' : 'bg-green-500/10 text-green-500',
          },
          { label: 'Valorización Inventario', value: formatCLPM(stats.totalValue), trend: 'AMIS Ready', icon: Target, iconCls: 'bg-green-500/10 text-green-500' },
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

      {/* ALERTAS CRÍTICAS */}
      {stats.alertCount > 0 && (
        <div id="critical-alerts" className="p-8 sm:p-12 rounded-[3.5rem] bg-card border-2 border-red-500/20 dark:border-red-900/30 shadow-[0_40px_80px_-20px_rgba(239,68,68,0.08)] scroll-mt-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-12">
            <div className="space-y-1">
              <h3 className="text-2xl font-black tracking-tighter flex items-center gap-3 text-foreground leading-none">
                <div className="p-2 bg-red-600 text-white rounded-xl shadow-lg shadow-red-500/20">
                  <ShieldAlert size={24} />
                </div>
                Autorizaciones Pendientes
              </h3>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-12">Firma Digital Requerida para Despacho Clase A/B</p>
            </div>
            <Badge className="bg-red-600 text-white text-[10px] font-black px-6 py-3 rounded-2xl animate-pulse uppercase tracking-widest shadow-xl shadow-red-500/30">Acción Requerida</Badge>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {actionableTransactions.map((tx, i) => (
              <div key={i} className="bg-muted/30 border border-border rounded-[3rem] shadow-sm flex flex-col group hover:bg-card hover:shadow-2xl transition-all duration-500 overflow-hidden border-b-8 border-b-red-600">
                <div className="p-8 border-b border-dashed border-border flex items-center justify-between bg-card">
                  <div className="flex items-center gap-5">
                    <div className={`p-4 rounded-2xl shadow-xl transition-all group-hover:rotate-6 ${tx.maxClass === 'A' ? 'bg-slate-950 text-red-500' : 'bg-slate-950 text-blue-500'}`}>
                      <Lock size={20} />
                    </div>
                    <div className="space-y-1">
                      <p className={`text-[10px] font-black uppercase tracking-widest ${tx.maxClass === 'A' ? 'text-red-600' : 'text-blue-600'}`}>
                        DESPACHO {tx.maxClass === 'A' ? 'CLASE A' : 'CLASE B'}
                      </p>
                      <p className="text-sm font-black text-foreground uppercase">{tx.employeeName}</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tighter">REF: {tx.id}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">{formatRelativeTime(tx.timestamp)}</p>
                    <div className="mt-2">
                      <Badge variant="secondary" className="text-[8px] font-black uppercase tracking-widest">{tx.site}</Badge>
                    </div>
                  </div>
                </div>

                <div className="p-10 flex-1 space-y-6">
                  <div className="space-y-4">
                    {tx.assetIds.map(aid => {
                      const asset = materials.find(a => a.id === aid);
                      return (
                        <div key={aid} className="flex items-center gap-5 p-5 bg-background rounded-[2rem] border border-border hover:border-pagnol-orange transition-all duration-300">
                          <div className="w-16 h-16 rounded-2xl overflow-hidden border border-border bg-muted shrink-0">
                            {asset?.photos && asset.photos.length > 0 ? (
                              <Image src={asset.photos[0]} width={80} height={80} className="w-full h-full object-cover" alt={asset.name} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center opacity-20"><ImageIcon size={24} /></div>
                            )}
                          </div>
                          <div className="flex-1 space-y-1">
                            <p className="text-sm font-black text-foreground uppercase leading-none">{asset?.name}</p>
                            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">SN: {asset?.serialNumber || 'N/A'}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-10 pt-0 mt-auto">
                  <button
                    onClick={() => handleApprove(tx.id)}
                    disabled={approvingIds.has(tx.id)}
                    className={`w-full py-6 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-3 border-b-4 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 ${tx.maxClass === 'A' ? 'bg-red-600 text-white hover:bg-red-700 border-red-800 shadow-red-500/20' : 'bg-blue-600 text-white hover:bg-blue-700 border-blue-800 shadow-blue-500/20'}`}
                  >
                    {approvingIds.has(tx.id)
                      ? <><Loader2 size={18} className="animate-spin" /> Autorizando...</>
                      : <>Autorizar Liberación <ArrowRight size={18} /></>
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIVIDAD RECIENTE */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {[
          { title: 'Salidas', type: 'WITHDRAWAL', iconCls: 'bg-orange-500/10 text-orange-500', numCls: 'text-orange-500', icon: ArrowUpRight, data: recentWithdrawals },
          { title: 'Retornos', type: 'RETURN', iconCls: 'bg-green-500/10 text-green-500', numCls: 'text-green-500', icon: ArrowDownRight, data: recentReturns },
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
              {col.data.length > 0 ? col.data.map((tx, i) => {
                const statusCfg = getStatusConfig(tx.status);
                const primaryAsset = tx.assetIds.length === 1
                  ? getAssetName(tx.assetIds[0])
                  : `${tx.assetIds.length} activos`;
                return (
                  <div key={i} className="flex items-start justify-between p-6 bg-muted/30 rounded-[2rem] border border-transparent hover:border-border hover:bg-card hover:shadow-xl transition-all duration-300 gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className={`w-10 h-10 bg-card rounded-xl flex items-center justify-center shadow-sm border border-border shrink-0 ${col.numCls}`}>
                        <col.icon size={16} />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <p className="text-xs font-black text-foreground uppercase tracking-tight leading-none truncate" title={primaryAsset}>
                          {primaryAsset}
                        </p>
                        <p className="text-[9px] text-muted-foreground font-bold uppercase truncate">{tx.employeeName}</p>
                        {tx.site && (
                          <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider truncate">{tx.site}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-[8px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                        {formatRelativeTime(tx.timestamp)}
                      </span>
                      <Badge className={`border-none text-[8px] font-black uppercase tracking-widest ${statusCfg.cls}`}>
                        {statusCfg.label}
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

      {/* ANALÍTICA + AI */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

        {/* CHART */}
        <div className="xl:col-span-2 bg-card p-10 rounded-[3rem] shadow-sm border border-border flex flex-col group">
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
                <Area type="monotone" dataKey="salidas" stroke="#f97316" strokeWidth={4} fillOpacity={1} fill="url(#colorSalida)" />
                <Area type="monotone" dataKey="entradas" stroke="rgb(148,163,184)" strokeWidth={2} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AI ENGINE */}
        <div className="bg-slate-900 rounded-[3.5rem] p-10 text-white relative overflow-hidden flex flex-col shadow-2xl group border-t-8 border-t-pagnol-orange">
          <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center gap-4 mb-12">
              <div className="p-4 bg-pagnol-orange text-white rounded-[1.5rem] shadow-2xl shadow-pagnol-orange/40 rotate-12 transition-transform duration-500">
                <Zap size={24} fill="currentColor" />
              </div>
              <div>
                <h3 className="text-2xl font-black uppercase tracking-tighter">AI Diagnostic</h3>
                <p className="text-[10px] font-black text-pagnol-orange uppercase tracking-[0.3em]">Core Engine</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar">
              <div className="bg-white/5 border border-white/5 p-8 rounded-[2.5rem] backdrop-blur-xl">
                <p className="text-sm font-medium leading-relaxed italic text-white/80">
                  "{insight}"
                </p>
              </div>
            </div>

            <div className="pt-10 border-t border-white/10 mt-8">
              <button
                onClick={() => onNavigate('reports')}
                className="w-full py-6 bg-pagnol-orange text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] hover:bg-white hover:text-slate-900 transition-all shadow-2xl shadow-pagnol-orange/20"
              >
                Auditoría Completa
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
