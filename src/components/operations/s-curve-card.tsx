'use client';

import React from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ProgressLog, WorkItem } from '@/modules/core/lib/data';
import { construirCurvaS, montosALaFecha, spiALaFecha } from '@/lib/construction-scurve';

/**
 * Curva S de la obra: lo planificado contra lo realmente ejecutado, en dinero.
 *
 * Decisiones que no son de gusto:
 * - **Un solo eje.** Las dos series son pesos, así que comparten escala. Un
 *   gráfico de doble eje deja poner dos curvas donde uno quiera y "demuestra"
 *   cualquier cosa.
 * - **La línea real se CORTA en hoy** en vez de caer a cero. Llevarla a cero
 *   diría que la obra se detuvo; cortarla dice que ahí termina lo que sabemos.
 * - **Los montos van escritos, no sólo dibujados.** El validador de paleta marcó
 *   que el naranja sobre fondo claro queda en 2,66:1 —bajo el mínimo de 3:1—, y
 *   ante eso la regla es acompañar con etiquetas visibles. Además es lo que un
 *   gerente quiere leer: la cifra, no sólo la forma.
 */

const CLP = (n: number) =>
    n >= 1_000_000
        ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
        : `$${Math.round(n).toLocaleString('es-CL')}`;

interface SCurveCardProps {
    leafItems: WorkItem[];
    progressLogs: ProgressLog[];
}

export function SCurveCard({ leafItems, progressLogs }: SCurveCardProps) {
    const { datos, planificado, real, spi } = React.useMemo(() => {
        const hoy = new Date();
        const puntos = construirCurvaS(
            leafItems.map(i => ({
                id: i.id,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                progress: i.progress,
                plannedStartDate: i.plannedStartDate,
                plannedEndDate: i.plannedEndDate,
            })),
            (progressLogs || []).map(l => ({
                workItemId: l.workItemId,
                date: l.date,
                quantity: l.quantity,
            })),
            hoy,
        );
        const m = montosALaFecha(puntos, hoy);
        return {
            datos: puntos.map(p => ({
                fecha: format(p.fecha, 'd MMM', { locale: es }),
                Planificado: p.planificado,
                Ejecutado: p.real,
            })),
            planificado: m.planificado,
            real: m.real,
            spi: spiALaFecha(puntos, hoy),
        };
    }, [leafItems, progressLogs]);

    if (datos.length === 0) {
        return (
            <Card className="rounded-[1.5rem] border-none shadow-lg bg-card">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight">
                        <TrendingUp className="h-4 w-4 text-primary" /> Curva de Avance
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-muted-foreground py-8 text-center">
                        Las partidas necesitan fechas planificadas para dibujar la curva.
                        Cárgalas en el cronograma o al importar la programación.
                    </p>
                </CardContent>
            </Card>
        );
    }

    const atrasado = spi !== null && spi < 0.95;
    const adelantado = spi !== null && spi > 1.05;

    return (
        <Card className="rounded-[1.5rem] border-none shadow-lg bg-card">
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight">
                        <TrendingUp className="h-4 w-4 text-primary" /> Curva de Avance
                    </CardTitle>
                    {spi !== null && (
                        <Badge
                            className={
                                atrasado ? 'bg-destructive text-destructive-foreground text-[10px]'
                                    : adelantado ? 'bg-success text-success-foreground text-[10px]'
                                        : 'bg-info-subtle text-info-subtle-foreground text-[10px]'
                            }
                        >
                            {atrasado ? 'Atrasada' : adelantado ? 'Adelantada' : 'A tiempo'} · índice {spi.toFixed(2)}
                        </Badge>
                    )}
                </div>

                {/* Los montos escritos: el validador de paleta exige acompañar el
                    color con texto, y además es la cifra que se va a mirar. */}
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2">
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: 'hsl(var(--chart-5))' }} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Planificado a hoy</span>
                        <span className="text-sm font-bold tabular-nums text-foreground">{CLP(planificado)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: 'hsl(var(--chart-1))' }} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Ejecutado</span>
                        <span className="text-sm font-bold tabular-nums text-foreground">{CLP(real)}</span>
                    </div>
                </div>
            </CardHeader>

            <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={datos} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground) / 0.15)" />
                        <XAxis
                            dataKey="fecha" axisLine={false} tickLine={false} minTickGap={28}
                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} dy={6}
                        />
                        <YAxis
                            axisLine={false} tickLine={false} width={52}
                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                            tickFormatter={(v: number) => CLP(v)}
                        />
                        <Tooltip
                            contentStyle={{
                                background: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '0.75rem',
                                fontSize: 12,
                                color: 'hsl(var(--popover-foreground))',
                            }}
                            labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                            formatter={(v: number, n: string) => [CLP(v), n]}
                        />
                        {/* Planificado primero: es la referencia sobre la que se lee lo real. */}
                        <Line
                            type="monotone" dataKey="Planificado" stroke="hsl(var(--chart-5))"
                            strokeWidth={2} dot={false} activeDot={{ r: 4 }}
                        />
                        <Line
                            type="monotone" dataKey="Ejecutado" stroke="hsl(var(--chart-1))"
                            strokeWidth={2} dot={false} activeDot={{ r: 4 }}
                            connectNulls={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
