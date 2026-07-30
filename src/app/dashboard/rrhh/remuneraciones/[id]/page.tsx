'use client';

// Remuneraciones F3 — detalle de la planilla (RFC-003 / ADR-009).
//
// Un borrador se arma desde la propuesta (contratos vigentes + asistencia +
// anticipos pendientes), se ajusta y se guarda. Al cerrar queda inmutable.
//
// Las horas extra empiezan en 0 A PROPÓSITO: requieren autorización, no salen de
// un reloj. Las liquidaciones reales muestran 27/40/31 horas que alguien aprobó.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    fetchPayrollRuns, fetchPayrollLines,
    type PayrollProposal, type PayrollLineInput,
} from '@/modules/data/mutations/payrollRunMutations';
import type { PayrollRun, PayrollLine } from '@/modules/core/lib/data';
import type { PayrollResult } from '@/modules/data/mutations/payrollMath';
import { buildLiquidacionPdf, liquidacionFileName } from '@/lib/liquidacion-pdf';
import {
    Users, Loader2, Lock, Save, CheckCircle2, Banknote, AlertTriangle, RefreshCw, FileDown,
} from 'lucide-react';

const CLP = (n: number) => new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Math.round(n || 0));

const MES = (iso: string) => {
    const [y, m] = iso.split('-');
    const nombre = new Date(Number(y), Number(m) - 1, 1)
        .toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    return nombre.charAt(0).toUpperCase() + nombre.slice(1);
};

export default function PlanillaDetallePage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const {
        proposePayrollLines, savePayrollDraft, closePayrollRun, markPayrollRunPaid,
    } = useAppState();
    const { currentTenantId, can } = useAuth();
    const { currentTenant, users } = useAppState();
    const { toast } = useToast();

    const [run, setRun] = useState<PayrollRun | null>(null);
    const [lines, setLines] = useState<PayrollLine[]>([]);
    const [proposal, setProposal] = useState<PayrollProposal | null>(null);
    const [draft, setDraft] = useState<PayrollLineInput[]>([]);
    const [results, setResults] = useState<Record<string, PayrollResult>>({});
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [payOpen, setPayOpen] = useState(false);
    const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));

    const puedeAdministrar = can('hr_employees:edit');
    const esBorrador = run?.status === 'borrador';

    const load = useCallback(async () => {
        if (!currentTenantId || !id) return;
        setLoading(true);
        try {
            const all = await fetchPayrollRuns(currentTenantId);
            const found = all.find((r) => r.id === id) || null;
            setRun(found);
            if (!found) return;
            setLines(await fetchPayrollLines(id));
            // La propuesta solo hace falta para un borrador: una planilla cerrada
            // muestra lo que guardó, no recalcula (ADR-009).
            if (found.status === 'borrador' && puedeAdministrar) {
                const p = await proposePayrollLines(found.periodMonth);
                setProposal(p);
                setDraft(p.lines);
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo cargar la planilla', description: e?.message });
        } finally {
            setLoading(false);
        }
    }, [currentTenantId, id, puedeAdministrar, proposePayrollLines, toast]);

    useEffect(() => { load(); }, [load]);

    // Si el borrador ya tenía líneas guardadas, se respetan los valores editados
    // en vez de volver a la propuesta en cero.
    useEffect(() => {
        if (!esBorrador || !proposal || !lines.length) return;
        setDraft((prev) => prev.map((l) => {
            const guardada = lines.find((x) => x.userId === l.userId);
            if (!guardada) return l;
            const snap: any = guardada.inputSnapshot || {};
            return {
                ...l,
                workedDays: guardada.workedDays,
                overtimeHours: guardada.overtimeHours,
                taxableEarnings: snap.taxableEarnings || [],
                nonTaxableEarnings: snap.nonTaxableEarnings || [],
                otherDeductions: snap.otherDeductions || [],
            };
        }));
    }, [esBorrador, proposal, lines]);

    const setLineField = (userId: string, field: keyof PayrollLineInput, value: any) => {
        setDraft((prev) => prev.map((l) => (l.userId === userId ? { ...l, [field]: value } : l)));
    };

    const guardar = async () => {
        if (!run || !proposal?.parameters) {
            toast({ variant: 'destructive', title: 'Faltan los parámetros legales del período.' });
            return;
        }
        setBusy('save');
        try {
            const { run: updated, results: res } = await savePayrollDraft(run.id, {
                lines: draft,
                parameters: proposal.parameters,
                afps: proposal.afps,
                contracts: proposal.contracts,
                ufValue: proposal.ufValue,
                utmValue: proposal.utmValue,
            });
            setRun(updated);
            setResults(res);
            setLines(await fetchPayrollLines(run.id));
            toast({ title: 'Borrador calculado', description: `${updated.workerCount} liquidaciones · líquido ${CLP(updated.totalNet)}.` });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo calcular', description: e?.message });
        } finally {
            setBusy(null);
        }
    };

    const cerrar = async () => {
        if (!run || !proposal?.parameters) return;
        setBusy('close');
        try {
            const updated = await closePayrollRun(run.id, proposal.parameters);
            setRun(updated);
            setProposal(null);
            toast({
                title: 'Planilla cerrada',
                description: 'Las liquidaciones quedaron emitidas. Corregirla es crear una planilla nueva.',
            });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo cerrar', description: e?.message });
        } finally {
            setBusy(null);
        }
    };

    const pagar = async () => {
        if (!run) return;
        setBusy('pay');
        try {
            const updated = await markPayrollRunPaid(run.id, paymentDate);
            setRun(updated);
            setPayOpen(false);
            toast({ title: 'Planilla pagada', description: `Fecha de pago: ${paymentDate}.` });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo marcar como pagada', description: e?.message });
        } finally {
            setBusy(null);
        }
    };

    /**
     * PDF de la liquidación. Se dibuja desde el SNAPSHOT de la línea, no
     * recalculando: el documento dice lo que se emitió aunque las tasas hayan
     * cambiado después.
     */
    const descargarPdf = (line: PayrollLine) => {
        if (!run) return;
        try {
            const perfil = (users || []).find((u) => u.id === line.userId);
            const doc = buildLiquidacionPdf({
                line,
                run,
                tenant: { name: currentTenant?.name || '—', rut: (currentTenant as any)?.rut || null },
                workerRut: perfil?.rut || null,
                cargo: perfil?.cargo || null,
            });
            doc.save(liquidacionFileName(line, run));
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo generar el PDF', description: e?.message });
        }
    };

    // Vista previa del borrador: lo que devolvió el último cálculo, si hay
    const avisos = useMemo(() => {
        const todos = new Set<string>();
        for (const r of Object.values(results)) r.warnings.forEach((w) => todos.add(w));
        for (const l of lines) (l.warnings || []).forEach((w) => todos.add(w));
        proposal?.warnings.forEach((w) => todos.add(w));
        return [...todos];
    }, [results, lines, proposal]);

    if (loading) return <LoadingState />;
    if (!run) {
        return (
            <PageShell title="Planilla" description="">
                <EmptyState icon={<Users size={24} />} title="Planilla no encontrada"
                    description="Puede haber sido eliminada, o no tienes permiso para verla." />
            </PageShell>
        );
    }

    return (
        <PageShell
            title={`Planilla ${MES(run.periodMonth)}`}
            description={
                esBorrador
                    ? 'Borrador: ajusta días, horas extra y haberes, y vuelve a calcular hasta que cuadre.'
                    : 'Planilla cerrada: los montos son inmutables.'
            }
            toolbar={
                <>
                    <div className="flex flex-wrap gap-6">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Estado</p>
                            <Badge className={run.status === 'pagada' ? 'badge-success' : run.status === 'cerrada' ? 'badge-info' : 'badge-warning'}>
                                {run.status}
                            </Badge>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Imponible</p>
                            <p className="text-xl font-bold">{CLP(run.totalTaxable)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Líquido</p>
                            <p className="text-xl font-bold">{CLP(run.totalNet)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Costo empresa</p>
                            <p className="text-xl font-bold">{CLP(run.totalEmployerCost)}</p>
                        </div>
                    </div>
                    {puedeAdministrar && (
                        <div className="flex gap-2">
                            {esBorrador && (
                                <>
                                    <Button variant="outline" className="rounded-xl" onClick={load} disabled={!!busy}>
                                        <RefreshCw className="mr-2 h-4 w-4" />Recargar
                                    </Button>
                                    <Button variant="outline" className="rounded-xl" onClick={guardar} disabled={!!busy}>
                                        {busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                        Calcular
                                    </Button>
                                    <Button className="rounded-[1.5rem]" onClick={cerrar} disabled={!!busy || !run.workerCount}>
                                        {busy === 'close' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                        Cerrar planilla
                                    </Button>
                                </>
                            )}
                            {run.status === 'cerrada' && (
                                <Button className="rounded-[1.5rem]" onClick={() => setPayOpen(true)} disabled={!!busy}>
                                    <Banknote className="mr-2 h-4 w-4" />Marcar pagada
                                </Button>
                            )}
                        </div>
                    )}
                </>
            }
        >
            {!!avisos.length && (
                <Card className="rounded-[1.5rem] border-warning/40 bg-warning-subtle">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base text-warning-subtle-foreground">
                            <AlertTriangle className="h-4 w-4" />Revisa antes de cerrar
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-1 text-sm text-warning-subtle-foreground">
                            {avisos.map((a) => <li key={a}>· {a}</li>)}
                        </ul>
                    </CardContent>
                </Card>
            )}

            {!!proposal?.withoutContract.length && (
                <Card className="rounded-[1.5rem] border-destructive/40">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Con asistencia pero sin contrato laboral</CardTitle>
                        <CardDescription>
                            No se liquidan: falta registrar su Contrato Laboral en la ficha del empleado.
                            Liquidarlos con datos incompletos daría un número inventado.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        {proposal.withoutContract.map((w) => (
                            <Badge key={w.userId} variant="outline" className="rounded-xl">{w.userName}</Badge>
                        ))}
                    </CardContent>
                </Card>
            )}

            <Card className="rounded-[1.5rem]">
                <CardHeader>
                    <CardTitle>{esBorrador ? 'Trabajadores del período' : 'Liquidaciones emitidas'}</CardTitle>
                    <CardDescription>
                        {esBorrador
                            ? 'Las horas extra parten en 0: se ingresan las autorizadas, no las que sugiere el reloj.'
                            : `Cerrada por ${run.closedByName || '—'}${run.paymentDate ? ` · pagada el ${run.paymentDate}` : ''}.`}
                    </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {esBorrador ? (
                        !draft.length ? (
                            <EmptyState icon={<Users size={24} />} title="Nadie con contrato laboral vigente"
                                description="Registra el Contrato Laboral de los trabajadores en su ficha para poder liquidarlos." />
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Trabajador</TableHead>
                                        <TableHead className="w-28">Días</TableHead>
                                        <TableHead className="w-32">Horas extra</TableHead>
                                        <TableHead className="w-40">Anticipos</TableHead>
                                        <TableHead className="text-right">Líquido</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {draft.map((l) => {
                                        const res = results[l.userId];
                                        return (
                                            <TableRow key={l.userId}>
                                                <TableCell className="font-medium">{l.userName}</TableCell>
                                                <TableCell>
                                                    <Input type="number" min={0} max={31} value={l.workedDays}
                                                        className="h-10 w-20 rounded-xl"
                                                        onChange={(e) => setLineField(l.userId, 'workedDays', Number(e.target.value))} />
                                                </TableCell>
                                                <TableCell>
                                                    <Input type="number" min={0} step="0.5" value={l.overtimeHours}
                                                        className="h-10 w-24 rounded-xl"
                                                        onChange={(e) => setLineField(l.userId, 'overtimeHours', Number(e.target.value))} />
                                                </TableCell>
                                                <TableCell>
                                                    {l.advancesAmount
                                                        ? <span className="text-sm">{CLP(l.advancesAmount)}</span>
                                                        : <span className="text-xs text-muted-foreground">—</span>}
                                                </TableCell>
                                                <TableCell className="text-right font-bold">
                                                    {res ? CLP(res.netPay) : <span className="text-xs text-muted-foreground">sin calcular</span>}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )
                    ) : !lines.length ? (
                        <EmptyState icon={<Users size={24} />} title="Sin líneas" description="Esta planilla se cerró sin trabajadores." />
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Trabajador</TableHead>
                                    <TableHead className="text-right">Imponible</TableHead>
                                    <TableHead className="text-right">Descuentos</TableHead>
                                    <TableHead className="text-right">Anticipos</TableHead>
                                    <TableHead className="text-right">Líquido</TableHead>
                                    <TableHead className="w-16" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {lines.map((l) => (
                                    <TableRow key={l.id}>
                                        <TableCell className="font-medium">
                                            {l.userName}
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                {l.workedDays} días{l.overtimeHours ? ` · ${l.overtimeHours} h extra` : ''}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">{CLP(l.totalTaxable)}</TableCell>
                                        <TableCell className="text-right text-destructive">{CLP(l.totalDeductions)}</TableCell>
                                        <TableCell className="text-right">{l.advancesAmount ? CLP(l.advancesAmount) : '—'}</TableCell>
                                        <TableCell className="text-right font-bold">{CLP(l.netPay)}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" className="rounded-xl"
                                                title="Descargar liquidación" onClick={() => descargarPdf(l)}>
                                                <FileDown className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {run.status !== 'borrador' && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" />
                    Los montos de esta planilla no se pueden modificar. La base de datos lo impide,
                    no solo la interfaz.
                </p>
            )}

            <Dialog open={payOpen} onOpenChange={setPayOpen}>
                <DialogContent className="rounded-[1.5rem]">
                    <DialogHeader>
                        <DialogTitle>Marcar planilla como pagada</DialogTitle>
                        <DialogDescription>
                            La fecha de pago es la que verá el flujo de caja. Una vez pagada, la
                            planilla no admite ningún cambio.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="fecha">Fecha de pago</Label>
                        <Input id="fecha" type="date" value={paymentDate} className="h-11 rounded-xl"
                            onChange={(e) => setPaymentDate(e.target.value)} />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" className="rounded-xl" onClick={() => setPayOpen(false)}>Cancelar</Button>
                        <Button className="rounded-xl" disabled={busy === 'pay' || !paymentDate} onClick={pagar}>
                            {busy === 'pay' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
                            Confirmar pago
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}
