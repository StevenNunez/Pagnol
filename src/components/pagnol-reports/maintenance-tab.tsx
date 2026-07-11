"use client";

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Material } from '@/modules/core/lib/data';
import { formatCLP } from './report-utils';
import {
    Wrench, AlertTriangle, ShieldCheck, CalendarClock, AlertCircle, ArrowRight, Package,
} from 'lucide-react';
import type { ReportData } from './use-report-data';

function daysDiff(date: Date | string) {
    return Math.round((new Date(date as any).getTime() - Date.now()) / 86400000);
}

function MaintenanceRow({ m, tone }: { m: Material; tone: 'overdue' | 'upcoming' }) {
    const days = daysDiff(m.nextMaintenanceDate as any);
    return (
        <div className="flex items-center justify-between p-5 bg-muted border rounded-2xl group hover:bg-card hover:shadow-lg transition-all gap-3">
            <div className="flex items-center gap-4 min-w-0">
                <div className={`w-11 h-11 rounded-xl bg-card border shadow-sm flex items-center justify-center shrink-0 ${tone === 'overdue' ? 'text-destructive' : 'text-warning'}`}>
                    {tone === 'overdue' ? <AlertCircle size={18} /> : <CalendarClock size={18} />}
                </div>
                <div className="min-w-0">
                    <p className="font-black uppercase text-xs text-foreground truncate">{m.name}</p>
                    <p className="text-[9px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">
                        {new Date(m.nextMaintenanceDate as any).toLocaleDateString('es-CL')} · SN: {m.serialNumber || 'N/A'}
                    </p>
                </div>
            </div>
            <Badge className={`border-none px-3 py-1.5 rounded-xl text-[9px] font-black uppercase shrink-0 ${tone === 'overdue' ? 'bg-destructive/10 text-destructive' : 'bg-warning-subtle text-warning'}`}>
                {tone === 'overdue' ? `${Math.abs(days)} día(s) vencido` : days === 0 ? 'Hoy' : `en ${days} día(s)`}
            </Badge>
        </div>
    );
}

export function MaintenanceTab({ data }: { data: ReportData }) {
    const router = useRouter();
    const { overdue, upcoming, inWorkshop, forRetirement } = data.maintenance;

    return (
        <div className="space-y-10 animate-in slide-in-from-bottom-4">
            {/* PLAN DE MANTENIMIENTO — lo accionable primero */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card className="rounded-[3rem] border-none shadow-xl bg-card p-10 overflow-hidden relative border-t-8 border-t-destructive">
                    <div className="flex items-center justify-between gap-4 mb-8">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-destructive text-destructive-foreground flex items-center justify-center shadow-lg shadow-destructive/20">
                                <AlertCircle size={28} />
                            </div>
                            <div>
                                <h4 className="text-2xl font-black uppercase tracking-tighter">Mantenimientos Vencidos</h4>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">Pasaron su fecha planificada — acción inmediata</p>
                            </div>
                        </div>
                        <p className="text-4xl font-black font-outfit text-destructive shrink-0">{overdue.length}</p>
                    </div>
                    <div className="space-y-3">
                        {overdue.slice(0, 8).map(m => <MaintenanceRow key={m.id} m={m} tone="overdue" />)}
                        {overdue.length > 8 && (
                            <p className="text-[9px] text-center font-black text-muted-foreground uppercase pt-2">+{overdue.length - 8} equipos más</p>
                        )}
                        {overdue.length === 0 && (
                            <EmptyState icon={<ShieldCheck size={24} />} title="Sin mantenimientos vencidos" className="py-10" />
                        )}
                    </div>
                </Card>

                <Card className="rounded-[3rem] border-none shadow-xl bg-card p-10 overflow-hidden relative border-t-8 border-t-warning">
                    <div className="flex items-center justify-between gap-4 mb-8">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-warning text-warning-foreground flex items-center justify-center shadow-lg shadow-warning/20">
                                <CalendarClock size={28} />
                            </div>
                            <div>
                                <h4 className="text-2xl font-black uppercase tracking-tighter">Próximos 15 Días</h4>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">Planifica el taller antes de que venzan</p>
                            </div>
                        </div>
                        <p className="text-4xl font-black font-outfit text-warning shrink-0">{upcoming.length}</p>
                    </div>
                    <div className="space-y-3">
                        {upcoming.slice(0, 8).map(m => <MaintenanceRow key={m.id} m={m} tone="upcoming" />)}
                        {upcoming.length > 8 && (
                            <p className="text-[9px] text-center font-black text-muted-foreground uppercase pt-2">+{upcoming.length - 8} equipos más</p>
                        )}
                        {upcoming.length === 0 && (
                            <EmptyState icon={<ShieldCheck size={24} />} title="Sin mantenimientos próximos" className="py-10" />
                        )}
                    </div>
                </Card>
            </div>

            <div className="flex justify-center">
                <Button
                    onClick={() => router.push('/dashboard/pagnol/mantenimiento')}
                    variant="outline"
                    className="rounded-[1.5rem] px-8 h-12 text-xs font-black uppercase tracking-widest gap-2"
                >
                    <Wrench size={16} /> Ir al módulo de Mantenimiento <ArrowRight size={14} />
                </Button>
            </div>

            {/* ESTADO ACTUAL */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card className="rounded-[3rem] border-none shadow-xl bg-card p-10 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-10 opacity-[0.03]"><Wrench size={160} /></div>
                    <div className="flex items-center gap-5 mb-10">
                        <div className="w-14 h-14 rounded-2xl bg-warning text-warning-foreground flex items-center justify-center shadow-lg shadow-warning/20">
                            <Wrench size={28} />
                        </div>
                        <div>
                            <h4 className="text-2xl font-black uppercase tracking-tighter">En Taller Ahora</h4>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">Bloqueados para despacho</p>
                        </div>
                    </div>
                    <div className="space-y-4">
                        {inWorkshop.map(m => (
                            <div key={m.id} className="flex items-center justify-between p-6 bg-muted border rounded-[2rem] group hover:bg-card hover:shadow-xl transition-all duration-300 gap-3">
                                <div className="flex items-center gap-5 min-w-0">
                                    <div className="w-12 h-12 rounded-xl bg-card border shadow-sm flex items-center justify-center text-warning uppercase font-black text-xs shrink-0">
                                        {m.usageType?.[0] || 'M'}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-black uppercase text-sm text-foreground truncate">{m.name}</p>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">SN: {m.serialNumber || 'N/A'}</p>
                                    </div>
                                </div>
                                <Badge className="bg-warning-subtle text-warning border-none px-4 py-2 rounded-xl text-[9px] font-black uppercase shrink-0">En Taller</Badge>
                            </div>
                        ))}
                        {inWorkshop.length === 0 && (
                            <EmptyState icon={<ShieldCheck size={24} />} title="No se reportan fallas técnicas" className="py-14" />
                        )}
                    </div>
                </Card>

                <Card className="rounded-[3rem] border-none shadow-xl bg-card p-10 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-10 opacity-[0.03]"><AlertTriangle size={160} /></div>
                    <div className="flex items-center gap-5 mb-10">
                        <div className="w-14 h-14 rounded-2xl bg-destructive text-destructive-foreground flex items-center justify-center shadow-lg shadow-destructive/20">
                            <AlertTriangle size={28} />
                        </div>
                        <div>
                            <h4 className="text-2xl font-black uppercase tracking-tighter">Bajas de Activo Fijo</h4>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">Propuestos para retiro patrimonial</p>
                        </div>
                    </div>
                    <div className="space-y-4">
                        {forRetirement.map(m => (
                            <div key={m.id} className="flex items-center justify-between p-6 bg-muted border rounded-[2rem] group hover:bg-card hover:shadow-xl transition-all duration-300 gap-3">
                                <div className="flex items-center gap-5 min-w-0">
                                    <div className="w-12 h-12 rounded-xl bg-card border shadow-sm flex items-center justify-center text-destructive uppercase font-black text-xs shrink-0">!</div>
                                    <div className="min-w-0">
                                        <p className="font-black uppercase text-sm text-foreground truncate">{m.name}</p>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest leading-none">
                                            {m.internalCode || (m.serialNumber ? `SN: ${m.serialNumber}` : m.id.substring(0, 8).toUpperCase())}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-[14px] font-black font-outfit text-foreground leading-none">{formatCLP(m.unitCost || 0)}</p>
                                    <p className="text-[8px] font-black uppercase text-muted-foreground mt-1">Valor Castigado</p>
                                </div>
                            </div>
                        ))}
                        {forRetirement.length === 0 && (
                            <EmptyState icon={<Package size={24} />} title="Sin bajas pendientes" className="py-14" />
                        )}
                    </div>
                </Card>
            </div>
        </div>
    );
}
