"use client";

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Wallet, CalendarCheck, FileText, ChevronRight,
    AlertCircle, Edit, Clock, CheckCircle, XCircle,
    TrendingUp, Loader2, ArrowRight, ShieldAlert, ListChecks, Receipt,
} from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { startOfMonth, endOfMonth, getDaysInMonth, formatDistanceToNow, isToday, subMonths, format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function WorkerWallet() {
    const { toast } = useToast();
    const { user } = useAuth();
    const { attendanceLogs, addSalaryAdvanceRequest, dailyTalks, salaryAdvances } = useAppState();
    const router = useRouter();
    const [isAdvanceModalOpen, setAdvanceModalOpen] = useState(false);
    const [isSending, setIsSending] = useState(false);

    const formatCLP = (amount: number) =>
        new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);

    const formatRelativeDate = (date: any) => {
        const d = date instanceof Date ? date : new Date(date);
        if (isToday(d)) return 'Hoy';
        return formatDistanceToNow(d, { addSuffix: true, locale: es });
    };

    // --- Días trabajados este mes ---
    const daysWorked = useMemo(() => {
        if (!user || !attendanceLogs) return 0;
        const today = new Date();
        const start = startOfMonth(today);
        const workedSet = new Set<string>();
        attendanceLogs.forEach(log => {
            if (log.userId === user.id) {
                const d = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
                if (d >= start && d <= today) workedSet.add(d.toDateString());
            }
        });
        return workedSet.size;
    }, [user, attendanceLogs]);

    const totalWorkingDays = getDaysInMonth(new Date());
    const baseSalary = user?.baseSalary || 0;

    // --- Historial de adelantos del usuario ---
    const myAdvances = useMemo(() => {
        if (!user || !salaryAdvances) return [];
        return [...salaryAdvances]
            .filter(a => a.workerId === user.id)
            .sort((a, b) =>
                new Date(b.requestedAt as any).getTime() - new Date(a.requestedAt as any).getTime()
            );
    }, [user, salaryAdvances]);

    // Solo los del mes actual (no rechazados) cuentan como tomados
    const advancesTaken = useMemo(() => {
        const start = startOfMonth(new Date());
        return myAdvances
            .filter(a => {
                const d = new Date(a.requestedAt as any);
                return d >= start && a.status !== 'rejected';
            })
            .reduce((sum, a) => sum + a.amount, 0);
    }, [myAdvances]);

    // --- Cálculos financieros ---
    const dailyRate = baseSalary > 0 ? baseSalary / 30 : 0;
    const currentEarnings = Math.floor(dailyRate * daysWorked);
    const maxAdvanceLimit = Math.max(0, Math.floor(currentEarnings * 0.5) - advancesTaken);
    const canRequestAdvance = baseSalary > 0 && maxAdvanceLimit >= 10000;

    const [requestedAmount, setRequestedAmount] = useState(10000);
    React.useEffect(() => {
        setRequestedAmount(canRequestAdvance ? Math.min(50000, maxAdvanceLimit) : 10000);
    }, [maxAdvanceLimit, canRequestAdvance]);

    // --- Liquidaciones mensuales (últimos 6 meses, calculadas desde asistencia) ---
    const monthlyLiquidaciones = useMemo(() => {
        if (!user || baseSalary === 0) return [];
        const today = new Date();
        const dailyRate = baseSalary / 30;
        return Array.from({ length: 6 }, (_, i) => {
            const monthDate = subMonths(today, i + 1);
            const monthStart = startOfMonth(monthDate);
            const monthEnd = endOfMonth(monthDate);
            const workedSet = new Set<string>();
            (attendanceLogs || []).forEach(log => {
                if (log.userId !== user.id) return;
                const d = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
                if (d >= monthStart && d <= monthEnd) workedSet.add(d.toDateString());
            });
            const daysWorkedMonth = workedSet.size;
            const bruto = Math.floor(dailyRate * daysWorkedMonth);
            const advancesMonth = (salaryAdvances || [])
                .filter(a => {
                    if (a.workerId !== user.id || a.status !== 'approved') return false;
                    const d = new Date(a.requestedAt as any);
                    return d >= monthStart && d <= monthEnd;
                })
                .reduce((sum, a) => sum + a.amount, 0);
            const neto = Math.max(0, bruto - advancesMonth);
            return { label: format(monthDate, 'MMMM yyyy', { locale: es }), daysWorked: daysWorkedMonth, bruto, advancesMonth, neto };
        }).filter(m => m.daysWorked > 0);
    }, [user, baseSalary, attendanceLogs, salaryAdvances]);

    // --- Charlas pendientes de firma ---
    const pendingTalks = useMemo(() => {
        if (!user || !dailyTalks) return [];
        return dailyTalks
            .filter(talk => talk.asistentes.some(a => a.id === user.id && !a.signed))
            .sort((a, b) => (b.fecha as any) - (a.fecha as any));
    }, [dailyTalks, user]);

    const handleRequestAdvance = async () => {
        if (!user) return;
        setIsSending(true);
        try {
            await addSalaryAdvanceRequest({
                workerId: user.id,
                workerName: user.name,
                amount: requestedAmount,
            });
            toast({
                variant: 'success',
                title: 'Solicitud enviada',
                description: `Tu adelanto de ${formatCLP(requestedAmount)} está en proceso de aprobación.`,
            });
            setAdvanceModalOpen(false);
        } catch {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo procesar la solicitud.' });
        } finally {
            setIsSending(false);
        }
    };

    const advanceStatusConfig = (status: string) => {
        switch (status) {
            case 'approved': return { label: 'Aprobado',  cls: 'bg-green-500/10 text-green-600',  Icon: CheckCircle };
            case 'rejected': return { label: 'Rechazado', cls: 'bg-red-500/10 text-red-600',    Icon: XCircle };
            default:         return { label: 'Pendiente', cls: 'bg-yellow-500/10 text-yellow-600', Icon: Clock };
        }
    };

    const attendancePct = Math.min(100, totalWorkingDays > 0 ? (daysWorked / totalWorkingDays) * 100 : 0);

    return (
        <div className="max-w-md mx-auto space-y-6 pb-16 animate-in fade-in duration-500 font-outfit">

            {/* Header */}
            <div className="flex justify-between items-center pt-4">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">Pagnol Wallet</p>
                    <h2 className="text-2xl font-black tracking-tighter">
                        Hola, {user?.name?.split(' ')[0] || 'Trabajador'}
                    </h2>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                        {user?.cargo || 'Trabajador'}
                    </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-pagnol-orange/10 text-pagnol-orange font-black text-sm flex items-center justify-center border border-pagnol-orange/20 shrink-0">
                    {(user?.name?.split(' ').map(n => n[0]).join('').substring(0, 2) || 'U').toUpperCase()}
                </div>
            </div>

            {/* Alerta: sueldo base no configurado */}
            {baseSalary === 0 && (
                <div className="p-5 rounded-[2rem] bg-amber-50 border border-amber-200 flex items-start gap-3">
                    <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                            Sueldo base no configurado
                        </p>
                        <p className="text-[10px] text-amber-600 font-bold mt-0.5">
                            Contacta a RRHH para activar los cálculos financieros.
                        </p>
                    </div>
                </div>
            )}

            {/* Alerta: firmas pendientes */}
            {pendingTalks.length > 0 && (
                <div className="p-5 rounded-[2rem] bg-amber-50 border border-amber-200 space-y-3">
                    <div className="flex items-center gap-2">
                        <Edit className="h-4 w-4 text-amber-600" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                            {pendingTalks.length} firma{pendingTalks.length > 1 ? 's' : ''} pendiente{pendingTalks.length > 1 ? 's' : ''}
                        </p>
                    </div>
                    {pendingTalks.slice(0, 2).map(talk => (
                        <Link key={talk.id} href={`/dashboard/worker/sign-talk/${talk.id}`}>
                            <div className="flex justify-between items-center p-3 rounded-xl bg-white border border-amber-100 hover:border-amber-300 transition-all mt-2">
                                <div>
                                    <p className="font-black text-xs uppercase">{formatRelativeDate(talk.fecha)}</p>
                                    <p className="text-[9px] text-muted-foreground truncate max-w-[200px]">{talk.temas}</p>
                                </div>
                                <ChevronRight className="h-4 w-4 text-amber-400 shrink-0" />
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {/* Tarjeta principal */}
            <div className="rounded-[2.5rem] bg-slate-900 text-white overflow-hidden relative shadow-2xl shadow-slate-900/20 p-8 space-y-6">
                <div className="absolute top-0 right-0 w-56 h-56 bg-pagnol-orange/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-blue-600/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

                <div className="relative z-10">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/40">
                        Saldo Acumulado — {new Date().toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-4xl font-black tracking-tighter mt-1">
                        {baseSalary > 0 ? formatCLP(currentEarnings) : '—'}
                    </p>
                </div>

                <div className="relative z-10 space-y-2">
                    <div className="flex justify-between text-[9px] font-black uppercase text-white/40">
                        <span>{daysWorked} días trabajados</span>
                        <span>Meta: {totalWorkingDays} días</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-green-400 rounded-full transition-all duration-700"
                            style={{ width: `${attendancePct}%` }}
                        />
                    </div>
                </div>

                <div className="relative z-10 p-4 bg-white/10 rounded-2xl border border-white/10 backdrop-blur-sm space-y-1">
                    <div className="flex justify-between items-start">
                        <p className="text-[9px] font-black uppercase text-white/40 tracking-widest">Disponible para Adelanto</p>
                        <Badge className={`text-[8px] font-black uppercase tracking-widest border-none ${canRequestAdvance ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/30'}`}>
                            {canRequestAdvance ? 'Activo' : 'No disponible'}
                        </Badge>
                    </div>
                    <p className="text-2xl font-black text-green-400">
                        {baseSalary > 0 ? formatCLP(maxAdvanceLimit) : '—'}
                    </p>
                    {advancesTaken > 0 && (
                        <p className="text-[9px] text-white/30 font-bold">
                            Ya solicitado este mes: {formatCLP(advancesTaken)}
                        </p>
                    )}
                </div>

                <Button
                    onClick={() => setAdvanceModalOpen(true)}
                    disabled={!canRequestAdvance}
                    className="relative z-10 w-full py-6 rounded-2xl bg-pagnol-orange text-white font-black uppercase text-[10px] tracking-widest hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-xl shadow-pagnol-orange/20 transition-all flex items-center justify-center gap-2"
                >
                    {canRequestAdvance
                        ? <><Wallet size={15} /> Solicitar Adelanto</>
                        : baseSalary === 0
                            ? 'Sueldo base no configurado'
                            : 'Saldo insuficiente para adelanto'
                    }
                </Button>
            </div>

            {/* Accesos rápidos */}
            <div className="grid grid-cols-2 gap-4">
                <button
                    onClick={() => router.push('/dashboard/attendance')}
                    className="p-5 rounded-[2rem] bg-card border border-border hover:border-blue-300 hover:shadow-lg transition-all flex flex-col items-center gap-3 text-center group"
                >
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                        <CalendarCheck size={22} />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Mi Asistencia</span>
                </button>
                <button
                    onClick={() => router.push('/dashboard/attendance/severance')}
                    className="p-5 rounded-[2rem] bg-card border border-border hover:border-purple-300 hover:shadow-lg transition-all flex flex-col items-center gap-3 text-center group"
                >
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-500 flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                        <FileText size={22} />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Mi Finiquito</span>
                </button>
            </div>

            {/* Mis Liquidaciones */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">
                        Mis Liquidaciones
                    </h3>
                    <Badge variant="outline" className="text-[8px] font-black uppercase">
                        Estimado mensual
                    </Badge>
                </div>

                {baseSalary === 0 ? (
                    <div className="p-8 rounded-[2rem] border border-dashed border-border text-center space-y-2 opacity-40">
                        <Receipt size={28} className="mx-auto" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Sueldo base no configurado</p>
                    </div>
                ) : monthlyLiquidaciones.length === 0 ? (
                    <div className="p-8 rounded-[2rem] border border-dashed border-border text-center space-y-2 opacity-40">
                        <Receipt size={28} className="mx-auto" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Sin registros de asistencia anteriores</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {monthlyLiquidaciones.map((liq) => (
                            <div key={liq.label} className="p-5 rounded-[2rem] border border-border bg-card space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                                            <Receipt size={16} />
                                        </div>
                                        <p className="font-black text-sm capitalize">{liq.label}</p>
                                    </div>
                                    <p className="font-black text-sm text-green-600">{formatCLP(liq.neto)}</p>
                                </div>
                                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border">
                                    <div className="text-center">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Días</p>
                                        <p className="text-xs font-black">{liq.daysWorked}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Bruto</p>
                                        <p className="text-xs font-black">{formatCLP(liq.bruto)}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Adelantos</p>
                                        <p className="text-xs font-black text-red-500">{liq.advancesMonth > 0 ? `- ${formatCLP(liq.advancesMonth)}` : '—'}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Historial de adelantos */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">
                        Historial de Adelantos
                    </h3>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[8px] font-black uppercase">
                            {myAdvances.length} solicitud{myAdvances.length !== 1 ? 'es' : ''}
                        </Badge>
                        {myAdvances.length > 0 && (
                            <Link
                                href="/dashboard/wallet/advances"
                                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-pagnol-orange hover:underline"
                            >
                                <ListChecks size={12} /> Ver todos
                            </Link>
                        )}
                    </div>
                </div>

                {myAdvances.length === 0 ? (
                    <div className="p-10 rounded-[2rem] border border-dashed border-border text-center space-y-3 opacity-30">
                        <TrendingUp size={32} className="mx-auto" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Sin solicitudes de adelanto</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {myAdvances.slice(0, 6).map(adv => {
                            const { label, cls, Icon } = advanceStatusConfig(adv.status);
                            return (
                                <div key={adv.id} className="flex items-center justify-between p-5 rounded-[2rem] border border-border bg-card hover:shadow-md transition-all gap-4">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cls}`}>
                                            <Icon size={18} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-black text-sm leading-none">{formatCLP(adv.amount)}</p>
                                            <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-1">
                                                {formatRelativeDate(adv.requestedAt)}
                                            </p>
                                            {adv.approverName && adv.status === 'approved' && (
                                                <p className="text-[8px] text-green-600 font-bold mt-0.5 truncate">
                                                    Aprobado por {adv.approverName}
                                                </p>
                                            )}
                                            {adv.rejectionReason && (
                                                <p className="text-[8px] text-red-500 font-bold mt-0.5 truncate">
                                                    {adv.rejectionReason}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <Badge className={`text-[8px] font-black uppercase tracking-widest border-none shrink-0 ${cls}`}>
                                        {label}
                                    </Badge>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Modal solicitud de adelanto */}
            <Dialog open={isAdvanceModalOpen} onOpenChange={setAdvanceModalOpen}>
                <DialogContent className="sm:max-w-md rounded-[2rem] border-none bg-slate-100 p-8 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black uppercase tracking-tighter">Solicitar Adelanto</DialogTitle>
                        <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Se descontará de tu liquidación a fin de mes
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-6 space-y-6">
                        <div className="text-center p-6 bg-white rounded-[2rem] shadow-sm border border-slate-100">
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">Monto a recibir</p>
                            <p className="text-4xl font-black text-pagnol-orange">{formatCLP(requestedAmount)}</p>
                        </div>

                        <div className="space-y-3">
                            <Slider
                                value={[requestedAmount]}
                                min={10000}
                                max={maxAdvanceLimit}
                                step={5000}
                                onValueChange={(val) => setRequestedAmount(val[0])}
                            />
                            <div className="flex justify-between text-[9px] font-black uppercase text-muted-foreground">
                                <span>Mín: {formatCLP(10000)}</span>
                                <span>Máx: {formatCLP(maxAdvanceLimit)}</span>
                            </div>
                        </div>

                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex gap-3 items-start">
                            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-amber-700 font-bold leading-relaxed">
                                La transferencia puede tardar hasta 24 horas hábiles. Al confirmar autorizas el descuento en tu próxima liquidación.
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setAdvanceModalOpen(false)}
                            className="rounded-xl font-black uppercase text-[10px]"
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleRequestAdvance}
                            disabled={isSending}
                            className="rounded-xl font-black uppercase text-[10px] bg-pagnol-orange hover:bg-orange-600 text-white"
                        >
                            {isSending
                                ? <Loader2 className="animate-spin" size={16} />
                                : 'Confirmar Solicitud'
                            }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}
