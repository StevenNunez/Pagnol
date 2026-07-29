'use client';

// Contrato Laboral del trabajador (Remuneraciones F1 — RFC-003).
//
// OJO CON EL NOMBRE: en Pagnol un "Contrato" es el contrato de OBRA con el
// cliente. Esto es el contrato LABORAL, y por eso en la UI siempre se nombra
// completo. Vive dentro del UserPanel, que es la superficie única de edición
// del trabajador.
//
// Append-only: un anexo (cambio de sueldo, de AFP, de jornada) es una VERSIÓN
// NUEVA con su fecha de vigencia, no una edición. Así, liquidar marzo con las
// condiciones de marzo sale del propio esquema.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import {
    fetchEmploymentContracts, fetchAfpRates, contractAt,
} from '@/modules/data/mutations/payrollMutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/modules/core/hooks/use-toast';
import type {
    EmploymentContract, AfpRate, EmploymentContractType, SalaryMode, HealthSystem,
} from '@/modules/core/lib/data';
import { FileSignature, PlusCircle, Loader2, History, AlertTriangle } from 'lucide-react';

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const labelCls = 'text-[10px] font-black uppercase tracking-widest text-muted-foreground';

const TYPE_LABEL: Record<string, string> = {
    indefinido: 'Indefinido', plazo_fijo: 'Plazo fijo', por_obra: 'Por obra',
};
const MODE_LABEL: Record<string, string> = {
    monthly: 'Mensual', daily: 'Por día trabajado',
};

const today = () => new Date().toISOString().slice(0, 10);

export function EmploymentContractSection({ userId, canEdit }: { userId: string; canEdit: boolean }) {
    const { addEmploymentContract } = useAppState();
    const { toast } = useToast();

    const [contracts, setContracts] = useState<EmploymentContract[]>([]);
    const [afps, setAfps] = useState<AfpRate[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    interface FormState {
        effectiveFrom: string;
        contractType: EmploymentContractType;
        contractEndDate: string;
        salaryMode: SalaryMode;
        baseSalary: string;
        workSchedule: string;
        weeklyHours: string;
        afpName: string;
        healthSystem: HealthSystem;
        healthPlanUf: string;
        familyCharges: string;
        hasGratification: boolean;
        notes: string;
    }
    const empty: FormState = {
        effectiveFrom: today(),
        contractType: 'indefinido',
        contractEndDate: '',
        salaryMode: 'monthly',
        baseSalary: '',
        workSchedule: '',
        weeklyHours: '44',
        afpName: '',
        healthSystem: 'fonasa',
        healthPlanUf: '',
        familyCharges: '0',
        hasGratification: true,
        notes: '',
    };
    const [form, setForm] = useState<FormState>(empty);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [cs, as] = await Promise.all([fetchEmploymentContracts(userId), fetchAfpRates()]);
            setContracts(cs);
            setAfps(as);
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo cargar el contrato laboral', description: e?.message });
        } finally {
            setLoading(false);
        }
    }, [userId, toast]);

    useEffect(() => { load(); }, [load]);

    const current = useMemo(() => contractAt(contracts, today()), [contracts]);

    const save = async () => {
        setSaving(true);
        try {
            await addEmploymentContract({
                userId,
                effectiveFrom: form.effectiveFrom,
                contractType: form.contractType,
                contractEndDate: form.contractType === 'indefinido' ? null : (form.contractEndDate || null),
                salaryMode: form.salaryMode,
                baseSalary: Number(form.baseSalary),
                workSchedule: form.workSchedule || null,
                weeklyHours: Number(form.weeklyHours) || 44,
                afpName: form.afpName || null,
                healthSystem: form.healthSystem,
                healthPlanUf: form.healthSystem === 'isapre' ? Number(form.healthPlanUf) : null,
                familyCharges: Number(form.familyCharges) || 0,
                hasGratification: form.hasGratification,
                notes: form.notes || null,
            });
            toast({
                title: contracts.length ? 'Anexo registrado' : 'Contrato laboral registrado',
                description: `Rige desde ${form.effectiveFrom}. Las versiones anteriores se conservan.`,
            });
            setOpen(false);
            setForm(empty);
            await load();
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo guardar', description: e?.message || 'Error desconocido.' });
        } finally {
            setSaving(false);
        }
    };

    const isIsapre = form.healthSystem === 'isapre';
    const needsEnd = form.contractType !== 'indefinido';
    const canSave = !!form.effectiveFrom && Number(form.baseSalary) > 0
        && (!isIsapre || Number(form.healthPlanUf) > 0)
        && (!needsEnd || !!form.contractEndDate);

    return (
        <div className="mt-8 pt-6 border-t space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <Label className={labelCls}>Contrato Laboral</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                        Condiciones previsionales para liquidar. Un anexo es una versión nueva: las anteriores se conservan.
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {contracts.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => setShowHistory(true)}>
                            <History className="mr-2 h-3.5 w-3.5" />{contracts.length} versiones
                        </Button>
                    )}
                    {canEdit && (
                        <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setOpen(true)}>
                            <PlusCircle className="mr-2 h-3.5 w-3.5" />{contracts.length ? 'Nuevo anexo' : 'Registrar'}
                        </Button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                    <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
                </div>
            ) : !current ? (
                <div className="flex items-start gap-2 rounded-xl border border-warning/40 p-4 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                    <div>
                        <p className="font-medium">Sin contrato laboral registrado</p>
                        <p className="text-xs text-muted-foreground">
                            Sin él no se puede liquidar: falta AFP, sistema de salud y tipo de contrato.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <Item label="Vigente desde" value={current.effectiveFrom} />
                    <Item label="Tipo" value={
                        <>{TYPE_LABEL[current.contractType]}
                            {current.contractEndDate && <span className="block text-xs text-muted-foreground">hasta {current.contractEndDate}</span>}</>
                    } />
                    <Item label="Modalidad" value={MODE_LABEL[current.salaryMode]} />
                    <Item label={current.salaryMode === 'daily' ? 'Valor día' : 'Sueldo base'} value={CLP.format(current.baseSalary)} />
                    <Item label="AFP" value={current.afpName || <span className="text-warning">sin definir</span>} />
                    <Item label="Salud" value={
                        current.healthSystem === 'isapre'
                            ? <>Isapre <span className="text-xs text-muted-foreground">({current.healthPlanUf} UF)</span></>
                            : 'Fonasa'
                    } />
                    <Item label="Jornada" value={`${current.weeklyHours} h/sem${current.workSchedule ? ` · ${current.workSchedule}` : ''}`} />
                    <Item label="Cargas / Gratif." value={`${current.familyCharges} · ${current.hasGratification ? 'art. 50' : 'no aplica'}`} />
                </div>
            )}

            {/* Alta / anexo */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{contracts.length ? 'Nuevo anexo de contrato' : 'Registrar contrato laboral'}</DialogTitle>
                        <DialogDescription>
                            {contracts.length
                                ? 'Las condiciones anteriores se conservan: una liquidación pasada se sigue calculando con las suyas.'
                                : 'Estas condiciones son la base del cálculo de remuneraciones.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Rige desde">
                            <Input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className="h-11 rounded-xl" />
                        </Field>
                        <Field label="Tipo de contrato">
                            <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value as any })}
                                className="h-11 w-full rounded-xl border bg-background px-3 text-sm">
                                <option value="indefinido">Indefinido</option>
                                <option value="plazo_fijo">Plazo fijo</option>
                                <option value="por_obra">Por obra o faena</option>
                            </select>
                        </Field>
                        {needsEnd && (
                            <Field label="Fecha de término">
                                <Input type="date" value={form.contractEndDate} onChange={(e) => setForm({ ...form, contractEndDate: e.target.value })} className="h-11 rounded-xl" />
                            </Field>
                        )}
                        <Field label="Modalidad de sueldo">
                            <select value={form.salaryMode} onChange={(e) => setForm({ ...form, salaryMode: e.target.value as any })}
                                className="h-11 w-full rounded-xl border bg-background px-3 text-sm">
                                <option value="monthly">Mensual</option>
                                <option value="daily">Por día trabajado</option>
                            </select>
                        </Field>
                        <Field label={form.salaryMode === 'daily' ? 'Valor día ($)' : 'Sueldo base mensual ($)'}>
                            <Input type="number" min={1} value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} className="h-11 rounded-xl" />
                        </Field>
                        <Field label="AFP">
                            <select value={form.afpName} onChange={(e) => setForm({ ...form, afpName: e.target.value })}
                                className="h-11 w-full rounded-xl border bg-background px-3 text-sm">
                                <option value="">Seleccionar…</option>
                                {afps.map((a) => (
                                    <option key={a.id} value={a.name}>{a.name} — {a.commissionRate}% comisión</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Sistema de salud">
                            <select value={form.healthSystem} onChange={(e) => setForm({ ...form, healthSystem: e.target.value as any })}
                                className="h-11 w-full rounded-xl border bg-background px-3 text-sm">
                                <option value="fonasa">Fonasa</option>
                                <option value="isapre">Isapre</option>
                            </select>
                        </Field>
                        {isIsapre && (
                            <Field label="Plan pactado (UF)">
                                <Input type="number" step="0.01" min={0} value={form.healthPlanUf} onChange={(e) => setForm({ ...form, healthPlanUf: e.target.value })} className="h-11 rounded-xl" />
                                <p className="text-[10px] text-muted-foreground mt-1">El 7% legal es el piso; si el plan vale más, la diferencia la paga el trabajador.</p>
                            </Field>
                        )}
                        <Field label="Horas semanales">
                            <Input type="number" min={1} max={45} value={form.weeklyHours} onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} className="h-11 rounded-xl" />
                        </Field>
                        <Field label="Jornada (texto)">
                            <Input placeholder="Ej: 7x7, L-V 08:00-18:00" value={form.workSchedule} onChange={(e) => setForm({ ...form, workSchedule: e.target.value })} className="h-11 rounded-xl" />
                        </Field>
                        <Field label="Cargas familiares">
                            <Input type="number" min={0} value={form.familyCharges} onChange={(e) => setForm({ ...form, familyCharges: e.target.value })} className="h-11 rounded-xl" />
                        </Field>
                        <Field label="Gratificación">
                            <select value={form.hasGratification ? 'si' : 'no'} onChange={(e) => setForm({ ...form, hasGratification: e.target.value === 'si' })}
                                className="h-11 w-full rounded-xl border bg-background px-3 text-sm">
                                <option value="si">Art. 50 — 25% con tope</option>
                                <option value="no">No aplica</option>
                            </select>
                        </Field>
                        <Field label="Notas" full>
                            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-xl" placeholder="Ej: anexo por reajuste anual" />
                        </Field>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" className="rounded-xl" onClick={() => setOpen(false)}>Cancelar</Button>
                        <Button type="button" className="rounded-xl" disabled={saving || !canSave} onClick={save}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSignature className="mr-2 h-4 w-4" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Historial */}
            <Dialog open={showHistory} onOpenChange={setShowHistory}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Historial del contrato laboral</DialogTitle>
                        <DialogDescription>Cada anexo se conserva: una liquidación pasada usa las condiciones de su fecha.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[50vh] overflow-y-auto space-y-2">
                        {contracts.map((c) => (
                            <div key={c.id} className="flex items-start justify-between gap-3 border rounded-xl p-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">
                                        Desde {c.effectiveFrom}
                                        {c.id === current?.id && <Badge className="badge-success ml-2">vigente</Badge>}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {TYPE_LABEL[c.contractType]} · {MODE_LABEL[c.salaryMode]} · {CLP.format(c.baseSalary)}
                                        {c.afpName ? ` · ${c.afpName}` : ''}
                                    </p>
                                    {c.notes && <p className="text-xs text-muted-foreground italic">{c.notes}</p>}
                                </div>
                                <div className="text-right shrink-0 text-[10px] text-muted-foreground">
                                    <div>{new Date(c.createdAt as any).toLocaleDateString('es-CL')}</div>
                                    <div>{c.createdByName}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <p className={labelCls}>{label}</p>
            <p className="mt-0.5">{value}</p>
        </div>
    );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
    return (
        <div className={`space-y-1.5 ${full ? 'md:col-span-2' : ''}`}>
            <Label className={labelCls}>{label}</Label>
            {children}
        </div>
    );
}
