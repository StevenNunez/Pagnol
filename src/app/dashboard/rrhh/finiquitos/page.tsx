'use client';

// Remuneraciones F5 — listado de finiquitos (RFC-003 / ADR-012).
//
// Reemplaza la calculadora de `attendance/severance`, que no persistía nada: el
// único registro de un finiquito emitido era el PDF que quedaba en la carpeta de
// Descargas de quien lo generó.
//
// Estados: borrador → cerrado → pagado. Solo los borradores se recalculan o se
// eliminan; el resto es inmutable (trigger en la base, Art. 2).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { fetchSeverances } from '@/modules/data/mutations/severanceMutations';
import { TERMINATION_CAUSE_LABELS, type TerminationCause } from '@/modules/data/mutations/severanceMath';
import type { Severance, SeveranceStatus, User } from '@/modules/core/lib/data';
import { FileText, PlusCircle, Loader2, Trash2, ArrowRight, Lock, AlertTriangle } from 'lucide-react';

const CLP = (n: number) => new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Math.round(n || 0));

const FECHA = (iso: string) => {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
};

const BADGE: Record<SeveranceStatus, string> = {
    borrador: 'badge-warning',
    cerrado: 'badge-info',
    pagado: 'badge-success',
};

export default function FiniquitosPage() {
    const { users, proposeSeverance, saveSeveranceDraft, deleteSeveranceDraft } = useAppState();
    const { currentTenantId, can } = useAuth();
    const { toast } = useToast();
    const router = useRouter();

    const [items, setItems] = useState<Severance[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    // Formulario del borrador
    const [userId, setUserId] = useState('');
    const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [cause, setCause] = useState<TerminationCause>('necesidades_empresa');
    const [noticeGiven, setNoticeGiven] = useState(false);
    const [progressiveDays, setProgressiveDays] = useState('0');

    const puedeGestionar = can('hr_employees:edit');

    const cargar = useCallback(async () => {
        if (!currentTenantId) return;
        setLoading(true);
        try {
            setItems(await fetchSeverances(currentTenantId));
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudieron cargar los finiquitos', description: e.message });
        } finally {
            setLoading(false);
        }
    }, [currentTenantId, toast]);

    useEffect(() => { cargar(); }, [cargar]);

    const trabajadores = useMemo(
        () => (users || []).filter((u: User) => u.role !== 'guardia'),
        [users],
    );

    const crear = async () => {
        if (!userId) {
            toast({ variant: 'destructive', title: 'Selecciona un trabajador' });
            return;
        }
        setSaving(true);
        try {
            // La propuesta reúne contrato, asistencia, anticipos y la planilla del
            // mes: nada de esto se digita a mano como en la calculadora anterior.
            const p = await proposeSeverance(userId, endDate);
            if (!p.contract) {
                toast({
                    variant: 'destructive',
                    title: 'Sin contrato laboral',
                    description: 'Registra el contrato laboral del trabajador antes de finiquitarlo.',
                });
                return;
            }

            const { severance } = await saveSeveranceDraft({
                userId: p.userId,
                userName: p.userName,
                employmentContractId: p.contract.id,
                startDate: p.startDate,
                endDate,
                cause,
                noticeGiven,
                lastRemuneration: p.lastRemuneration,
                ufValue: p.ufValue,
                vacationDaysTaken: p.vacationDaysTaken,
                progressiveDays: Number(progressiveDays) || 0,
                deductions: p.pendingAdvances,
                lastPayrollRunId: p.lastPayrollRunId,
                lastPayrollNet: p.lastPayrollNet,
                holidays: p.holidays,
                contract: p.contract,
            });

            if (p.warnings.length) {
                toast({
                    title: 'Borrador creado con advertencias',
                    description: p.warnings[0],
                });
            } else {
                toast({ title: 'Borrador de finiquito creado' });
            }
            setOpen(false);
            router.push(`/dashboard/rrhh/finiquitos/${severance.id}`);
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo crear el finiquito', description: e.message });
        } finally {
            setSaving(false);
        }
    };

    const eliminar = async (s: Severance) => {
        try {
            await deleteSeveranceDraft(s.id);
            toast({ title: 'Borrador eliminado' });
            cargar();
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo eliminar', description: e.message });
        }
    };

    return (
        <PageShell
            title="Finiquitos"
            description="Cálculo, emisión y registro de finiquitos según el Código del Trabajo."
            toolbar={puedeGestionar ? (
                <div className="flex w-full justify-end">
                    <Button
                        onClick={() => setOpen(true)}
                        className="rounded-[1.5rem] shadow-lg shadow-primary/10 transition hover:scale-105 active:scale-95"
                    >
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Nuevo finiquito
                    </Button>
                </div>
            ) : undefined}
        >
            {loading ? (
                <LoadingState />
            ) : !items.length ? (
                <EmptyState
                    icon={<FileText className="h-8 w-8" />}
                    title="Sin finiquitos registrados"
                    description="Cuando termines un contrato, el finiquito queda guardado acá con su cálculo y su PDF."
                />
            ) : (
                <div className="grid gap-4">
                    {items.map((s) => (
                        <Card key={s.id} className="rounded-[1.5rem] transition hover:shadow-md">
                            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                        Término {FECHA(s.endDate)}
                                    </p>
                                    <p className="text-lg font-bold text-foreground">{s.userName}</p>
                                    <p className="text-sm text-muted-foreground">
                                        {TERMINATION_CAUSE_LABELS[s.cause as TerminationCause] || s.cause}
                                    </p>
                                    {!!s.warnings?.length && (
                                        <p className="flex items-center gap-1.5 text-xs text-warning-subtle-foreground">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            {s.warnings.length} advertencia{s.warnings.length > 1 ? 's' : ''}
                                        </p>
                                    )}
                                </div>

                                <div className="flex items-center gap-4">
                                    <div className="text-right">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                            Total
                                        </p>
                                        <p className="text-xl font-extrabold text-foreground">
                                            {CLP(s.totalSeverance)}
                                        </p>
                                    </div>
                                    <Badge className={BADGE[s.status]}>
                                        {s.status !== 'borrador' && <Lock className="mr-1 h-3 w-3" />}
                                        {s.status}
                                    </Badge>
                                    {s.status === 'borrador' && puedeGestionar && (
                                        <Button variant="ghost" size="icon" onClick={() => eliminar(s)} title="Eliminar borrador">
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    )}
                                    <Button
                                        variant="outline"
                                        onClick={() => router.push(`/dashboard/rrhh/finiquitos/${s.id}`)}
                                        className="rounded-xl"
                                    >
                                        Ver <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Nuevo finiquito</DialogTitle>
                        <DialogDescription>
                            La antigüedad, la base de cálculo, las vacaciones tomadas y los anticipos
                            pendientes se toman del sistema. Podrás revisarlos antes de cerrar.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Trabajador</Label>
                            <Select value={userId} onValueChange={setUserId}>
                                <SelectTrigger className="rounded-xl">
                                    <SelectValue placeholder="Selecciona un trabajador" />
                                </SelectTrigger>
                                <SelectContent>
                                    {trabajadores.map((u: User) => (
                                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Fecha de término</Label>
                            <Input
                                type="date" value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="rounded-xl"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Causal de término</Label>
                            <Select value={cause} onValueChange={(v) => setCause(v as TerminationCause)}>
                                <SelectTrigger className="rounded-xl">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(TERMINATION_CAUSE_LABELS).map(([k, label]) => (
                                        <SelectItem key={k} value={k}>{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {(cause === 'necesidades_empresa' || cause === 'desahucio') && (
                            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3">
                                <Checkbox
                                    id="notice"
                                    checked={noticeGiven}
                                    onCheckedChange={(v) => setNoticeGiven(!!v)}
                                />
                                <Label htmlFor="notice" className="text-sm font-normal">
                                    Se dio el aviso de 30 días (si no, se paga la indemnización sustitutiva)
                                </Label>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Días de feriado progresivo acreditados</Label>
                            <Input
                                type="number" min="0" step="1" value={progressiveDays}
                                onChange={(e) => setProgressiveDays(e.target.value)}
                                className="rounded-xl"
                            />
                            <p className="text-xs text-muted-foreground">
                                Art. 68: requiere acreditar 10 años trabajados con uno o más empleadores.
                                Como los empleadores anteriores no constan en el sistema, este dato lo
                                declara RRHH con los certificados a la vista.
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button onClick={crear} disabled={saving || !userId}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Calcular y guardar borrador
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}
