"use client";

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { User as UserType } from '@/modules/core/lib/data';
import { cn } from '@/lib/utils';
import {
    Users, Package, ArrowRight, ArrowUpRight, ArrowDownRight, History,
    Activity, Search, ShieldCheck, MapPin, ChevronDown,
} from 'lucide-react';
import { DisplayTransaction, STAGE_META, isReturnable } from './report-utils';
import type { ReportData } from './use-report-data';

const CARDS_PER_LOAD = 12;

/** Métricas de responsabilidad SOLO sobre ítems retornables — el cemento no se devuelve. */
function returnableStats(userTxs: DisplayTransaction[], data: ReportData) {
    const { materialsMap } = data;
    let withdrawn = 0;
    let returned = 0;
    userTxs.forEach(tx => {
        const returnables = tx.assetIds.filter(id => isReturnable(materialsMap.get(id))).length;
        if (tx.type === 'WITHDRAWAL' && tx.isConfirmed) withdrawn += returnables;
        if (tx.type === 'RETURN' && tx.stage === 'completed') returned += returnables;
    });
    const score = withdrawn > 0 ? Math.min(100, Math.round((returned / withdrawn) * 100)) : null;
    return { withdrawn, returned, score };
}

export function PeopleTab({ data }: { data: ReportData }) {
    const { users, transactions, possessionByUser, materialsMap } = data;

    const [query, setQuery] = useState('');
    const [visibleCount, setVisibleCount] = useState(CARDS_PER_LOAD);
    const [selectedEmployee, setSelectedEmployee] = useState<UserType | null>(null);

    const txsByUser = useMemo(() => {
        const map = new Map<string, DisplayTransaction[]>();
        transactions.forEach(tx => {
            const list = map.get(tx.holderId) || [];
            list.push(tx);
            map.set(tx.holderId, list);
        });
        return map;
    }, [transactions]);

    const people = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (users || [])
            .filter((u: UserType) => u.role !== 'super-admin')
            .filter((u: UserType) => !q || u.name.toLowerCase().includes(q) || (u.rut || '').toLowerCase().includes(q))
            .map((u: UserType) => ({
                user: u,
                possession: possessionByUser.get(u.id) || [],
                txCount: (txsByUser.get(u.id) || []).length,
            }))
            // Primero quienes tienen activos a cargo, luego por actividad.
            .sort((a, b) => (b.possession.length - a.possession.length) || (b.txCount - a.txCount));
    }, [users, query, possessionByUser, txsByUser]);

    return (
        <div className="space-y-8 animate-in slide-in-from-bottom-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <Input
                        value={query}
                        onChange={e => { setQuery(e.target.value); setVisibleCount(CARDS_PER_LOAD); }}
                        placeholder="Buscar por nombre o RUT..."
                        className="h-11 rounded-xl pl-10 text-xs bg-card"
                    />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground self-center">
                    {people.filter(p => p.possession.length > 0).length} con activos a cargo · {people.length} personas
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {people.slice(0, visibleCount).map(({ user, possession, txCount }) => (
                    <Card key={user.id} className="rounded-[2.5rem] border-none shadow-xl bg-card group hover:shadow-2xl transition-all duration-500 overflow-hidden">
                        <div className="p-8 border-b bg-muted flex items-center justify-between">
                            <div className="flex items-center gap-4 min-w-0">
                                <div className="w-12 h-12 rounded-2xl bg-card border shadow-sm flex items-center justify-center text-muted-foreground shrink-0">
                                    <Users size={24} />
                                </div>
                                <div className="min-w-0">
                                    <h4 className="font-black uppercase text-sm leading-none truncate">{user.name}</h4>
                                    <p className="text-[9px] text-muted-foreground font-black uppercase mt-1.5 tracking-widest">{user.role}</p>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-[20px] font-black font-outfit text-pagnol-orange leading-none">{possession.length}</p>
                                <p className="text-[8px] font-black uppercase text-muted-foreground mt-1">A cargo</p>
                            </div>
                        </div>
                        <div className="p-8 space-y-4">
                            <div className="space-y-2">
                                {possession.slice(0, 3).map(({ materialId, since }) => (
                                    <div key={materialId} className="flex items-center justify-between p-3 bg-muted rounded-xl text-[10px] font-bold border gap-2">
                                        <span className="truncate uppercase">{materialsMap.get(materialId)?.name || materialId}</span>
                                        <span className="text-[8px] text-muted-foreground font-black uppercase shrink-0">
                                            desde {since.toLocaleDateString('es-CL')}
                                        </span>
                                    </div>
                                ))}
                                {possession.length > 3 && (
                                    <p className="text-[9px] text-center font-black text-muted-foreground uppercase pt-2">+{possession.length - 3} activos adicionales</p>
                                )}
                                {possession.length === 0 && (
                                    <div className="py-6 text-center opacity-20">
                                        <Package size={24} className="mx-auto mb-2" />
                                        <p className="text-[9px] font-black uppercase">{txCount > 0 ? 'Sin activos a cargo' : 'Sin actividad registrada'}</p>
                                    </div>
                                )}
                            </div>
                            <Button
                                variant="ghost"
                                onClick={() => setSelectedEmployee(user)}
                                className="w-full text-[10px] font-black uppercase border-t pt-4 h-auto rounded-none hover:bg-transparent hover:text-pagnol-orange"
                            >
                                Ver Expediente Completo <ArrowRight size={14} className="ml-2" />
                            </Button>
                        </div>
                    </Card>
                ))}
            </div>

            {people.length === 0 && (
                <EmptyState icon={<Users size={24} />} title="Sin resultados" description="Ninguna persona coincide con la búsqueda." />
            )}

            {people.length > visibleCount && (
                <div className="flex justify-center">
                    <Button
                        variant="outline"
                        onClick={() => setVisibleCount(c => c + CARDS_PER_LOAD)}
                        className="rounded-[1.5rem] px-8 h-12 text-xs font-black uppercase tracking-widest gap-2"
                    >
                        Mostrar más ({people.length - visibleCount} restantes) <ChevronDown size={16} />
                    </Button>
                </div>
            )}

            {selectedEmployee && (
                <EmployeeRecordDialog
                    employee={selectedEmployee}
                    data={data}
                    txs={txsByUser.get(selectedEmployee.id) || []}
                    onClose={() => setSelectedEmployee(null)}
                />
            )}
        </div>
    );
}

function EmployeeRecordDialog({ employee, data, txs, onClose }: {
    employee: UserType;
    data: ReportData;
    txs: DisplayTransaction[];
    onClose: () => void;
}) {
    const { possessionByUser, materialsMap } = data;
    const possession = possessionByUser.get(employee.id) || [];
    const { withdrawn, returned, score } = returnableStats(txs, data);

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-3xl rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl">
                {/* Header */}
                <div className="bg-pagnol-dark text-white p-10 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-pagnol-orange/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                    <DialogHeader className="relative z-10">
                        <div className="flex items-start justify-between gap-6">
                            <div className="flex items-center gap-5">
                                <div className="w-16 h-16 rounded-[1.5rem] bg-white/10 border border-white/20 flex items-center justify-center text-white">
                                    <Users size={32} />
                                </div>
                                <div>
                                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-white">{employee.name}</DialogTitle>
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mt-1">{employee.role}</p>
                                    {employee.email && <p className="text-[10px] font-bold text-white/40 mt-1">{employee.email}</p>}
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                {score !== null ? (
                                    <>
                                        <p className="text-4xl font-black text-pagnol-orange leading-none">{score}%</p>
                                        <p className="text-[8px] font-black uppercase text-white/40 mt-1 tracking-widest">Retorno de prestables</p>
                                    </>
                                ) : (
                                    <p className="text-[9px] font-black uppercase text-white/40 tracking-widest max-w-[110px]">Sin ítems retornables registrados</p>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 mt-8">
                            {[
                                { label: 'A cargo hoy', value: possession.length, color: 'text-pagnol-orange' },
                                { label: 'Prestables retirados', value: withdrawn, color: 'text-blue-400' },
                                { label: 'Devueltos OK', value: returned, color: 'text-green-400' },
                            ].map((s, i) => (
                                <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                                    <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                                    <p className="text-[8px] font-black uppercase text-white/40 tracking-widest mt-1">{s.label}</p>
                                </div>
                            ))}
                        </div>
                    </DialogHeader>
                </div>

                {/* Body */}
                <ScrollArea className="max-h-[50vh]">
                    <div className="p-10 space-y-8 bg-card">
                        {/* Activos a cargo */}
                        <div>
                            <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 flex items-center gap-2">
                                <Package size={14} className="text-pagnol-orange" /> Activos a Cargo (retornables)
                            </h5>
                            {possession.length === 0 ? (
                                <EmptyState icon={<Package size={20} />} title="Sin activos a cargo" className="py-8" />
                            ) : (
                                <div className="space-y-2">
                                    {possession.map(({ materialId, since }) => {
                                        const mat = materialsMap.get(materialId);
                                        return mat ? (
                                            <div key={materialId} className="flex items-center justify-between p-4 bg-muted rounded-2xl border gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-black uppercase text-foreground truncate">{mat.name}</p>
                                                    <p className="text-[9px] font-bold text-muted-foreground uppercase mt-0.5">{mat.category} · desde {since.toLocaleDateString('es-CL')}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <Badge variant="outline" className="text-[8px] font-black">SN: {mat.serialNumber || 'N/A'}</Badge>
                                                    <p className="text-[8px] text-muted-foreground mt-1">CLASE {mat.class}</p>
                                                </div>
                                            </div>
                                        ) : null;
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Historial */}
                        <div>
                            <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 flex items-center gap-2">
                                <History size={14} className="text-pagnol-orange" /> Historial de Operaciones
                            </h5>
                            {txs.length === 0 ? (
                                <EmptyState icon={<Activity size={20} />} title="Sin operaciones registradas" className="py-8" />
                            ) : (
                                <div className="space-y-3">
                                    {txs.map(tx => (
                                        <div key={tx.id} className="flex items-center gap-4 p-4 rounded-2xl border bg-muted">
                                            <div className={cn(
                                                'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                                                tx.type === 'WITHDRAWAL' ? 'bg-pagnol-orange/10 text-pagnol-orange' : 'bg-success-subtle text-success',
                                            )}>
                                                {tx.type === 'WITHDRAWAL' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-black uppercase text-foreground">
                                                    {tx.type === 'WITHDRAWAL' ? 'Despacho' : 'Retorno'}
                                                </p>
                                                <p className="text-[9px] font-bold text-muted-foreground flex items-center gap-1 mt-0.5 flex-wrap">
                                                    <MapPin size={9} className="shrink-0" />
                                                    {tx.type === 'WITHDRAWAL'
                                                        ? <><span>Pañol</span> <ArrowRight size={9} className="opacity-50 shrink-0" /> <span className={tx.site ? 'text-pagnol-orange font-black' : 'opacity-50'}>{tx.site || 'Sin destino'}</span></>
                                                        : <><span>{tx.site || 'Faena'}</span> <ArrowRight size={9} className="opacity-50 shrink-0" /> <span className="text-success font-black">Pañol</span></>
                                                    }
                                                </p>
                                                <p className="text-[9px] text-muted-foreground font-bold mt-0.5">
                                                    {tx.itemCount} ítem(s) · {tx.timestamp.toLocaleDateString('es-CL')} {tx.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                            <span className={cn('px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest shrink-0', STAGE_META[tx.stage].cls)}>
                                                {STAGE_META[tx.stage].label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Score */}
                        {score !== null && (
                            <div className="p-6 bg-muted rounded-[2rem] border">
                                <div className="flex justify-between items-center mb-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Retorno de Ítems Prestables</p>
                                    <p className={`text-sm font-black ${score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-destructive'}`}>{score}%</p>
                                </div>
                                <Progress value={score} className="h-2" indicatorClassName={score >= 80 ? 'bg-success' : score >= 50 ? 'bg-warning' : 'bg-destructive'} />
                                <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-3">
                                    {returned} de {withdrawn} ítems prestables devueltos. Los consumibles no cuentan aquí.
                                </p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
