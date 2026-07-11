"use client";

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { Material } from '@/modules/core/lib/data';
import { cn } from '@/lib/utils';
import { Search, Package, Users, Calendar, MapPin, Clock, Activity, AlertTriangle } from 'lucide-react';
import { STAGE_META } from './report-utils';
import type { ReportData } from './use-report-data';

export function TrailTab({ data }: { data: ReportData }) {
    const { materials, transactions, holderMap } = data;

    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(query), 200);
        return () => clearTimeout(t);
    }, [query]);

    // Búsqueda case-insensitive por nombre, ID, serial o código interno.
    const matches = useMemo(() => {
        const q = debounced.trim().toLowerCase();
        if (!q) return [];
        return (materials || []).filter(m =>
            m.name.toLowerCase().includes(q)
            || m.id.toLowerCase().includes(q)
            || (m.serialNumber || '').toLowerCase().includes(q)
            || (m.internalCode || '').toLowerCase().includes(q)
        ).slice(0, 6);
    }, [materials, debounced]);

    // Selección: explícita, o el único match.
    const asset: Material | null = useMemo(() => {
        if (selectedId) return materials?.find(m => m.id === selectedId) || null;
        if (matches.length === 1) return matches[0];
        return null;
    }, [selectedId, matches, materials]);

    const assetTxs = useMemo(
        () => asset ? transactions.filter(tx => tx.assetIds.includes(asset.id)) : [],
        [transactions, asset],
    );
    const holder = asset ? holderMap.get(asset.id) : undefined;

    return (
        <div className="space-y-8 animate-in slide-in-from-bottom-4">
            <div className="max-w-3xl mx-auto">
                <Card className="rounded-[3rem] border shadow-2xl p-10 bg-card">
                    <div className="text-center space-y-4 mb-10">
                        <div className="w-20 h-20 bg-pagnol-orange/10 text-pagnol-orange rounded-3xl flex items-center justify-center mx-auto mb-6">
                            <Search size={40} />
                        </div>
                        <h4 className="text-2xl font-black uppercase tracking-tighter">Trazabilidad de Activo</h4>
                        <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Historial completo por nombre, serial, ID o código interno</p>
                    </div>
                    <div className="relative group">
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-pagnol-orange transition-colors" size={24} />
                        <input
                            type="text"
                            value={query}
                            placeholder="Nombre, serial, ID o código interno..."
                            className="w-full pl-16 pr-8 py-6 bg-muted border-2 border-border rounded-[2rem] font-black text-lg uppercase outline-none focus:ring-8 focus:ring-pagnol-orange/5 focus:border-pagnol-orange/20 transition-all shadow-inner placeholder:normal-case placeholder:font-bold placeholder:text-sm"
                            onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }}
                        />
                    </div>

                    {/* Coincidencias múltiples: elegir en vez de adivinar */}
                    {matches.length > 1 && !asset && (
                        <div className="mt-6 space-y-2">
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-2">{matches.length} coincidencias — selecciona una:</p>
                            {matches.map(m => (
                                <button
                                    key={m.id}
                                    onClick={() => setSelectedId(m.id)}
                                    className="w-full flex items-center justify-between p-4 bg-muted hover:bg-pagnol-orange/10 border rounded-2xl text-left transition-colors gap-3"
                                >
                                    <div className="min-w-0">
                                        <p className="text-xs font-black uppercase truncate">{m.name}</p>
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase mt-0.5">{m.category}</p>
                                    </div>
                                    <span className="font-mono text-[10px] font-black text-muted-foreground shrink-0">{m.internalCode || m.serialNumber || m.id.slice(0, 8)}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {debounced.trim() && matches.length === 0 && (
                        <div className="mt-6">
                            <EmptyState icon={<AlertTriangle size={20} />} title="Activo no localizado" description="Ningún activo coincide con la búsqueda." className="py-8" />
                        </div>
                    )}
                </Card>
            </div>

            {asset && (
                <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in duration-500">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <Card className="md:col-span-1 rounded-[2.5rem] border-none shadow-xl bg-card p-8">
                            <div className="aspect-square rounded-2xl bg-muted border overflow-hidden mb-6 flex items-center justify-center relative">
                                {asset.photos && asset.photos.length > 0 ? (
                                    <Image src={asset.photos[0]} alt={asset.name} fill sizes="300px" className="object-cover" />
                                ) : (
                                    <Package size={64} className="text-muted-foreground/40" />
                                )}
                            </div>
                            <h5 className="text-lg font-black uppercase leading-tight">{asset.name}</h5>
                            <p className="text-[10px] text-pagnol-orange font-black uppercase mt-2 tracking-widest">{asset.category}</p>
                            <div className="mt-8 space-y-4">
                                <div className="flex justify-between items-center text-[10px] font-black uppercase border-b pb-3 gap-3">
                                    <span className="text-muted-foreground shrink-0">Código</span>
                                    <span className="font-mono truncate">{asset.internalCode || asset.id.slice(0, 12)}</span>
                                </div>
                                <div className="flex justify-between items-center text-[10px] font-black uppercase border-b pb-3">
                                    <span className="text-muted-foreground">Serial</span>
                                    <span>{asset.serialNumber || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between items-center text-[10px] font-black uppercase border-b pb-3">
                                    <span className="text-muted-foreground">Clase</span>
                                    <Badge variant="outline">{asset.class}</Badge>
                                </div>
                                {holder && (
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase border-b pb-3 gap-3">
                                        <span className="text-muted-foreground shrink-0">En poder de</span>
                                        <span className="text-info truncate">{holder.name}</span>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card className="md:col-span-2 rounded-[2.5rem] border-none shadow-xl bg-card p-10">
                            <h5 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground mb-10 flex items-center gap-2">
                                <Clock size={16} /> Línea de Tiempo de Operaciones
                            </h5>
                            <div className="space-y-12 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-border">
                                {assetTxs.map((tx) => (
                                    <div key={tx.id} className="relative pl-12 group">
                                        <div className={cn(
                                            'absolute left-0 top-1 w-6 h-6 rounded-full border-4 border-card shadow-xl z-10 transition-transform group-hover:scale-125',
                                            tx.type === 'WITHDRAWAL' ? 'bg-pagnol-orange' : 'bg-success',
                                        )} />
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-xs font-black uppercase text-foreground">
                                                    {tx.type === 'WITHDRAWAL' ? 'Despacho a Faena' : 'Retorno a Pañol'}
                                                </p>
                                                <Badge variant="outline" className="text-[9px] font-black font-mono tracking-wider shrink-0">
                                                    {tx.internalCode || tx.id.substring(0, 8).toUpperCase()}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-6 flex-wrap">
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                                                    <Users size={12} /> {tx.holderName}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                                                    <Calendar size={12} /> {tx.timestamp.toLocaleDateString('es-CL')}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                                                    <MapPin size={12} /> {tx.site || '—'}
                                                </div>
                                            </div>
                                            <span className={cn('inline-block px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest', STAGE_META[tx.stage].cls)}>
                                                {STAGE_META[tx.stage].label}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                {assetTxs.length === 0 && (
                                    <div className="text-center py-20 opacity-30">
                                        <Activity size={32} className="mx-auto mb-2" />
                                        <p className="text-[10px] font-black uppercase">Sin registros operativos</p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>
                </div>
            )}
        </div>
    );
}
