"use client";

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/empty-state';
import { ShieldCheck, BarChart3, Package, ArrowRight, ShoppingCart } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { STATUS_COLORS, formatCLP, formatCompactCLP, criticalThreshold, AssetStatus } from './report-utils';
import type { ReportData } from './use-report-data';

export function InventoryTab({ data }: { data: ReportData }) {
    const router = useRouter();
    const { totalValue, categoryData, statusDistribution, operabilityPct, criticalStock, activeMaterials } = data;

    const consumables = activeMaterials.filter(m => m.usageType === 'Consumible').length;

    return (
        <div className="space-y-10 animate-in slide-in-from-bottom-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* PATRIMONIO */}
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-card overflow-hidden p-8 flex flex-col">
                    <Badge className="bg-muted text-muted-foreground border-none mb-4 uppercase text-[9px] font-black w-fit">Patrimonio Neto</Badge>
                    <h2 className="text-4xl font-black font-outfit text-foreground">{formatCLP(totalValue)}</h2>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase mt-2 tracking-widest">Valorización total (costo × stock)</p>
                    <div className="mt-6 space-y-3 flex-1">
                        {categoryData.slice(0, 3).map(c => (
                            <div key={c.name} className="space-y-1.5">
                                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                                    <span className="text-muted-foreground truncate pr-4">{c.name}</span>
                                    <span className="text-foreground shrink-0">{formatCompactCLP(c.value)}</span>
                                </div>
                                <Progress value={totalValue > 0 ? (c.value / totalValue) * 100 : 0} className="h-1.5 bg-muted" indicatorClassName="bg-pagnol-orange" />
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => router.push('/dashboard/reports/contract-stock')}
                        className="mt-6 pt-4 border-t text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-pagnol-orange transition-colors flex items-center gap-2 w-fit"
                    >
                        Ver valorización por contrato <ArrowRight size={12} />
                    </button>
                </Card>

                {/* DISTRIBUCIÓN POR ESTADO */}
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-card overflow-hidden p-8">
                    <Badge className="bg-pagnol-orange/10 text-pagnol-orange border-none mb-4 uppercase text-[9px] font-black">Distribución por Estado</Badge>
                    <div className="h-[190px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={statusDistribution}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={58}
                                    outerRadius={80}
                                    paddingAngle={4}
                                    dataKey="value"
                                    isAnimationActive={false}
                                >
                                    {statusDistribution.map((entry) => (
                                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name as AssetStatus] || '#94a3b8'} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', background: 'var(--card)', color: 'var(--foreground)' }}
                                    itemStyle={{ color: 'var(--foreground)', fontWeight: 700, fontSize: 12 }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-4">
                        {statusDistribution.map((s) => (
                            <div key={s.name} className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground">
                                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[s.name as AssetStatus] || '#94a3b8' }} />
                                <span className="truncate">{s.name}: {s.value}</span>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* OPERATIVIDAD */}
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-pagnol-dark text-white overflow-hidden p-8 flex flex-col justify-between">
                    <div>
                        <Badge className="bg-white/10 text-white border-none mb-4 uppercase text-[9px] font-black">Operatividad</Badge>
                        <h2 className="text-5xl font-black font-outfit text-white">{operabilityPct}%</h2>
                        <p className="text-[10px] text-white/40 font-bold uppercase mt-2 tracking-widest">Activos listos para despacho</p>
                    </div>
                    <div className="space-y-4 mt-6">
                        <div>
                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/60 mb-2">
                                <span>Disponibilidad real</span>
                                <span>{operabilityPct}%</span>
                            </div>
                            <Progress value={operabilityPct} className="bg-white/10 h-1.5" indicatorClassName="bg-pagnol-orange" />
                        </div>
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/60 pt-2 border-t border-white/10">
                            <span>Ítems activos</span>
                            <span>{activeMaterials.length}</span>
                        </div>
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/60">
                            <span>Consumibles</span>
                            <span>{consumables}</span>
                        </div>
                    </div>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* VALORIZACIÓN POR CATEGORÍA */}
                <Card className="rounded-[3rem] border-none shadow-xl bg-card p-10">
                    <div className="flex items-center justify-between mb-8">
                        <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                            <BarChart3 size={20} className="text-pagnol-orange" /> Valorización por Categoría
                        </h3>
                    </div>
                    <div className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={categoryData} margin={{ left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                                <XAxis
                                    dataKey="name"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fontWeight: 700 }}
                                    tickFormatter={(v: string) => v.length > 14 ? `${v.slice(0, 13)}…` : v}
                                    interval={0}
                                    angle={categoryData.length > 5 ? -25 : 0}
                                    textAnchor={categoryData.length > 5 ? 'end' : 'middle'}
                                    height={categoryData.length > 5 ? 60 : 30}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fontWeight: 700 }}
                                    tickFormatter={(v: number) => formatCompactCLP(v)}
                                    width={56}
                                />
                                <Tooltip
                                    formatter={(value: number) => [formatCLP(value), 'Valorización']}
                                    contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', background: 'var(--card)', color: 'var(--foreground)' }}
                                    labelStyle={{ fontWeight: 900, textTransform: 'uppercase', fontSize: '12px', color: 'var(--foreground)' }}
                                />
                                <Bar dataKey="value" fill="#fb923c" radius={[10, 10, 0, 0]} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* STOCK CRÍTICO */}
                <Card className="rounded-[3rem] border-none shadow-xl bg-card p-10">
                    <div className="flex items-center justify-between mb-8">
                        <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                            <Package size={20} className="text-pagnol-orange" /> Stock Crítico
                        </h3>
                        <Badge variant="outline" className="border-destructive/30 text-destructive bg-destructive/10 font-black text-[9px] uppercase">
                            Umbral por material (minStock)
                        </Badge>
                    </div>
                    <ScrollArea className="h-[350px] pr-4">
                        <div className="space-y-4">
                            {criticalStock.map(m => (
                                <div key={m.id} className="flex items-center justify-between p-5 bg-muted rounded-2xl border group hover:border-destructive/30 transition-all gap-3">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="w-12 h-12 rounded-xl bg-card flex items-center justify-center border shadow-sm text-destructive font-black shrink-0">
                                            {m.stock ?? 0}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-black uppercase text-foreground truncate">{m.name}</p>
                                            <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-1">
                                                {m.category} · umbral {criticalThreshold(m)}{typeof m.minStock !== 'number' && ' (defecto)'}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => router.push(`/dashboard/purchasing/purchase-request-form?materialId=${m.id}`)}
                                        className="text-[10px] font-black uppercase text-destructive shrink-0 gap-1.5"
                                    >
                                        <ShoppingCart size={12} /> Reponer
                                    </Button>
                                </div>
                            ))}
                            {criticalStock.length === 0 && (
                                <EmptyState
                                    icon={<ShieldCheck size={24} />}
                                    title="Todos los niveles operativos"
                                    description="Ningún material está bajo su umbral de stock crítico."
                                />
                            )}
                        </div>
                    </ScrollArea>
                </Card>
            </div>
        </div>
    );
}
