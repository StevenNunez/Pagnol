"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QrScannerDialog } from "@/components/qr-scanner-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
    UserCheck, UserX, Users, Clock, ScanLine,
    Search, LogIn, LogOut, BarChart2, FileSpreadsheet, FileText,
} from "lucide-react";
import type { AttendanceLog, User } from "@/modules/core/lib/data";

type WorkerStatus = 'present' | 'left' | 'absent';

interface WorkerRow {
    user: User;
    status: WorkerStatus;
    firstIn: string | null;
    lastOut: string | null;
    totalLogs: number;
}

const formatTime = (date: Date | string | null): string => {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
};

export default function AttendancePage() {
    const { attendanceLogs, users, handleAttendanceScan } = useAppState();
    const { toast } = useToast();
    const router = useRouter();
    const [today, setToday] = useState('');
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState<WorkerStatus | 'all'>('all');
    const [scannerOpen, setScannerOpen] = useState(false);

    useEffect(() => {
        const now = new Date();
        setToday(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    }, []);

    const workerRows = useMemo((): WorkerRow[] => {
        const relevantUsers = (users || []).filter((u: User) => u.role !== 'guardia' && u.role !== 'super-admin');
        const todayLogs = (attendanceLogs || []).filter((l: AttendanceLog) => l.date === today);

        return relevantUsers.map((u: User) => {
            const logs = todayLogs
                .filter((l: AttendanceLog) => l.userId === u.id)
                .sort((a: AttendanceLog, b: AttendanceLog) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            if (logs.length === 0) {
                return { user: u, status: 'absent', firstIn: null, lastOut: null, totalLogs: 0 };
            }

            const last = logs[logs.length - 1];
            const firstIn = logs.find((l: AttendanceLog) => l.type === 'in');
            const lastOut = [...logs].reverse().find((l: AttendanceLog) => l.type === 'out');

            return {
                user: u,
                status: last.type === 'in' ? 'present' : 'left',
                firstIn: firstIn ? formatTime(firstIn.timestamp) : null,
                lastOut: lastOut ? formatTime(lastOut.timestamp) : null,
                totalLogs: logs.length,
            };
        });
    }, [users, attendanceLogs, today]);

    const stats = useMemo(() => ({
        total: workerRows.length,
        present: workerRows.filter(r => r.status === 'present').length,
        left: workerRows.filter(r => r.status === 'left').length,
        absent: workerRows.filter(r => r.status === 'absent').length,
    }), [workerRows]);

    const filtered = useMemo(() => {
        return workerRows.filter(r => {
            const matchSearch = r.user.name.toLowerCase().includes(search.toLowerCase()) ||
                (r.user.cargo || '').toLowerCase().includes(search.toLowerCase());
            const matchStatus = filterStatus === 'all' || r.status === filterStatus;
            return matchSearch && matchStatus;
        }).sort((a, b) => {
            const order: Record<WorkerStatus, number> = { present: 0, left: 1, absent: 2 };
            return order[a.status] - order[b.status];
        });
    }, [workerRows, search, filterStatus]);

    const handleQrScan = async (qrCode: string) => {
        try {
            await handleAttendanceScan(qrCode);
            toast({ variant: 'success', title: 'Registro exitoso', description: 'Asistencia registrada correctamente.' });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message });
        }
    };

    const statusConfig: Record<WorkerStatus, { label: string; cls: string; dot: string }> = {
        present: { label: 'Presente', cls: 'bg-green-500/10 text-green-700 border-green-200', dot: 'bg-green-500' },
        left:    { label: 'Salió',    cls: 'bg-slate-100 text-slate-600 border-slate-200',    dot: 'bg-slate-400' },
        absent:  { label: 'Ausente',  cls: 'bg-red-500/10 text-red-600 border-red-200',        dot: 'bg-red-400' },
    };

    const filterBtns: { value: WorkerStatus | 'all'; label: string }[] = [
        { value: 'all',     label: `Todos (${stats.total})` },
        { value: 'present', label: `Presentes (${stats.present})` },
        { value: 'left',    label: `Salieron (${stats.left})` },
        { value: 'absent',  label: `Ausentes (${stats.absent})` },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <PageHeader
                    title="Control de Asistencia"
                    description={new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                />
                <Button onClick={() => setScannerOpen(true)} className="shrink-0 bg-pagnol-orange hover:bg-orange-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl px-6 gap-2">
                    <ScanLine size={16} /> Registrar QR
                </Button>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: 'Dotación Total', value: stats.total, icon: Users, color: 'text-slate-700', bg: 'bg-slate-100' },
                    { label: 'Dentro Ahora', value: stats.present, icon: UserCheck, color: 'text-green-700', bg: 'bg-green-50' },
                    { label: 'Salieron', value: stats.left, icon: Clock, color: 'text-slate-500', bg: 'bg-slate-50' },
                    { label: 'Ausentes', value: stats.absent, icon: UserX, color: 'text-red-600', bg: 'bg-red-50' },
                ].map(({ label, value, icon: Icon, color, bg }) => (
                    <div key={label} className={`${bg} rounded-2xl p-5 flex items-center gap-4`}>
                        <div className={`${color} shrink-0`}><Icon size={22} /></div>
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                            <p className={`text-3xl font-black tracking-tighter ${color}`}>{value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Barra de progreso de asistencia */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
                <div className="flex justify-between items-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cobertura del Día</p>
                    <p className="text-[10px] font-black text-muted-foreground">
                        {stats.total > 0 ? Math.round(((stats.present + stats.left) / stats.total) * 100) : 0}% asistió
                    </p>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                    <div className="bg-green-500 h-full transition-all duration-700"
                        style={{ width: `${stats.total > 0 ? (stats.present / stats.total) * 100 : 0}%` }} />
                    <div className="bg-slate-300 h-full transition-all duration-700"
                        style={{ width: `${stats.total > 0 ? (stats.left / stats.total) * 100 : 0}%` }} />
                </div>
                <div className="flex gap-4 text-[9px] font-black uppercase tracking-widest">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Dentro</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />Salió</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-200 inline-block" />Ausente</span>
                </div>
            </div>

            {/* Tabla de trabajadores */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                {/* Filtros */}
                <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Buscar trabajador o cargo..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-8 h-9 text-sm rounded-xl"
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {filterBtns.map(btn => (
                            <button
                                key={btn.value}
                                onClick={() => setFilterStatus(btn.value)}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border ${
                                    filterStatus === btn.value
                                        ? 'bg-slate-900 text-white border-slate-900'
                                        : 'bg-transparent text-muted-foreground border-border hover:border-slate-400'
                                }`}
                            >
                                {btn.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Filas */}
                <div className="divide-y divide-border">
                    {filtered.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground text-sm">
                            No hay trabajadores que coincidan con el filtro.
                        </div>
                    ) : filtered.map(({ user: u, status, firstIn, lastOut, totalLogs }) => {
                        const cfg = statusConfig[status];
                        return (
                            <div key={u.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/50 transition-colors">
                                {/* Avatar */}
                                <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 font-black text-sm flex items-center justify-center shrink-0 uppercase">
                                    {u.name.split(' ').map(n => n[0]).join('').substring(0, 2)}
                                </div>
                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-black text-sm truncate">{u.name}</p>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest truncate">{u.cargo || u.role}</p>
                                </div>
                                {/* Horarios */}
                                <div className="hidden md:flex items-center gap-6 text-xs shrink-0">
                                    <div className="flex items-center gap-1.5 text-green-600">
                                        <LogIn size={13} />
                                        <span className="font-bold">{firstIn || '—'}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-slate-400">
                                        <LogOut size={13} />
                                        <span className="font-bold">{lastOut || '—'}</span>
                                    </div>
                                    {totalLogs > 0 && (
                                        <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">
                                            {totalLogs} reg.
                                        </span>
                                    )}
                                </div>
                                {/* Status badge */}
                                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest shrink-0 ${cfg.cls}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                                    {cfg.label}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Accesos rápidos a reportes */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                    { label: 'Reporte Semanal', icon: BarChart2, href: '/dashboard/attendance/report', color: 'text-violet-600' },
                    { label: 'Liquidación de Sueldo', icon: FileSpreadsheet, href: '/dashboard/attendance/monthly-report', color: 'text-green-600' },
                    { label: 'Finiquito', icon: FileText, href: '/dashboard/attendance/severance', color: 'text-red-500' },
                ].map(({ label, icon: Icon, href, color }) => (
                    <button
                        key={href}
                        onClick={() => router.push(href)}
                        className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-slate-300 hover:shadow-sm transition-all text-left group"
                    >
                        <Icon size={18} className={`${color} shrink-0`} />
                        <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
                    </button>
                ))}
            </div>

            <QrScannerDialog
                open={scannerOpen}
                onOpenChange={setScannerOpen}
                onScan={handleQrScan}
                title="Registrar Asistencia"
                description="Apunta la cámara al código QR del trabajador para registrar entrada o salida."
            />
        </div>
    );
}
