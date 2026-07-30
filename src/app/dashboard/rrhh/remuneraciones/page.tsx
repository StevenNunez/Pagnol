'use client';

// Remuneraciones F3 — listado de planillas (RFC-003 / ADR-009).
//
// Reemplaza la calculadora de `attendance/monthly-report`, que no persistía nada.
// Estados: borrador → cerrada → pagada. Solo los borradores se pueden recalcular
// o eliminar; el resto es inmutable (lo garantiza un trigger en la base).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { fetchPayrollRuns } from '@/modules/data/mutations/payrollRunMutations';
import type { PayrollRun, PayrollRunStatus } from '@/modules/core/lib/data';
import { Wallet, PlusCircle, Loader2, Trash2, ArrowRight, Lock } from 'lucide-react';

const CLP = (n: number) => new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Math.round(n || 0));

const MES = (iso: string) => {
    const [y, m] = iso.split('-');
    const nombre = new Date(Number(y), Number(m) - 1, 1)
        .toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    return nombre.charAt(0).toUpperCase() + nombre.slice(1);
};

const BADGE: Record<PayrollRunStatus, string> = {
    borrador: 'badge-warning',
    cerrada: 'badge-info',
    pagada: 'badge-success',
};

export default function RemuneracionesPage() {
    const { createPayrollRun, deletePayrollRun } = useAppState();
    const { currentTenantId, can } = useAuth();
    const { toast } = useToast();
    const router = useRouter();

    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    // Por defecto el mes ANTERIOR: una planilla se arma cuando el mes cerró.
    const [month, setMonth] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d.toISOString().slice(0, 7);
    });

    const puedeAdministrar = can('hr_employees:edit');

    const load = useCallback(async () => {
        if (!currentTenantId) return;
        setLoading(true);
        try {
            setRuns(await fetchPayrollRuns(currentTenantId));
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudieron cargar las planillas', description: e?.message });
        } finally {
            setLoading(false);
        }
    }, [currentTenantId, toast]);

    useEffect(() => { load(); }, [load]);

    const crear = async () => {
        setSaving(true);
        try {
            const run = await createPayrollRun(month);
            toast({ title: 'Planilla creada', description: `Borrador de ${MES(run.periodMonth)}.` });
            setOpen(false);
            router.push(`/dashboard/rrhh/remuneraciones/${run.id}`);
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo crear', description: e?.message });
        } finally {
            setSaving(false);
        }
    };

    const eliminar = async (run: PayrollRun) => {
        try {
            await deletePayrollRun(run.id);
            toast({ title: 'Borrador eliminado' });
            load();
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo eliminar', description: e?.message });
        }
    };

    const totales = useMemo(() => runs.reduce((acc, r) => ({
        neto: acc.neto + (r.status !== 'borrador' ? r.totalNet : 0),
        costo: acc.costo + (r.status !== 'borrador' ? r.totalEmployerCost : 0),
    }), { neto: 0, costo: 0 }), [runs]);

    return (
        <PageShell
            title="Remuneraciones"
            description="Planillas de sueldo por período. Una planilla cerrada es inmutable: corregirla es crear una nueva."
            toolbar={
                <>
                    <div className="flex gap-6">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Líquido emitido</p>
                            <p className="text-2xl font-bold">{CLP(totales.neto)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Costo empresa</p>
                            <p className="text-2xl font-bold">{CLP(totales.costo)}</p>
                        </div>
                    </div>
                    {puedeAdministrar && (
                        <Button className="rounded-[1.5rem] shadow-lg shadow-primary/10 hover:scale-105 active:scale-95"
                            onClick={() => setOpen(true)}>
                            <PlusCircle className="mr-2 h-4 w-4" />Nueva planilla
                        </Button>
                    )}
                </>
            }
        >
            <Card className="rounded-[1.5rem]">
                <CardHeader>
                    <CardTitle>Planillas</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <LoadingState />
                    ) : !runs.length ? (
                        <EmptyState
                            icon={<Wallet size={24} />}
                            title="Sin planillas todavía"
                            description="Crea la planilla del período para calcular las liquidaciones a partir de la asistencia y los contratos laborales."
                        />
                    ) : (
                        <div className="space-y-3">
                            {runs.map((r) => (
                                <div key={r.id}
                                    className="flex flex-col gap-4 rounded-[1.5rem] border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-3">
                                            <p className="text-lg font-bold">{MES(r.periodMonth)}</p>
                                            <Badge className={BADGE[r.status]}>{r.status}</Badge>
                                            {r.status !== 'borrador' && (
                                                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                                            )}
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {r.workerCount} {r.workerCount === 1 ? 'trabajador' : 'trabajadores'}
                                            {r.closedByName && ` · cerrada por ${r.closedByName}`}
                                            {r.paymentDate && ` · pagada el ${r.paymentDate}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Líquido</p>
                                            <p className="text-xl font-bold">{CLP(r.totalNet)}</p>
                                        </div>
                                        <div className="hidden text-right sm:block">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Costo empresa</p>
                                            <p className="text-xl font-bold">{CLP(r.totalEmployerCost)}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            {puedeAdministrar && r.status === 'borrador' && (
                                                <Button variant="ghost" size="icon" className="rounded-xl"
                                                    onClick={() => eliminar(r)} title="Eliminar borrador">
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            )}
                                            <Button variant="outline" className="rounded-xl"
                                                onClick={() => router.push(`/dashboard/rrhh/remuneraciones/${r.id}`)}>
                                                Abrir<ArrowRight className="ml-2 h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-[1.5rem]">
                    <DialogHeader>
                        <DialogTitle>Nueva planilla</DialogTitle>
                        <DialogDescription>
                            Se creará un borrador con los trabajadores que tengan contrato laboral
                            vigente en el período. Podrás revisarlo antes de cerrarlo.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="mes">Período</Label>
                        <Input id="mes" type="month" value={month} className="h-11 rounded-xl"
                            onChange={(e) => setMonth(e.target.value)} />
                        <p className="text-[10px] text-muted-foreground">
                            Una planilla por mes. Si ya existe, ábrela en vez de crear otra.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" className="rounded-xl" onClick={() => setOpen(false)}>Cancelar</Button>
                        <Button className="rounded-xl" disabled={saving || !month} onClick={crear}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                            Crear borrador
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}
