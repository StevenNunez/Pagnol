'use client';

// Remuneraciones F5 — detalle de un finiquito (RFC-003 / ADR-012).
//
// Un borrador se puede recalcular y eliminar; cerrado y pagado son inmutables
// (Art. 2, garantizado por trigger). Cerrar emite el costo al ledger; marcar el
// pago apaga la obligación y emite el hecho `paid`.

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { LoadingState } from '@/components/loading-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { supabase } from '@/modules/core/lib/supabase';
import { mapSeverance } from '@/modules/data/mutations/severanceMutations';
import { TERMINATION_CAUSE_LABELS, type TerminationCause } from '@/modules/data/mutations/severanceMath';
import { descargarFiniquitoPdf } from '@/lib/finiquito-pdf';
import type { Severance, SeveranceStatus, User } from '@/modules/core/lib/data';
import {
    ArrowLeft, FileDown, Lock, Loader2, AlertTriangle, CheckCircle2, Banknote,
} from 'lucide-react';

const CLP = (n: number) => new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Math.round(n || 0));

const FECHA = (iso?: string | null) => {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
};

const BADGE: Record<SeveranceStatus, string> = {
    borrador: 'badge-warning',
    cerrado: 'badge-info',
    pagado: 'badge-success',
};

function Linea({ label, detalle, monto, fuerte }: {
    label: string; detalle?: string; monto: number; fuerte?: boolean;
}) {
    return (
        <div className={`flex items-center justify-between gap-4 rounded-xl px-4 py-3 ${fuerte ? 'bg-muted' : ''}`}>
            <div>
                <p className={`text-sm ${fuerte ? 'font-bold text-foreground' : 'text-foreground'}`}>{label}</p>
                {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
            </div>
            <p className={`shrink-0 tabular-nums ${fuerte ? 'text-base font-extrabold' : 'font-semibold'}`}>
                {CLP(monto)}
            </p>
        </div>
    );
}

export default function FiniquitoDetallePage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { toast } = useToast();
    const { users, currentTenant, closeSeverance, markSeverancePaid } = useAppState();
    const { can } = useAuth();

    const [s, setS] = useState<Severance | null>(null);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [payOpen, setPayOpen] = useState(false);
    const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));

    const puedeGestionar = can('hr_employees:edit');

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from('severances').select('*').eq('id', id).single();
            if (error) throw error;
            setS(mapSeverance(data));
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo cargar el finiquito', description: e.message });
        } finally {
            setLoading(false);
        }
    }, [id, toast]);

    useEffect(() => { cargar(); }, [cargar]);

    const cerrar = async () => {
        setWorking(true);
        try {
            const r = await closeSeverance(id);
            setS(r);
            toast({
                title: 'Finiquito cerrado',
                description: 'El costo quedó registrado en el dominio financiero.',
            });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo cerrar', description: e.message });
        } finally {
            setWorking(false);
        }
    };

    const pagar = async () => {
        setWorking(true);
        try {
            const r = await markSeverancePaid(id, paymentDate);
            setS(r);
            setPayOpen(false);
            toast({ title: 'Finiquito marcado como pagado' });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo registrar el pago', description: e.message });
        } finally {
            setWorking(false);
        }
    };

    const descargar = () => {
        if (!s) return;
        const worker = (users || []).find((u: User) => u.id === s.userId);
        descargarFiniquitoPdf({
            severance: s,
            tenant: {
                name: currentTenant?.name || '',
                rut: (currentTenant as any)?.rut || null,
                address: (currentTenant as any)?.address || null,
            },
            workerRut: worker?.rut || null,
            cargo: (worker as any)?.cargo || worker?.role || null,
        });
    };

    if (loading) return <PageShell title="Finiquito"><LoadingState /></PageShell>;
    if (!s) return <PageShell title="Finiquito"><p className="text-muted-foreground">No encontrado.</p></PageShell>;

    return (
        <PageShell
            title={`Finiquito · ${s.userName}`}
            description={TERMINATION_CAUSE_LABELS[s.cause as TerminationCause] || s.cause}
            toolbar={(
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                    <Button variant="ghost" onClick={() => router.push('/dashboard/rrhh/finiquitos')}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                    </Button>
                    <div className="flex flex-wrap items-center gap-3">
                        <Badge className={BADGE[s.status]}>
                            {s.status !== 'borrador' && <Lock className="mr-1 h-3 w-3" />}
                            {s.status}
                        </Badge>
                        <Button variant="outline" onClick={descargar} className="rounded-xl">
                            <FileDown className="mr-2 h-4 w-4" /> Descargar PDF
                        </Button>
                        {s.status === 'borrador' && puedeGestionar && (
                            <Button onClick={cerrar} disabled={working} className="rounded-[1.5rem]">
                                {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Cerrar finiquito
                            </Button>
                        )}
                        {s.status === 'cerrado' && puedeGestionar && (
                            <Button onClick={() => setPayOpen(true)} disabled={working} className="rounded-[1.5rem]">
                                <Banknote className="mr-2 h-4 w-4" /> Marcar como pagado
                            </Button>
                        )}
                    </div>
                </div>
            )}
        >
            {!!s.warnings?.length && (
                <Card className="rounded-[1.5rem] border-warning/40 bg-warning-subtle/40">
                    <CardContent className="space-y-2 p-5">
                        <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            <AlertTriangle className="h-3.5 w-3.5" /> Revisar antes de cerrar
                        </p>
                        {s.warnings.map((w, i) => (
                            <p key={i} className="text-sm text-foreground">• {w}</p>
                        ))}
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="rounded-[1.5rem] lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Detalle del finiquito</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                        {s.indemnityYears > 0 && (
                            <Linea
                                label="Indemnización por años de servicio"
                                detalle={`${s.indemnifiableYears} año(s) × ${CLP(s.cappedBase)}`}
                                monto={s.indemnityYears}
                            />
                        )}
                        {s.indemnityNotice > 0 && (
                            <Linea
                                label="Indemnización sustitutiva del aviso previo"
                                detalle="Un mes de remuneración"
                                monto={s.indemnityNotice}
                            />
                        )}
                        <Linea
                            label="Feriado proporcional"
                            detalle={`${s.vacationDaysHabiles.toFixed(2)} días hábiles = ${s.vacationDaysCorridos.toFixed(2)} días corridos`}
                            monto={s.vacationPay}
                        />
                        {s.lastPayrollNet > 0 && (
                            <Linea
                                label="Liquidación del último mes"
                                detalle="Tomada de la planilla del período"
                                monto={s.lastPayrollNet}
                            />
                        )}
                        <Linea label="Total haberes" monto={s.totalEarnings} fuerte />

                        {(s.deductions || []).map((d, i) => (
                            <Linea key={i} label={d.name} monto={-d.amount} />
                        ))}

                        <div className="mt-4 flex items-center justify-between border-t pt-4">
                            <span className="text-lg font-bold text-primary">TOTAL A PAGAR</span>
                            <span className="text-2xl font-extrabold text-primary tabular-nums">
                                {CLP(s.totalSeverance)}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-[1.5rem]">
                    <CardHeader>
                        <CardTitle>Antecedentes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        {[
                            ['Ingreso', FECHA(s.startDate)],
                            ['Término', FECHA(s.endDate)],
                            ['Antigüedad', `${s.yearsOfService} año(s)`],
                            ['Base de cálculo', CLP(s.cappedBase)],
                            ['Aviso previo', s.noticeGiven ? 'Sí se dio' : 'No se dio'],
                            ['Vacaciones tomadas', `${s.vacationDaysTaken} día(s)`],
                            ['Feriado progresivo', `${s.progressiveDays} día(s)`],
                            ['Cerrado por', s.closedByName || '—'],
                            ['Fecha de pago', FECHA(s.paymentDate)],
                        ].map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3">
                                <span className="text-muted-foreground">{k}</span>
                                <span className="text-right font-medium text-foreground">{v}</span>
                            </div>
                        ))}
                        {s.cappedBase < s.lastRemuneration && (
                            <p className="rounded-xl bg-info-subtle p-3 text-xs text-info-subtle-foreground">
                                La remuneración ({CLP(s.lastRemuneration)}) supera las 90 UF: las
                                indemnizaciones se calcularon sobre ese tope (art. 172).
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={payOpen} onOpenChange={setPayOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Registrar el pago</DialogTitle>
                        <DialogDescription>
                            Apaga la obligación en el flujo de caja y registra el egreso en la fecha
                            en que salió la plata.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label>Fecha de pago</Label>
                        <Input
                            type="date" value={paymentDate}
                            onChange={(e) => setPaymentDate(e.target.value)}
                            className="rounded-xl"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPayOpen(false)} disabled={working}>
                            Cancelar
                        </Button>
                        <Button onClick={pagar} disabled={working}>
                            {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirmar pago
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}
