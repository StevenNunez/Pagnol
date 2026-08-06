"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Wallet, CalendarCheck, ChevronRight,
    AlertCircle, Edit, Clock, CheckCircle, XCircle,
    TrendingUp, Loader2, ShieldAlert, ListChecks, Receipt, FileDown,
} from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { LoadingState } from '@/components/loading-state';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { startOfMonth, getDaysInMonth, formatDistanceToNow, isToday, format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { EmploymentContract, PayrollLine, PayrollRun } from '@/modules/core/lib/data';
import { fetchEmploymentContracts, contractAt } from '@/modules/data/mutations/payrollMutations';
import { fetchMyPayrollLines } from '@/modules/data/mutations/payrollRunMutations';
import { earnedBaseSalary } from '@/modules/data/mutations/payrollMath';
import { laborDayPresence, type LaborDayLog } from '@/modules/data/mutations/financeMath';
import { buildLiquidacionPdf, liquidacionFileName } from '@/lib/liquidacion-pdf';

// Billetera del trabajador.
//
// ⚠️ Esta página NO calcula liquidaciones. Las que muestra son las REALES de
// `payroll_lines` (F3), con su PDF dibujado desde el snapshot. Antes fabricaba
// `sueldo/30 × días − anticipos` y lo llamaba "Mis Liquidaciones": sin AFP, sin
// salud, sin impuesto único, sin gratificación ni topes. Era la calculadora que
// se retiró por riesgo legal (ADR-011/012), sobreviviendo en la única pantalla
// que el trabajador cree.
//
// Lo único estimado que queda es el saldo DEL MES EN CURSO —que por definición
// aún no tiene liquidación— y está rotulado como tal. Sirve para una sola cosa:
// calcular el cupo de adelanto.

export default function WorkerWallet() {
    const { toast } = useToast();
    const { user } = useAuth();
    const { attendanceLogs, addSalaryAdvanceRequest, dailyTalks, salaryAdvances, users, currentTenant } = useAppState();
    const router = useRouter();
    const [isAdvanceModalOpen, setAdvanceModalOpen] = useState(false);
    const [isSending, setIsSending] = useState(false);

    // Contrato laboral vigente y liquidaciones propias: no viven en el estado
    // global (son datos sensibles, se leen bajo la RLS del propio usuario).
    const [contract, setContract] = useState<EmploymentContract | null>(null);
    const [contractLoading, setContractLoading] = useState(true);
    const [liquidaciones, setLiquidaciones] = useState<{ line: PayrollLine; run: PayrollRun }[]>([]);
    const [liqLoading, setLiqLoading] = useState(true);

    useEffect(() => {
        if (!user?.id) return;
        let vigente = true;
        const hoy = format(new Date(), 'yyyy-MM-dd');
        fetchEmploymentContracts(user.id)
            .then((cs) => { if (vigente) setContract(contractAt(cs, hoy)); })
            .catch(() => { if (vigente) setContract(null); })
            .finally(() => { if (vigente) setContractLoading(false); });
        fetchMyPayrollLines(user.id)
            .then((rows) => { if (vigente) setLiquidaciones(rows); })
            .catch(() => { if (vigente) setLiquidaciones([]); })
            .finally(() => { if (vigente) setLiqLoading(false); });
        return () => { vigente = false; };
    }, [user?.id]);

    const formatCLP = (amount: number) =>
        new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);

    const formatRelativeDate = (date: any) => {
        const d = date instanceof Date ? date : new Date(date);
        if (isToday(d)) return 'Hoy';
        return formatDistanceToNow(d, { addSuffix: true, locale: es });
    };

    // --- Días trabajados este mes ---
    // Mismo criterio que el ledger y la planilla (`laborDayPresence`): una marca
    // de entrada TRABAJADA. Contar cualquier marca —como se hacía antes— suma
    // licencias, vacaciones y permisos como días trabajados, e infla el cupo.
    // Se comparan strings YYYY-MM-DD, nunca Date: el off-by-one de zona horaria
    // ya se coló cuatro veces en este proyecto.
    const daysWorked = useMemo(() => {
        if (!user || !attendanceLogs) return 0;
        const desde = format(startOfMonth(new Date()), 'yyyy-MM-dd');
        const hasta = format(new Date(), 'yyyy-MM-dd');
        const porDia = new Map<string, LaborDayLog[]>();
        for (const log of attendanceLogs) {
            if (log.userId !== user.id) continue;
            const d = log.date || format(log.timestamp as Date, 'yyyy-MM-dd');
            if (d < desde || d > hasta) continue;
            const arr = porDia.get(d) || [];
            arr.push({
                type: log.type,
                markType: log.markType ?? null,
                contractId: log.contractId ?? null,
                timestamp: (log.timestamp as Date)?.toISOString?.() || '',
            });
            porDia.set(d, arr);
        }
        let n = 0;
        for (const logs of porDia.values()) if (laborDayPresence(logs)) n++;
        return n;
    }, [user, attendanceLogs]);

    // El sueldo sale del CONTRATO LABORAL vigente (F1), no de `profiles.base_salary`:
    // ese campo legacy no se mueve cuando se firma un anexo, así que el cupo
    // quedaba calculado sobre un sueldo viejo.
    const baseSalary = contract?.baseSalary || 0;
    const salaryMode = contract?.salaryMode === 'daily' ? 'daily' : 'monthly';

    // --- Historial de adelantos del usuario ---
    const myAdvances = useMemo(() => {
        if (!user || !salaryAdvances) return [];
        return [...salaryAdvances]
            .filter(a => a.workerId === user.id)
            .sort((a, b) =>
                new Date(b.requestedAt as any).getTime() - new Date(a.requestedAt as any).getTime()
            );
    }, [user, salaryAdvances]);

    // Deuda VIGENTE: todo anticipo que la planilla todavía no descontó
    // (`payrollLineId == null`), sin importar de qué mes sea. Antes se miraba
    // solo el mes en curso, así que un anticipo de un mes anterior que nunca
    // entró en una planilla no ocupaba cupo y se podía volver a pedir sobre la
    // misma plata. Los pendientes también ocupan: están por resolverse.
    const deudaVigente = useMemo(() => myAdvances
        .filter(a => a.status !== 'rejected' && !a.payrollLineId)
        .reduce((sum, a) => sum + a.amount, 0), [myAdvances]);

    // --- Cálculos financieros ---
    // `earnedBaseSalary` es la misma función que usa el motor de liquidación:
    // respeta el modo de sueldo del contrato (mensual con divisor 30, o por día).
    const currentEarnings = earnedBaseSalary(baseSalary, salaryMode, daysWorked);
    const maxAdvanceLimit = Math.max(0, Math.floor(currentEarnings * 0.5) - deudaVigente);
    const canRequestAdvance = baseSalary > 0 && maxAdvanceLimit >= 10000;

    const [requestedAmount, setRequestedAmount] = useState(10000);
    React.useEffect(() => {
        setRequestedAmount(canRequestAdvance ? Math.min(50000, maxAdvanceLimit) : 10000);
    }, [maxAdvanceLimit, canRequestAdvance]);

    const mesDe = (periodMonth: string) => {
        const [y, m] = periodMonth.split('-');
        const nombre = new Date(Number(y), Number(m) - 1, 1)
            .toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
        return nombre.charAt(0).toUpperCase() + nombre.slice(1);
    };

    /**
     * PDF de la liquidación, dibujado desde el SNAPSHOT de la línea: dice lo que
     * se emitió, aunque las tasas hayan cambiado después (ADR-009 §4).
     */
    const descargarLiquidacion = (line: PayrollLine, run: PayrollRun) => {
        try {
            const perfil = (users || []).find(u => u.id === line.userId);
            const doc = buildLiquidacionPdf({
                line,
                run,
                tenant: { name: currentTenant?.name || '—', rut: (currentTenant as any)?.rut || null },
                workerRut: perfil?.rut || user?.rut || null,
                cargo: perfil?.cargo || user?.cargo || null,
            });
            doc.save(liquidacionFileName(line, run));
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo generar el PDF', description: e?.message });
        }
    };

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
            // Aprobado ≠ depositado: el trabajador tiene que poder distinguirlos
            // para saber si le falta plata o le falta el trámite.
            case 'paid':     return { label: 'Depositado', cls: 'bg-success-subtle text-success-subtle-foreground', Icon: CheckCircle };
            case 'approved': return { label: 'Aprobado',   cls: 'bg-info-subtle text-info-subtle-foreground',       Icon: Clock };
            case 'rejected': return { label: 'Rechazado',  cls: 'bg-destructive/10 text-destructive',               Icon: XCircle };
            default:         return { label: 'Pendiente',  cls: 'bg-warning-subtle text-warning-subtle-foreground', Icon: Clock };
        }
    };

    const totalWorkingDays = getDaysInMonth(new Date());
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
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary font-black text-sm flex items-center justify-center border border-primary/20 shrink-0">
                    {(user?.name?.split(' ').map(n => n[0]).join('').substring(0, 2) || 'U').toUpperCase()}
                </div>
            </div>

            {/* Alerta: sin contrato laboral vigente.
                Es el contrato el que fija el sueldo desde F1, y sin él la
                planilla no puede liquidar a este trabajador — así que tampoco
                hay liquidación futura de la cual descontar un adelanto. */}
            {!contractLoading && !contract && (
                <div className="p-5 rounded-[2rem] bg-warning-subtle border border-warning/30 flex items-start gap-3">
                    <ShieldAlert className="h-5 w-5 text-warning-subtle-foreground shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-warning-subtle-foreground">
                            Sin contrato laboral registrado
                        </p>
                        <p className="text-[10px] text-warning-subtle-foreground/80 font-bold mt-0.5">
                            Pídele a RRHH que cargue tu contrato: de ahí salen tu sueldo y tu liquidación.
                        </p>
                    </div>
                </div>
            )}

            {/* Alerta: firmas pendientes */}
            {pendingTalks.length > 0 && (
                <div className="p-5 rounded-[2rem] bg-warning-subtle border border-warning/30 space-y-3">
                    <div className="flex items-center gap-2">
                        <Edit className="h-4 w-4 text-warning-subtle-foreground" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-warning-subtle-foreground">
                            {pendingTalks.length} firma{pendingTalks.length > 1 ? 's' : ''} pendiente{pendingTalks.length > 1 ? 's' : ''}
                        </p>
                    </div>
                    {pendingTalks.slice(0, 2).map(talk => (
                        <Link key={talk.id} href={`/dashboard/worker/sign-talk/${talk.id}`}>
                            <div className="flex justify-between items-center p-3 rounded-xl bg-card border hover:border-warning/50 transition-all mt-2">
                                <div>
                                    <p className="font-black text-xs uppercase">{formatRelativeDate(talk.fecha)}</p>
                                    <p className="text-[9px] text-muted-foreground truncate max-w-[200px]">{talk.temas}</p>
                                </div>
                                <ChevronRight className="h-4 w-4 text-warning shrink-0" />
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {/* Tarjeta principal */}
            {/* Superficie SIEMPRE oscura (`pagnol-dark` lo es en ambos temas): los
                `text-white/X` y los acentos claros de adentro son intencionales,
                no deuda de dark mode. */}
            <div className="rounded-[2.5rem] bg-pagnol-dark text-white overflow-hidden relative shadow-2xl shadow-pagnol-dark/20 p-8 space-y-6">
                <div className="absolute top-0 right-0 w-56 h-56 bg-primary/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-info/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

                <div className="relative z-10">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/40">
                        Saldo Acumulado — {new Date().toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-4xl font-black tracking-tighter mt-1">
                        {baseSalary > 0 ? formatCLP(currentEarnings) : '—'}
                    </p>
                    {/* Rótulo honesto: es sueldo base devengado por los días
                        trabajados, ANTES de descuentos. No es lo que se recibe. */}
                    <p className="text-[9px] text-white/40 font-bold mt-1">
                        Sueldo base por los días trabajados, antes de descuentos legales.
                        Tu liquidación del mes la emite RRHH.
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
                    {deudaVigente > 0 && (
                        <p className="text-[9px] text-white/30 font-bold">
                            Ya comprometido y aún sin descontar: {formatCLP(deudaVigente)}
                        </p>
                    )}
                </div>

                <Button
                    onClick={() => setAdvanceModalOpen(true)}
                    disabled={!canRequestAdvance}
                    className="relative z-10 w-full py-6 rounded-2xl font-black uppercase text-[10px] tracking-widest disabled:opacity-40 disabled:cursor-not-allowed shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-2"
                >
                    {canRequestAdvance
                        ? <><Wallet size={15} /> Solicitar Adelanto</>
                        : baseSalary === 0
                            ? 'Sin contrato laboral registrado'
                            : 'Saldo insuficiente para adelanto'
                    }
                </Button>
            </div>

            {/* Accesos rápidos */}
            <div className="grid grid-cols-2 gap-4">
                <button
                    onClick={() => router.push('/dashboard/attendance')}
                    className="p-5 rounded-[2rem] bg-card border border-border hover:border-info/40 hover:shadow-lg transition-all flex flex-col items-center gap-3 text-center group"
                >
                    <div className="w-12 h-12 rounded-2xl bg-info-subtle text-info-subtle-foreground flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                        <CalendarCheck size={22} />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Mi Asistencia</span>
                </button>
                {/* "Mi Finiquito" apuntaba a `/dashboard/attendance/severance`, que
                    desde ADR-012 es solo el aviso de herramienta retirada, y de ahí
                    a un módulo que el trabajador no puede abrir (`hr_employees:edit`).
                    Era un callejón sin salida: se reemplaza por su historial. */}
                <button
                    onClick={() => router.push('/dashboard/wallet/advances')}
                    className="p-5 rounded-[2rem] bg-card border border-border hover:border-primary/40 hover:shadow-lg transition-all flex flex-col items-center gap-3 text-center group"
                >
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                        <ListChecks size={22} />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Mis Adelantos</span>
                </button>
            </div>

            {/* Mis Liquidaciones */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">
                        Mis Liquidaciones
                    </h3>
                    <Badge variant="outline" className="text-[8px] font-black uppercase">
                        Documento emitido
                    </Badge>
                </div>

                {liqLoading ? (
                    <LoadingState className="rounded-[2rem] border border-dashed border-border py-8" />
                ) : liquidaciones.length === 0 ? (
                    <div className="p-8 rounded-[2rem] border border-dashed border-border text-center space-y-2">
                        <Receipt size={28} className="mx-auto text-muted-foreground" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            Aún no tienes liquidaciones emitidas
                        </p>
                        <p className="text-[10px] text-muted-foreground font-bold">
                            Aparecerán acá cuando RRHH cierre la planilla del mes.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {liquidaciones.map(({ line, run }) => (
                            <div key={line.id} className="p-5 rounded-[2rem] border border-border bg-card space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-9 h-9 rounded-xl bg-info-subtle text-info-subtle-foreground flex items-center justify-center shrink-0">
                                            <Receipt size={16} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-black text-sm truncate">{mesDe(run.periodMonth)}</p>
                                            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                                                {run.status === 'pagada'
                                                    ? `Pagada${run.paymentDate ? ` el ${run.paymentDate}` : ''}`
                                                    : 'Cerrada — pendiente de pago'}
                                            </p>
                                        </div>
                                    </div>
                                    <p className="font-black text-sm text-success shrink-0">{formatCLP(line.netPay)}</p>
                                </div>

                                <div className="grid grid-cols-4 gap-2 pt-1 border-t border-border">
                                    <div className="text-center">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Días</p>
                                        <p className="text-xs font-black">{line.workedDays}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Haberes</p>
                                        <p className="text-xs font-black">{formatCLP(line.totalEarnings)}</p>
                                    </div>
                                    {/* El guion de "no hubo" va en muted, no en rojo:
                                        en destructive se lee como un monto descontado. */}
                                    <div className="text-center">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Descuentos</p>
                                        <p className={`text-xs font-black ${line.totalDeductions > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                            {line.totalDeductions > 0 ? `- ${formatCLP(line.totalDeductions)}` : '—'}
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Anticipos</p>
                                        <p className={`text-xs font-black ${line.advancesAmount > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                            {line.advancesAmount > 0 ? `- ${formatCLP(line.advancesAmount)}` : '—'}
                                        </p>
                                    </div>
                                </div>

                                <Button
                                    variant="outline"
                                    onClick={() => descargarLiquidacion(line, run)}
                                    className="w-full rounded-xl font-black uppercase text-[10px] tracking-widest gap-2"
                                >
                                    <FileDown size={14} /> Descargar liquidación
                                </Button>
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
                                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-primary hover:underline"
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
                                            {adv.status === 'approved' && (
                                                <p className="text-[8px] text-info font-bold mt-0.5 truncate">
                                                    {adv.approverName ? `Aprobado por ${adv.approverName} · ` : ''}pendiente de transferencia
                                                </p>
                                            )}
                                            {adv.status === 'paid' && (
                                                <p className="text-[8px] text-success font-bold mt-0.5 truncate">
                                                    Depositado el {adv.paymentDate}
                                                    {adv.paymentMethod ? ` · ${adv.paymentMethod}` : ''}
                                                </p>
                                            )}
                                            {adv.rejectionReason && (
                                                <p className="text-[8px] text-destructive font-bold mt-0.5 truncate">
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
                <DialogContent className="sm:max-w-md rounded-[2rem] bg-background p-8 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black uppercase tracking-tighter">Solicitar Adelanto</DialogTitle>
                        <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Se descontará de tu liquidación a fin de mes
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-6 space-y-6">
                        <div className="text-center p-6 bg-card rounded-[2rem] shadow-sm border">
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">Monto a recibir</p>
                            <p className="text-4xl font-black text-primary">{formatCLP(requestedAmount)}</p>
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

                        <div className="p-4 bg-warning-subtle border border-warning/30 rounded-2xl flex gap-3 items-start">
                            <AlertCircle className="h-4 w-4 text-warning-subtle-foreground shrink-0 mt-0.5" />
                            <p className="text-[10px] text-warning-subtle-foreground font-bold leading-relaxed">
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
                            className="rounded-xl font-black uppercase text-[10px]"
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
