"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
    Check, X, Loader2, Search, Clock, ShieldQuestion, ArrowRight, PackageCheck, ChevronDown, HandHelping,
} from 'lucide-react';
import type { Material, User } from '@/modules/core/lib/data';
import {
    CompatibleMaterialRequest, RequestItemsList, RequestStatusBadge,
    canApproveClass, formatDateTime, daysSince, toDate, requestItems,
} from './request-shared';
import { withdrawalQueues, deliveryHref } from './withdrawal-queues';

/** Los pasos del retiro en el pañol, en el orden en que se hacen. */
export type WithdrawalStep = 'toApprove' | 'toDeliver' | 'delivered' | 'rejected';

const STEP_CHIPS: { key: WithdrawalStep; label: string }[] = [
    { key: 'toApprove', label: '1 · Por aprobar' },
    { key: 'toDeliver', label: '2 · Por entregar' },
    { key: 'delivered', label: 'Entregadas' },
    { key: 'rejected', label: 'Rechazadas' },
];

const EMPTY: Record<WithdrawalStep, { title: string; description?: string }> = {
    toApprove: { title: '¡Todo al día!', description: 'No hay retiros esperando aprobación.' },
    toDeliver: { title: 'Nada por entregar', description: 'Cuando apruebes un despacho, aparece aquí para entregarlo.' },
    delivered: { title: 'Aún no hay entregas' },
    rejected: { title: 'No hay solicitudes rechazadas' },
};

const PAGE_SIZE = 20;

export function WithdrawalsInbox({ step, onStepChange, onNavigateAuthorizations }: {
    step: WithdrawalStep;
    onStepChange: (step: WithdrawalStep) => void;
    onNavigateAuthorizations: () => void;
}) {
    const { requests, updateMaterialRequestStatus, users, materials, isLoading, can } = useAppState();
    const { toast } = useToast();
    const router = useRouter();

    const [search, setSearch] = useState('');
    const [visible, setVisible] = useState(PAGE_SIZE);
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

    const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);
    const userMap = useMemo(() => new Map((users || []).map((u: User) => [u.id, u.name])), [users]);

    const all = useMemo(() => {
        return [...((requests || []) as CompatibleMaterialRequest[])].sort(
            (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0),
        );
    }, [requests]);

    // Gate ADC: solo las pendientes ya autorizadas llegan al pañol.
    const queues = useMemo(() => withdrawalQueues(all), [all]);
    // Por entregar: la más antigua primero (es la que lleva más tiempo esperando).
    const toDeliver = useMemo(() => [...queues.toDeliver].reverse(), [queues.toDeliver]);
    const waitingAdc = queues.waitingAdc;

    const counts: Record<WithdrawalStep, number> = {
        toApprove: queues.toApprove.length,
        toDeliver: queues.toDeliver.length,
        delivered: queues.delivered.length,
        rejected: queues.rejected.length,
    };

    const activeList = step === 'toDeliver' ? toDeliver : queues[step];

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return activeList;
        return activeList.filter(r => {
            if ((r.internalCode || '').toLowerCase().includes(q)) return true;
            if ((userMap.get(r.supervisorId) || '').toLowerCase().includes(q)) return true;
            if ((r.beneficiaryName || '').toLowerCase().includes(q)) return true;
            if ((r.contractName || '').toLowerCase().includes(q)) return true;
            return requestItems(r).some(it => (materialMap.get(it.materialId)?.name || '').toLowerCase().includes(q));
        });
    }, [activeList, search, userMap, materialMap]);

    const setStepReset = (s: WithdrawalStep) => { onStepChange(s); setVisible(PAGE_SIZE); };

    const handleUpdate = async (requestId: string, next: 'approved' | 'rejected', deliverNow = false) => {
        setProcessingIds(prev => new Set(prev).add(requestId));
        try {
            if (next === 'approved') {
                const req = all.find(r => r.id === requestId);
                const insufficient = requestItems(req as CompatibleMaterialRequest).filter(it => {
                    const mat = materialMap.get(it.materialId);
                    return !mat || (mat.stock ?? 0) < it.quantity;
                });
                if (insufficient.length > 0) throw new Error(`Stock insuficiente para ${insufficient.length} ítem(s). Revisa el inventario.`);
            }
            await updateMaterialRequestStatus(requestId, next);
            if (next === 'approved' && deliverNow) {
                router.push(deliveryHref(requestId));
                return;
            }
            toast({
                title: next === 'approved' ? 'Despacho aprobado' : 'Solicitud rechazada',
                description: next === 'approved' ? 'Quedó en "Por entregar" para cuando el trabajador venga a retirarla.' : 'No se modificó el inventario.',
                variant: next === 'approved' ? 'default' : 'destructive',
            });
            // Realtime refresca la colección sola — sin refetch masivo.
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo procesar', description: e.message || 'Error inesperado.' });
        } finally {
            setProcessingIds(prev => { const s = new Set(prev); s.delete(requestId); return s; });
        }
    };

    return (
        <div className="space-y-6">
            {/* Chips de estado + búsqueda */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-1 bg-muted/50 border rounded-xl p-1 w-full sm:w-fit overflow-x-auto no-scrollbar">
                    {STEP_CHIPS.map(({ key, label }) => {
                        // Los pasos con trabajo pendiente se destacan aunque no estén elegidos.
                        const urgent = (key === 'toApprove' || key === 'toDeliver') && counts[key] > 0;
                        return (
                            <button
                                key={key}
                                onClick={() => setStepReset(key)}
                                className={cn(
                                    'px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 whitespace-nowrap',
                                    step === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {label}
                                {counts[key] > 0 && (
                                    <span className={cn(
                                        'px-1.5 py-0.5 rounded-md text-[8px]',
                                        step === key ? 'bg-primary-foreground/20' : urgent ? 'bg-warning text-warning-foreground' : 'bg-muted-foreground/10',
                                    )}>{counts[key]}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
                <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <Input
                        value={search}
                        onChange={e => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
                        placeholder="Buscar por código, persona o material…"
                        className="h-11 rounded-xl pl-10 text-xs bg-card"
                    />
                </div>
            </div>

            {/* Aviso: solicitudes atascadas en el ADC (solo cuando revisamos pendientes) */}
            {step === 'toApprove' && waitingAdc.length > 0 && (
                <button
                    onClick={onNavigateAuthorizations}
                    className="w-full flex items-center gap-4 p-5 rounded-[1.5rem] bg-info-subtle border border-info/20 text-left hover:bg-info-subtle/70 transition-colors group"
                >
                    <div className="w-11 h-11 rounded-2xl bg-card flex items-center justify-center text-info shrink-0 shadow-sm">
                        <ShieldQuestion size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-black uppercase tracking-tight text-info-subtle-foreground">{waitingAdc.length} solicitud{waitingAdc.length > 1 ? 'es' : ''} esperando al ADC</p>
                        <p className="text-[11px] text-muted-foreground font-medium">Aún no autorizadas por el Administrador de Contrato — no puedes aprobarlas todavía.</p>
                    </div>
                    <ArrowRight size={16} className="text-info shrink-0 group-hover:translate-x-1 transition-transform" />
                </button>
            )}

            {/* Lista */}
            {isLoading ? (
                <LoadingState />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={step === 'toApprove' || step === 'toDeliver' ? <Check size={24} className="text-success" /> : <PackageCheck size={24} />}
                    title={search ? 'Sin resultados' : EMPTY[step].title}
                    description={search ? `No se encontró "${search}".` : EMPTY[step].description}
                />
            ) : (
                <>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                        {filtered.slice(0, visible).map(req => (
                            <WithdrawalCard
                                key={req.id}
                                req={req}
                                materialMap={materialMap}
                                supervisorName={userMap.get(req.supervisorId)}
                                isProcessing={processingIds.has(req.id)}
                                canAct={step === 'toApprove' && canApproveClass(can, (req.highestClass || 'C') as 'A' | 'B' | 'C')}
                                canDeliver={step === 'toDeliver'}
                                onApprove={(deliverNow) => handleUpdate(req.id, 'approved', deliverNow)}
                                onReject={() => handleUpdate(req.id, 'rejected')}
                                onDeliver={() => router.push(deliveryHref(req.id))}
                            />
                        ))}
                    </div>
                    {filtered.length > visible && (
                        <div className="flex justify-center">
                            <Button variant="outline" onClick={() => setVisible(v => v + PAGE_SIZE)} className="rounded-[1.5rem] px-8 h-12 text-xs font-black uppercase tracking-widest gap-2">
                                Mostrar más ({filtered.length - visible}) <ChevronDown size={16} />
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function WithdrawalCard({ req, materialMap, supervisorName, isProcessing, canAct, canDeliver, onApprove, onReject, onDeliver }: {
    req: CompatibleMaterialRequest;
    materialMap: Map<string, Material>;
    supervisorName?: string;
    isProcessing: boolean;
    canAct: boolean;
    canDeliver: boolean;
    onApprove: (deliverNow: boolean) => void;
    onReject: () => void;
    onDeliver: () => void;
}) {
    const cls = (req.highestClass || 'C') as 'A' | 'B' | 'C';
    // Aprobada sin retirar: el stock ya salió pero nadie fue a buscarlo.
    const notPickedUp = req.status === 'approved' && !req.deliveryDate;
    const pickupDays = notPickedUp ? daysSince(req.approvalDate) : 0;

    return (
        <div className={cn(
            'relative bg-card rounded-[2rem] border shadow-sm overflow-hidden transition-all',
            isProcessing ? 'opacity-60 pointer-events-none' : 'hover:shadow-xl',
            (req.status === 'pending' || canDeliver) && 'border-l-4 border-l-primary',
        )}>
            {isProcessing && (
                <div className="absolute inset-0 z-10 bg-background/60 flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Procesando…</span>
                </div>
            )}

            <div className="p-6 space-y-4">
                {/* Encabezado */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">{req.internalCode || `REF ${req.id.slice(0, 8).toUpperCase()}`}</p>
                        <p className="text-sm font-black uppercase tracking-tight text-foreground truncate mt-0.5">{supervisorName || req.userName || 'Solicitante'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {req.status === 'approved' && req.deliveryDate ? (
                            <Badge className="badge-success gap-1 border-none text-[9px] font-black uppercase tracking-widest"><PackageCheck className="h-3 w-3" /> Entregada</Badge>
                        ) : req.status !== 'pending' && !canDeliver ? (
                            <RequestStatusBadge status={req.status} />
                        ) : null}
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{formatDateTime(req.createdAt)}</span>
                    </div>
                </div>

                {/* Metadatos */}
                <div className="flex flex-wrap items-center gap-1.5">
                    {req.deliveryMode === 'directed' && req.beneficiaryName && (
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-info/30 bg-info-subtle text-info font-black uppercase tracking-widest">Retira: {req.beneficiaryName}</Badge>
                    )}
                    {req.deliveryMode === 'open' && (
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-warning/30 bg-warning-subtle text-warning font-black uppercase tracking-widest">Retiro abierto</Badge>
                    )}
                    {req.contractName && (
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-primary/30 text-primary font-black uppercase tracking-widest">{req.contractName}</Badge>
                    )}
                    {req.area && <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest">{req.area}</Badge>}
                    {req.receivedByUserName && (
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-success/30 bg-success-subtle text-success-subtle-foreground font-black uppercase tracking-widest">Recibió: {req.receivedByUserName}</Badge>
                    )}
                    {notPickedUp && (
                        <Badge className={cn(
                            'gap-1 text-[9px] h-5 px-1.5 border-none font-black uppercase tracking-widest',
                            pickupDays >= 3 ? 'bg-destructive/10 text-destructive' : 'bg-warning-subtle text-warning',
                        )}>
                            <Clock className="h-3 w-3" /> Sin retirar{pickupDays > 0 ? ` ${pickupDays}d` : ''}
                        </Badge>
                    )}
                </div>

                {/* Ítems */}
                <div className="bg-muted/40 p-4 rounded-2xl">
                    <RequestItemsList req={req} materialMap={materialMap} />
                </div>

                {req.notes && (
                    <p className="text-xs text-muted-foreground font-medium italic border-l-2 border-border pl-3">{req.notes}</p>
                )}

                {/* Acciones (solo pendientes con permiso de clase) */}
                {canAct && (
                    <div className="flex gap-3 pt-1">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" className="rounded-xl h-11 px-5 text-[10px] font-black uppercase tracking-widest border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5">
                                    <X size={14} /> Rechazar
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[1.5rem]">
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Rechazar solicitud</AlertDialogTitle>
                                    <AlertDialogDescription>Se marcará como rechazada y no se modificará el inventario. Esta acción es irreversible.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={onReject} className="bg-destructive hover:bg-destructive/90">Rechazar</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>

                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button className={cn(
                                    'flex-1 rounded-xl h-11 text-[10px] font-black uppercase tracking-widest gap-1.5',
                                    cls === 'A' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : cls === 'B' ? 'bg-info text-info-foreground hover:bg-info/90' : 'bg-success text-success-foreground hover:bg-success/90',
                                )}>
                                    <Check size={14} /> Aprobar Despacho {cls}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[1.5rem]">
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Aprobar despacho</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Se descontarán los materiales del inventario. Si el trabajador está aquí, entrégaselo ahora;
                                        si no, queda en &quot;Por entregar&quot; para cuando venga.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="flex-col sm:flex-col sm:space-x-0 gap-2">
                                    <AlertDialogAction onClick={() => onApprove(true)} className="w-full h-11 bg-success text-success-foreground hover:bg-success/90 gap-1.5"><HandHelping size={14} /> Aprobar y entregar ahora</AlertDialogAction>
                                    <AlertDialogAction onClick={() => onApprove(false)} className="w-full h-11 bg-secondary text-secondary-foreground hover:bg-secondary/80">Aprobar, entregar después</AlertDialogAction>
                                    <AlertDialogCancel className="w-full mt-0">Cancelar</AlertDialogCancel>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                )}

                {req.status === 'pending' && !canAct && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning-subtle text-warning-subtle-foreground">
                        <ShieldQuestion size={16} className="shrink-0 mt-0.5" />
                        <p className="text-xs font-medium">
                            {cls === 'A'
                                ? <>Tiene ítems <strong>clase A</strong>: la aprueba un Administrador o el Director de Faena. Cuando la aprueben, aparece en &quot;Por entregar&quot;.</>
                                : <>No tienes permiso para aprobar clase {cls}. Cuando la aprueben, aparece en &quot;Por entregar&quot;.</>}
                        </p>
                    </div>
                )}

                {canDeliver && (
                    <Button
                        onClick={onDeliver}
                        className="w-full rounded-xl h-12 text-[11px] font-black uppercase tracking-widest gap-2 shadow-lg shadow-primary/10"
                    >
                        <HandHelping size={16} /> Entregar
                    </Button>
                )}
            </div>
        </div>
    );
}
