'use client';

import React from 'react';
import { ArrowRight, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { WorkItem, WorkProject } from '@/modules/core/lib/data';
import { rollupProgress } from '@/lib/construction-forecast';
import { useActiveProject } from './active-project';

/**
 * Cartera de obras: todas de un vistazo, para responder "¿cómo vamos?" sin
 * entrar a ninguna.
 *
 * Sólo aparece con más de una obra: con una sola sería repetir el número que ya
 * está arriba en grande.
 *
 * El avance de cada obra se calcula con `rollupProgress` —el mismo ponderado por
 * monto que usa el panel—, no con un promedio de porcentajes: promediar el 100%
 * de una partida de $5.000 con el 10% de una de $400 millones da un número que
 * no significa nada.
 */

const CLP = (n: number) =>
    n >= 1_000_000
        ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
        : `$${Math.round(n).toLocaleString('es-CL')}`;

interface PortfolioCardProps {
    /** Todas las partidas del inquilino, sin filtrar por obra. */
    allWorkItems: WorkItem[];
}

export function PortfolioCard({ allWorkItems }: PortfolioCardProps) {
    const { projects, projectId, setProjectId } = useActiveProject();

    const filas = React.useMemo(() => {
        const hijos = new Set(allWorkItems.map(i => i.parentId).filter(Boolean) as string[]);
        return projects.map(p => {
            const suyas = allWorkItems.filter(i => i.workProjectId === p.id);
            const hojas = suyas.filter(i => !hijos.has(i.id));
            const monto = hojas.reduce((s, i) => s + (i.quantity || 0) * (i.unitPrice || 0), 0);
            return {
                obra: p,
                avance: rollupProgress(hojas),
                monto,
                partidas: hojas.length,
            };
        }).sort((a, b) => b.monto - a.monto);
    }, [projects, allWorkItems]);

    if (projects.length <= 1) return null;

    return (
        <Card className="rounded-[1.5rem] border-none shadow-lg bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight">
                    <Layers className="h-4 w-4 text-primary" /> Cartera de Obras
                    <span className="ml-1 text-[10px] font-black tabular-nums opacity-60">{projects.length}</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
                {filas.map(({ obra, avance, monto, partidas }) => {
                    const activa = obra.id === projectId;
                    return (
                        <button
                            key={obra.id}
                            type="button"
                            onClick={() => setProjectId(obra.id)}
                            className={`w-full text-left rounded-xl px-3 py-2.5 transition-colors ${activa ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold truncate">{obra.name}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                        {obra.code ? `${obra.code} · ` : ''}{partidas} partida{partidas === 1 ? '' : 's'}
                                        {monto > 0 && ` · ${CLP(monto)}`}
                                    </p>
                                </div>
                                <span className="text-sm font-black tabular-nums shrink-0">{avance.toFixed(0)}%</span>
                            </div>
                            <Progress value={avance} className="h-1.5 mt-1.5" />
                        </button>
                    );
                })}
                <p className="pt-2 text-[10px] text-muted-foreground text-center">
                    Toca una obra para ver su detalle en todo el módulo.
                </p>
            </CardContent>
        </Card>
    );
}
