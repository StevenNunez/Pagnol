
"use client";

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Material, User as UserType, MaterialRequest, ReturnRequest, MaterialCategory } from '@/modules/core/lib/data';
import {
    History, Search, Users, Package, TrendingUp, AlertTriangle,
    Sparkles, Printer, Activity, Download, ArrowRight,
    LayoutGrid, Wrench, Calendar, Loader2,
    ArrowUpRight, ArrowDownRight, Shield, ShieldCheck,
    PieChart as PieChartIcon, BarChart3, Clock, MapPin
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { generateStrategicReport } from '@/actions/ask-ferro';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';


type ReportTab = 'INVENTORY' | 'AUDIT' | 'PEOPLE' | 'ASSET_TRAIL' | 'MAINTENANCE_LOG' | 'AI_INSIGHTS';
type AssetStatus = 'Disponible' | 'En Mantenimiento' | 'Para Baja' | 'Extraviado' | 'En Uso' | 'Agotado' | 'Stock Crítico' | 'Archivado';

type DisplayTransaction = {
    id: string;
    internalCode?: string;
    type: 'WITHDRAWAL' | 'RETURN';
    timestamp: Date;
    assetIds: string[];
    site: string;
    status: string;
    employeeId: string;
    employeeName: string;
    isBiometricVerified: boolean;
};

const CHART_COLORS = ['#fb923c', '#0ea5e9', '#22c55e', '#a855f7', '#ec4899', '#64748b'];

export default function ReportsPage() {
    const { materials, users, requests, returnRequests, materialCategories } = useAppState();
    const { user: currentUser } = useAuth();
    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState<ReportTab>('INVENTORY');
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [aiReport, setAiReport] = useState<string | null>(null);
    const [aiError, setAiError] = useState<string | null>(null);
    const [cooldownSeconds, setCooldownSeconds] = useState(0);
    const [selectedEmployee, setSelectedEmployee] = useState<UserType | null>(null);

    // Countdown para cooldown de la IA
    useEffect(() => {
        if (cooldownSeconds <= 0) return;
        const t = setTimeout(() => setCooldownSeconds(s => s - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldownSeconds]);

    // Maps
    const materialsMap = useMemo(() => new Map((materials || []).map(m => [m.id, m])), [materials]);
    const usersMap = useMemo(() => new Map((users || []).map(u => [u.id, u])), [users]);

    const transactions: DisplayTransaction[] = useMemo(() => {
        const combinedList: DisplayTransaction[] = [];
        (requests || []).forEach(r => {
            const emp = usersMap.get(r.supervisorId);
            combinedList.push({
                id: r.id,
                internalCode: r.internalCode,
                type: 'WITHDRAWAL',
                timestamp: r.createdAt ? new Date(r.createdAt as any) : new Date(),
                assetIds: (r.items || []).map(i => i.materialId),
                site: r.area,
                status: r.status,
                employeeId: r.supervisorId,
                employeeName: emp?.name || r.userName || 'Desconocido',
                isBiometricVerified: r.status === 'approved' || !!r.deliveryDate,
            });
        });
        (returnRequests || []).forEach(r => {
            const emp = usersMap.get(r.supervisorId);
            combinedList.push({
                id: r.id,
                internalCode: r.internalCode,
                type: 'RETURN',
                timestamp: r.createdAt ? new Date(r.createdAt as any) : new Date(),
                assetIds: [r.materialId],
                site: 'Bodega Central',
                status: r.status,
                employeeId: r.supervisorId,
                employeeName: emp?.name || r.supervisorName || 'Desconocido',
                isBiometricVerified: r.status === 'completed',
            });
        });
        return combinedList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }, [requests, returnRequests, usersMap]);

    // Possession logic
    const inPossessionIds = useMemo(() => {
        const possession = new Set<string>();
        const sortedTransactions = [...transactions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        for (const t of sortedTransactions) {
            if (t.type === 'WITHDRAWAL' && t.isBiometricVerified) {
                t.assetIds.forEach(id => possession.add(id));
            } else if (t.type === 'RETURN' && t.status === 'completed') {
                t.assetIds.forEach(id => possession.delete(id));
            }
        }
        return possession;
    }, [transactions]);

    const getStatusLabel = useCallback((asset: Material): AssetStatus => {
        const id = asset.id;
        if (inPossessionIds.has(id)) return 'En Uso';
        if (asset.archived) return 'Archivado';
        if (asset.status === 'En Mantenimiento') return 'En Mantenimiento';
        if (asset.status === 'Para Baja') return 'Para Baja';
        if (asset.stock <= 0) return 'Agotado';
        if (asset.stock <= 5) return 'Stock Crítico';
        return 'Disponible';
    }, [inPossessionIds]);

    // Stats
    const totalValue = useMemo(() => (materials || []).reduce((acc, curr) => acc + ((curr.unitCost || 0) * (curr.stock || 0)), 0), [materials]);

    // Categorization for Charts
    const categoryData = useMemo(() => {
        return (materialCategories || []).map(cat => {
            const catAssets = (materials || []).filter(a => a.category === cat.name);
            const value = catAssets.reduce((acc, curr) => acc + (curr.unitCost || 0) * (curr.stock || 0), 0);
            return {
                name: cat.name,
                value: value,
                shortName: cat.name.split(' ')[0],
                count: catAssets.length
            };
        }).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
    }, [materials, materialCategories]);

    const statusDistribution = useMemo(() => {
        const dist: Record<string, number> = {};
        (materials || []).forEach(m => {
            const status = getStatusLabel(m);
            dist[status] = (dist[status] || 0) + 1;
        });
        return Object.entries(dist).map(([name, value]) => ({ name, value }));
    }, [materials, getStatusLabel]);

    const handlePrint = () => window.print();

    const handleGenerateAI = async () => {
        if (cooldownSeconds > 0) return;
        setIsGenerating(true);
        setAiReport(null);
        setAiError(null);
        try {
            // Contexto compacto: métricas pre-calculadas en vez de objetos crudos.
            // Esto reduce el tamaño de ~8 000 tokens a ~400 tokens → 10x más rápido.
            const classA = (materials || []).filter(m => m.class === 'A');
            const classB = (materials || []).filter(m => m.class === 'B');
            const classC = (materials || []).filter(m => m.class === 'C');
            const criticalStock = (materials || []).filter(m => (m.stock ?? 0) <= 5 && (m.stock ?? 0) >= 0 && !m.archived);
            const outOfStock = (materials || []).filter(m => (m.stock ?? 0) <= 0 && !m.archived);
            const inMaintenance = (materials || []).filter(m => m.status === 'En Mantenimiento');

            const lines: string[] = [
                `INFORME ESTRATÉGICO — ${new Date().toLocaleDateString('es-CL')}`,
                ``,
                `=== INVENTARIO GENERAL ===`,
                `Total activos: ${materials.length}`,
                `Valor total inventario: $${totalValue.toLocaleString('es-CL')}`,
                `Clase A (críticos): ${classA.length} | Clase B: ${classB.length} | Clase C: ${classC.length}`,
                ``,
                `=== ESTADO OPERATIVO ===`,
                ...statusDistribution.map(s => `${s.name}: ${s.value}`),
                ``,
                `=== TOP ACTIVOS CLASE A (por valor) ===`,
                ...classA
                    .sort((a, b) => (b.unitCost || 0) - (a.unitCost || 0))
                    .slice(0, 8)
                    .map(m => `- ${m.name} | Estado: ${getStatusLabel(m)} | Stock: ${m.stock ?? '—'} | $${(m.unitCost || 0).toLocaleString('es-CL')}`),
                ``,
                `=== STOCK CRÍTICO (stock ≤ 5) ===`,
                criticalStock.length > 0
                    ? criticalStock.slice(0, 8).map(m => `- ${m.name} | Stock: ${m.stock} | Mínimo recomendado: ${(m as any).minStock || 5}`).join('\n')
                    : 'Sin stock crítico',
                ``,
                `=== ACTIVOS AGOTADOS ===`,
                outOfStock.length > 0
                    ? outOfStock.slice(0, 5).map(m => `- ${m.name}`).join('\n')
                    : 'Sin activos agotados',
                ``,
                `=== EN MANTENIMIENTO ===`,
                inMaintenance.length > 0
                    ? inMaintenance.slice(0, 5).map(m => `- ${m.name}`).join('\n')
                    : 'Sin activos en mantenimiento',
                ``,
                `=== DISTRIBUCIÓN POR CATEGORÍA ===`,
                ...categoryData.slice(0, 6).map(c => `${c.name}: ${c.count} items | $${c.value.toLocaleString('es-CL')}`),
                ``,
                `=== ÚLTIMOS 10 MOVIMIENTOS ===`,
                ...transactions.slice(0, 10).map(t =>
                    `[${t.type === 'WITHDRAWAL' ? 'RETIRO' : 'RETORNO'}] ${t.employeeName} — ${t.site} — ${t.status} — ${t.timestamp.toLocaleDateString('es-CL')}`
                ),
                ``,
                `Personal activo: ${users.length} trabajadores`,
            ];

            const contextString = lines.join('\n');
            const res = await generateStrategicReport(contextString);
            if (res.ok && res.report) {
                setAiReport(res.report);
            } else {
                const isOverloaded =
                    res.error?.includes('UNAVAILABLE') ||
                    res.error?.includes('503') ||
                    res.error?.includes('high demand') ||
                    res.error?.includes('RESOURCE_EXHAUSTED') ||
                    res.error?.includes('429') ||
                    res.error?.includes('quota');

                if (isOverloaded) {
                    setCooldownSeconds(90);
                    setAiError('overloaded');
                } else {
                    setAiError(res.error || 'Error desconocido al contactar la IA.');
                    toast({ variant: 'destructive', title: "Error de IA", description: res.error });
                }
            }
        } catch (e: any) {
            setAiError(e?.message || 'Error de conexión.');
            toast({ variant: 'destructive', title: "Error", description: "Fallo en la conexión con la IA." });
        } finally {
            setIsGenerating(false);
        }
    };

    const tabs: { id: ReportTab; label: string; icon: any }[] = [
        { id: 'INVENTORY', label: 'Inventario', icon: LayoutGrid },
        { id: 'PEOPLE', label: 'Personal', icon: Users },
        { id: 'ASSET_TRAIL', label: 'Trazabilidad', icon: Search },
        { id: 'MAINTENANCE_LOG', label: 'Mantenimiento', icon: Wrench },
        { id: 'AUDIT', label: 'Auditoría', icon: History },
        { id: 'AI_INSIGHTS', label: 'IA Diagnostic', icon: Sparkles },
    ];

    return (
        <div className="space-y-8 animate-in fade-in duration-700 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 no-print">
                <PageHeader title="CENTRO DE REPORTES ESTRATÉGICOS" description="CONTROL PATRIMONIAL Y AUDITORÍA DE ACTIVOS" />
                <div className="flex items-center gap-3">
                    <Button onClick={handlePrint} variant="outline" className="rounded-2xl h-12 px-6 gap-2 border-slate-200">
                        <Printer size={16} /> Imprimir
                    </Button>
                </div>
            </div>

            {/* TAB SELECTOR */}
            <div className="flex items-center gap-2 bg-slate-100/50 p-2 rounded-[2rem] border shadow-inner overflow-x-auto no-scrollbar no-print">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-3 px-6 py-4 rounded-[1.5rem] text-[11px] font-black uppercase tracking-[0.1em] transition-all whitespace-nowrap",
                                activeTab === tab.id
                                    ? "bg-slate-100 text-pagnol-dark shadow-xl"
                                    : "text-muted-foreground hover:text-slate-600 hover:bg-slate-100/50"
                            )}
                        >
                            <Icon size={16} className={activeTab === tab.id ? "text-pagnol-orange" : ""} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <div className="printable-area space-y-10">

                {/* INVENTORY TAB */}
                {activeTab === 'INVENTORY' && (
                    <div className="space-y-10 animate-in slide-in-from-bottom-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100 overflow-hidden p-8 flex flex-col justify-between">
                                <div>
                                    <Badge className="bg-slate-100 text-muted-foreground border-none mb-4 uppercase text-[9px] font-black">Patrimonio Neto</Badge>
                                    <h2 className="text-4xl font-black font-outfit text-slate-900">${totalValue.toLocaleString()}</h2>
                                    <p className="text-[10px] text-muted-foreground font-bold uppercase mt-2 tracking-widest">Valorización total en Bodega</p>
                                </div>
                                <div className="h-24 mt-6">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={categoryData.slice(0, 5)}>
                                            <defs>
                                                <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#fb923c" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#fb923c" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <Area type="monotone" dataKey="value" stroke="#fb923c" fillOpacity={1} fill="url(#colorVal)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </Card>

                            <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100 overflow-hidden p-8">
                                <Badge className="bg-orange-100 text-orange-600 border-none mb-4 uppercase text-[9px] font-black">Distribución por Estado</Badge>
                                <div className="h-[200px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={statusDistribution}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                            >
                                                {statusDistribution.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-4">
                                    {statusDistribution.map((s, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                                            {s.name}: {s.value}
                                        </div>
                                    ))}
                                </div>
                            </Card>

                            <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-900 text-white overflow-hidden p-8 flex flex-col justify-between">
                                <div>
                                    <Badge className="bg-slate-100/10 text-white border-none mb-4 uppercase text-[9px] font-black">Operatividad</Badge>
                                    <h2 className="text-5xl font-black font-outfit text-white">
                                        {Math.round(((statusDistribution.find(s => s.name === 'Disponible')?.value || 0) / (materials?.length || 1)) * 100)}%
                                    </h2>
                                    <p className="text-[10px] text-white/40 font-bold uppercase mt-2 tracking-widest">Activos listos para despacho</p>
                                </div>
                                <div className="space-y-3 mt-6">
                                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/60">
                                        <span>Consumibles</span>
                                        <span>{materials?.filter(m => m.usageType === 'Consumible').length}</span>
                                    </div>
                                    <Progress value={75} className="bg-slate-100/10 h-1.5" indicatorClassName="bg-pagnol-orange" />
                                </div>
                            </Card>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <Card className="rounded-[3rem] border-none shadow-xl bg-slate-100 p-10">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                                        <BarChart3 size={20} className="text-pagnol-orange" /> Valorización por Categoría
                                    </h3>
                                </div>
                                <div className="h-[350px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={categoryData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis dataKey="shortName" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                                            <Tooltip
                                                contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}
                                                labelStyle={{ fontWeight: 900, textTransform: 'uppercase', fontSize: '12px' }}
                                            />
                                            <Bar dataKey="value" fill="#fb923c" radius={[10, 10, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </Card>

                            <Card className="rounded-[3rem] border-none shadow-xl bg-slate-100 p-10">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                                        <Package size={20} className="text-pagnol-orange" /> Resumen de Activos Críticos
                                    </h3>
                                    <Badge variant="outline" className="border-red-100 text-red-600 bg-red-50 font-black">Stock {"<"} 5</Badge>
                                </div>
                                <ScrollArea className="h-[350px] pr-4">
                                    <div className="space-y-4">
                                        {materials?.filter(m => m.stock <= 5 && !m.archived).map(m => (
                                            <div key={m.id} className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-red-200 transition-all">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center border shadow-sm text-red-500 font-black">
                                                        {m.stock}
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-black uppercase text-slate-700">{m.name}</p>
                                                        <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-1">{m.category}</p>
                                                    </div>
                                                </div>
                                                <Button variant="ghost" size="sm" className="text-[10px] font-black uppercase text-red-600">Reponer</Button>
                                            </div>
                                        ))}
                                        {materials?.filter(m => m.stock <= 5 && !m.archived).length === 0 && (
                                            <div className="text-center py-20 text-slate-300">
                                                <ShieldCheck size={48} className="mx-auto mb-4 opacity-20" />
                                                <p className="text-xs font-black uppercase tracking-widest">Todos los niveles operativos</p>
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            </Card>
                        </div>
                    </div>
                )}

                {/* PEOPLE TAB */}
                {activeTab === 'PEOPLE' && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                            {users?.filter(u => u.role !== 'administrador' && u.role !== 'super-admin').map(user => {
                                const userTransactions = transactions.filter(t => t.employeeId === user.id);
                                const currentAssets = Array.from(inPossessionIds).filter(aid => {
                                    const lastTx = userTransactions.filter(t => t.assetIds.includes(aid))[0];
                                    return lastTx && lastTx.type === 'WITHDRAWAL';
                                });

                                return (
                                    <Card key={user.id} className="rounded-[2.5rem] border-none shadow-xl bg-slate-100 group hover:shadow-2xl transition-all duration-500 overflow-hidden">
                                        <div className="p-8 border-b bg-slate-50/50 flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-2xl bg-slate-100 border shadow-sm flex items-center justify-center text-muted-foreground">
                                                    <Users size={24} />
                                                </div>
                                                <div>
                                                    <h4 className="font-black uppercase text-sm leading-none">{user.name}</h4>
                                                    <p className="text-[9px] text-muted-foreground font-black uppercase mt-1.5 tracking-widest">{user.role}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[20px] font-black font-outfit text-pagnol-orange leading-none">{currentAssets.length}</p>
                                                <p className="text-[8px] font-black uppercase text-muted-foreground mt-1">Activos</p>
                                            </div>
                                        </div>
                                        <div className="p-8 space-y-4">
                                            <div className="space-y-2">
                                                {currentAssets.slice(0, 3).map(aid => (
                                                    <div key={aid} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl text-[10px] font-bold border border-slate-100">
                                                        <span className="truncate max-w-[140px] uppercase">{materialsMap.get(aid)?.name}</span>
                                                        <Badge variant="outline" className="text-[8px] bg-slate-100 border-none shadow-sm">SN: {materialsMap.get(aid)?.serialNumber || 'N/A'}</Badge>
                                                    </div>
                                                ))}
                                                {currentAssets.length > 3 && (
                                                    <p className="text-[9px] text-center font-black text-muted-foreground uppercase pt-2">+{currentAssets.length - 3} activos adicionales</p>
                                                )}
                                                {currentAssets.length === 0 && (
                                                    <div className="py-6 text-center opacity-20">
                                                        <Package size={24} className="mx-auto mb-2" />
                                                        <p className="text-[9px] font-black uppercase">Sin cargos activos</p>
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
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* EMPLOYEE RECORD MODAL */}
                {selectedEmployee && (() => {
                    const empTxs = transactions.filter(t => t.employeeId === selectedEmployee.id).sort((a,b) => b.timestamp.getTime() - a.timestamp.getTime());
                    const empCurrentAssets = Array.from(inPossessionIds).filter(aid => {
                        const lastTx = empTxs.filter(t => t.assetIds.includes(aid))[0];
                        return lastTx && lastTx.type === 'WITHDRAWAL';
                    });
                    const totalWithdrawals = empTxs.filter(t => t.type === 'WITHDRAWAL').length;
                    const totalReturns = empTxs.filter(t => t.type === 'RETURN' && t.status === 'completed').length;
                    const reliabilityScore = totalWithdrawals > 0 ? Math.round((totalReturns / totalWithdrawals) * 100) : 100;

                    return (
                        <Dialog open={!!selectedEmployee} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
                            <DialogContent className="max-w-3xl rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl">
                                {/* Header */}
                                <div className="bg-slate-900 text-white p-10 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-pagnol-orange/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                                    <DialogHeader className="relative z-10">
                                        <div className="flex items-start justify-between gap-6">
                                            <div className="flex items-center gap-5">
                                                <div className="w-16 h-16 rounded-[1.5rem] bg-slate-100/10 border border-white/20 flex items-center justify-center text-white">
                                                    <Users size={32} />
                                                </div>
                                                <div>
                                                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-white">{selectedEmployee.name}</DialogTitle>
                                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mt-1">{selectedEmployee.role}</p>
                                                    {selectedEmployee.email && <p className="text-[10px] font-bold text-white/40 mt-1">{selectedEmployee.email}</p>}
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-4xl font-black text-pagnol-orange leading-none">{reliabilityScore}%</p>
                                                <p className="text-[8px] font-black uppercase text-white/40 mt-1 tracking-widest">Score Confianza</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 mt-8">
                                            {[
                                                { label: 'En Posesión', value: empCurrentAssets.length, color: 'text-pagnol-orange' },
                                                { label: 'Total Retiros', value: totalWithdrawals, color: 'text-blue-400' },
                                                { label: 'Retornos OK', value: totalReturns, color: 'text-green-400' },
                                            ].map((s, i) => (
                                                <div key={i} className="bg-slate-100/5 border border-white/10 rounded-2xl p-4 text-center">
                                                    <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                                                    <p className="text-[8px] font-black uppercase text-white/40 tracking-widest mt-1">{s.label}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </DialogHeader>
                                </div>

                                {/* Body */}
                                <ScrollArea className="max-h-[50vh]">
                                    <div className="p-10 space-y-8 bg-slate-100">

                                        {/* Active assets */}
                                        <div>
                                            <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 flex items-center gap-2">
                                                <Package size={14} className="text-pagnol-orange" /> Activos en Posesión Actual
                                            </h5>
                                            {empCurrentAssets.length === 0 ? (
                                                <div className="py-8 text-center text-slate-300">
                                                    <Package size={32} className="mx-auto mb-2 opacity-30" />
                                                    <p className="text-[10px] font-black uppercase tracking-widest">Sin activos en posesión actualmente</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {empCurrentAssets.map(aid => {
                                                        const mat = materialsMap.get(aid);
                                                        return mat ? (
                                                            <div key={aid} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                                                <div>
                                                                    <p className="text-xs font-black uppercase text-slate-800">{mat.name}</p>
                                                                    <p className="text-[9px] font-bold text-muted-foreground uppercase mt-0.5">{mat.category}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    <Badge variant="outline" className="text-[8px] font-black">SN: {mat.serialNumber || 'N/A'}</Badge>
                                                                    <p className="text-[8px] text-muted-foreground mt-1">CLASE {mat.class}</p>
                                                                </div>
                                                            </div>
                                                        ) : null;
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {/* Transaction history */}
                                        <div>
                                            <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 flex items-center gap-2">
                                                <History size={14} className="text-pagnol-orange" /> Historial de Operaciones
                                            </h5>
                                            {empTxs.length === 0 ? (
                                                <div className="py-8 text-center text-slate-300">
                                                    <Activity size={32} className="mx-auto mb-2 opacity-30" />
                                                    <p className="text-[10px] font-black uppercase tracking-widest">Sin operaciones registradas</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3">
                                                    {empTxs.map(tx => (
                                                        <div key={tx.id} className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50">
                                                            <div className={cn(
                                                                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                                                                tx.type === 'WITHDRAWAL' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                                                            )}>
                                                                {tx.type === 'WITHDRAWAL' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-[10px] font-black uppercase text-slate-800">
                                                                    {tx.type === 'WITHDRAWAL' ? 'Despacho' : 'Retorno'}
                                                                </p>
                                                                <p className="text-[9px] font-bold text-slate-500 flex items-center gap-1 mt-0.5 flex-wrap">
                                                                    <MapPin size={9} className="shrink-0" />
                                                                    {tx.type === 'WITHDRAWAL'
                                                                        ? <><span className="text-slate-400">Bodega</span> <ArrowRight size={9} className="text-slate-300 shrink-0" /> <span className={tx.site ? 'text-orange-500 font-black' : 'text-slate-300'}>{tx.site || 'Sin destino'}</span></>
                                                                        : <><span className="text-slate-400">{tx.site || 'Faena'}</span> <ArrowRight size={9} className="text-slate-300 shrink-0" /> <span className="text-green-600 font-black">Bodega Central</span></>
                                                                    }
                                                                </p>
                                                                <p className="text-[9px] text-muted-foreground font-bold mt-0.5">
                                                                    {tx.assetIds.length} activo(s) · {tx.timestamp.toLocaleDateString('es-CL')} {tx.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                                                </p>
                                                            </div>
                                                            <div className="shrink-0">
                                                                {tx.isBiometricVerified ? (
                                                                    <span title="Verificado biométricamente"><ShieldCheck size={16} className="text-green-500" /></span>
                                                                ) : (
                                                                    <span title="Sin verificación biométrica"><Shield size={16} className="text-slate-200" /></span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Reliability score bar */}
                                        <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                                            <div className="flex justify-between items-center mb-3">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Score de Responsabilidad Patrimonial</p>
                                                <p className={`text-sm font-black ${reliabilityScore >= 80 ? 'text-green-600' : reliabilityScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{reliabilityScore}%</p>
                                            </div>
                                            <Progress value={reliabilityScore} className="h-2" indicatorClassName={reliabilityScore >= 80 ? 'bg-green-500' : reliabilityScore >= 50 ? 'bg-amber-500' : 'bg-red-500'} />
                                            <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-3">
                                                {reliabilityScore >= 80 ? '✓ Excelente historial de retornos' : reliabilityScore >= 50 ? '⚠ Retornos parciales — revisar' : '✗ Activos sin retornar — acción requerida'}
                                            </p>
                                        </div>
                                    </div>
                                </ScrollArea>
                            </DialogContent>
                        </Dialog>
                    );
                })()}

                {/* ASSET TRAIL TAB */}
                {activeTab === 'ASSET_TRAIL' && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-4">
                        <div className="max-w-3xl mx-auto">
                            <Card className="rounded-[3rem] border shadow-2xl p-10 bg-slate-100">
                                <div className="text-center space-y-4 mb-10">
                                    <div className="w-20 h-20 bg-pagnol-orange/10 text-pagnol-orange rounded-3xl flex items-center justify-center mx-auto mb-6">
                                        <Search size={40} />
                                    </div>
                                    <h4 className="text-2xl font-black uppercase tracking-tighter">Buscador Detallado de Trazabilidad</h4>
                                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Rastree el historial completo de cualquier activo por ID o Serial</p>
                                </div>
                                <div className="relative group">
                                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-pagnol-orange transition-colors" size={24} />
                                    <input
                                        type="text"
                                        placeholder="INGRESE SERIAL, ID O CODIGO INTERNO..."
                                        className="w-full pl-16 pr-8 py-6 bg-slate-50 border-2 border-slate-100 rounded-[2rem] font-black text-lg uppercase outline-none focus:ring-8 focus:ring-pagnol-orange/5 focus:border-pagnol-orange/20 focus:bg-slate-100 transition-all shadow-inner"
                                        onChange={(e) => setSelectedAssetId(e.target.value)}
                                    />
                                </div>
                            </Card>
                        </div>

                        {selectedAssetId && (
                            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in duration-500">
                                {(() => {
                                    const asset = Array.from(materialsMap.values()).find(m => m.id.includes(selectedAssetId) || m.serialNumber?.includes(selectedAssetId) || m.internalCode?.includes(selectedAssetId));
                                    if (!asset) return (
                                        <div className="text-center py-20 opacity-30">
                                            <AlertTriangle size={48} className="mx-auto mb-4" />
                                            <p className="text-sm font-black uppercase tracking-widest">Activo no localizado en la base de datos</p>
                                        </div>
                                    );

                                    const assetTxs = transactions.filter(tx => tx.assetIds.includes(asset.id));

                                    return (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                            <Card className="md:col-span-1 rounded-[2.5rem] border-none shadow-xl bg-slate-100 p-8">
                                                <div className="aspect-square rounded-2xl bg-slate-50 border overflow-hidden mb-6 flex items-center justify-center">
                                                    <Package size={64} className="text-slate-200" />
                                                </div>
                                                <h5 className="text-lg font-black uppercase leading-tight">{asset.name}</h5>
                                                <p className="text-[10px] text-pagnol-orange font-black uppercase mt-2 tracking-widest">{asset.category}</p>
                                                <div className="mt-8 space-y-4">
                                                    <div className="flex justify-between items-center text-[10px] font-black uppercase border-b pb-3">
                                                        <span className="text-muted-foreground">ID</span>
                                                        <span>{asset.id}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[10px] font-black uppercase border-b pb-3">
                                                        <span className="text-muted-foreground">Serial</span>
                                                        <span>{asset.serialNumber || 'N/A'}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[10px] font-black uppercase border-b pb-3">
                                                        <span className="text-muted-foreground">Clase</span>
                                                        <Badge variant="outline">{asset.class}</Badge>
                                                    </div>
                                                </div>
                                            </Card>

                                            <Card className="md:col-span-2 rounded-[2.5rem] border-none shadow-xl bg-slate-100 p-10">
                                                <h5 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground mb-10 flex items-center gap-2">
                                                    <Clock size={16} /> Línea de Tiempo de Operaciones
                                                </h5>
                                                <div className="space-y-12 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-100">
                                                    {assetTxs.map((tx, idx) => (
                                                        <div key={tx.id} className="relative pl-12 group">
                                                            <div className={cn(
                                                                "absolute left-0 top-1 w-6 h-6 rounded-full border-4 border-white shadow-xl z-10 transition-transform group-hover:scale-125",
                                                                tx.type === 'WITHDRAWAL' ? 'bg-pagnol-orange' : 'bg-green-500'
                                                            )} />
                                                            <div className="space-y-2">
                                                                <div className="flex items-center justify-between">
                                                                    <p className="text-xs font-black uppercase text-slate-800">
                                                                        {tx.type === 'WITHDRAWAL' ? 'Despacho a Faena' : 'Retorno a Bodega'}
                                                                    </p>
                                                                    <Badge variant="outline" className="text-[9px] font-black font-mono tracking-wider">
                                                                        {tx.internalCode || tx.id.substring(0, 8).toUpperCase()}
                                                                    </Badge>
                                                                </div>
                                                                <div className="flex items-center gap-6">
                                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                                                                        <Users size={12} /> {tx.employeeName}
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                                                                        <Calendar size={12} /> {tx.timestamp.toLocaleDateString()}
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                                                                        <MapPin size={12} /> {tx.site}
                                                                    </div>
                                                                </div>
                                                                {tx.isBiometricVerified && (
                                                                    <div className="flex items-center gap-1.5 text-[9px] font-black text-green-600 uppercase pt-1">
                                                                        <ShieldCheck size={12} /> Identidad Validada Biométrica
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {assetTxs.length === 0 && (
                                                        <div className="text-center py-20 opacity-20">
                                                            <Activity size={32} className="mx-auto mb-2" />
                                                            <p className="text-[10px] font-black uppercase">Sin registros operativos</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </Card>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                )}

                {/* AUDIT TAB */}
                {activeTab === 'AUDIT' && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-4">
                        <Card className="rounded-[3rem] border-none shadow-2xl bg-slate-100 overflow-hidden">
                            <div className="p-10 border-b flex items-center justify-between bg-slate-50/50">
                                <div>
                                    <h3 className="text-xl font-black uppercase tracking-tight">Registro Maestro de Transacciones</h3>
                                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1">Auditoría completa de entradas y salidas</p>
                                </div>
                                <div className="flex gap-4">
                                    <div className="text-center px-6 py-2 bg-slate-100 rounded-2xl border">
                                        <p className="text-sm font-black text-slate-900">{transactions.length}</p>
                                        <p className="text-[8px] font-black uppercase text-muted-foreground">Total Logs</p>
                                    </div>
                                    <div className="text-center px-6 py-2 bg-slate-100 rounded-2xl border">
                                        <p className="text-sm font-black text-green-600">{transactions.filter(t => t.isBiometricVerified).length}</p>
                                        <p className="text-[8px] font-black uppercase text-muted-foreground">Firmados</p>
                                    </div>
                                </div>
                            </div>
                            <div className="overflow-x-auto no-scrollbar">
                                <table className="w-full text-left min-w-[900px]">
                                    <thead className="bg-slate-50/50 border-b">
                                        <tr>
                                            <th className="px-10 py-6 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Protocolo Referencia</th>
                                            <th className="px-10 py-6 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Operación</th>
                                            <th className="px-10 py-6 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Fecha y Hora</th>
                                            <th className="px-10 py-6 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Custodio / Responsable</th>
                                            <th className="px-10 py-6 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Sitio de Operación</th>
                                            <th className="px-10 py-6 text-[9px] font-black uppercase tracking-widest text-center text-muted-foreground">Garantía Judicial</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {transactions.map(tx => (
                                            <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="px-10 py-6">
                                                    <span className="font-mono text-xs font-black text-slate-800 group-hover:text-pagnol-orange transition-colors tracking-wider">
                                                        {tx.internalCode || tx.id.substring(0, 8).toUpperCase()}
                                                    </span>
                                                </td>
                                                <td className="px-10 py-6">
                                                    <div className={cn(
                                                        "flex items-center gap-2.5 text-[10px] font-black uppercase px-3 py-1.5 rounded-xl w-fit border",
                                                        tx.type === 'WITHDRAWAL' ? 'bg-orange-50 text-orange-600 border-orange-100' : 'bg-green-50 text-green-600 border-green-100'
                                                    )}>
                                                        {tx.type === 'WITHDRAWAL' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                                        {tx.type === 'WITHDRAWAL' ? 'DESPACHO' : 'RETORNO'}
                                                    </div>
                                                </td>
                                                <td className="px-10 py-6 text-[10px] font-bold text-slate-600">
                                                    {tx.timestamp.toLocaleDateString()} <span className="opacity-30 mx-1">|</span> {tx.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className="px-10 py-6">
                                                    <p className="font-black text-xs uppercase text-slate-800">{tx.employeeName}</p>
                                                    <p className="text-[9px] text-muted-foreground font-bold uppercase mt-1 tracking-tighter">
                                                        {usersMap.get(tx.employeeId)?.rut || usersMap.get(tx.employeeId)?.role || '—'}
                                                    </p>
                                                </td>
                                                <td className="px-10 py-6">
                                                    <Badge variant="outline" className="text-[9px] font-black uppercase border-slate-200">{tx.site}</Badge>
                                                </td>
                                                <td className="px-10 py-6">
                                                    <div className="flex justify-center">
                                                        {tx.isBiometricVerified ? (
                                                            <div className="flex items-center gap-2 text-green-600" title="Verificación Biométrica Exitosa">
                                                                <ShieldCheck size={20} />
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2 text-slate-200" title="Pendiente de Firma Digital">
                                                                <Shield size={20} />
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </div>
                )}

                {/* MAINTENANCE LOG TAB */}
                {activeTab === 'MAINTENANCE_LOG' && (
                    <div className="space-y-10 animate-in slide-in-from-bottom-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <Card className="rounded-[3rem] border-none shadow-xl bg-slate-100 p-10 overflow-hidden relative">
                                <div className="absolute top-0 right-0 p-10 opacity-[0.03]">
                                    <Wrench size={160} />
                                </div>
                                <div className="flex items-center gap-5 mb-10">
                                    <div className="w-14 h-14 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-200 transition-transform hover:scale-110">
                                        <Wrench size={28} />
                                    </div>
                                    <div>
                                        <h4 className="text-2xl font-black uppercase tracking-tighter">Equipos en Taller Técnico</h4>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">Activos con mantenimiento programado o correctivo</p>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    {materials?.filter(m => m.status === 'En Mantenimiento').map(m => (
                                        <div key={m.id} className="flex items-center justify-between p-6 bg-slate-50 border border-slate-100 rounded-[2rem] group hover:bg-slate-100 hover:shadow-xl transition-all duration-300">
                                            <div className="flex items-center gap-5">
                                                <div className="w-12 h-12 rounded-xl bg-slate-100 border shadow-sm flex items-center justify-center text-amber-500 uppercase font-black text-xs">
                                                    {m.usageType?.[0] || 'M'}
                                                </div>
                                                <div>
                                                    <p className="font-black uppercase text-sm text-slate-800">{m.name}</p>
                                                    <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">SN: {m.serialNumber || 'N/A'}</p>
                                                </div>
                                            </div>
                                            <Badge className="bg-amber-100 text-amber-600 border-none px-4 py-2 rounded-xl text-[9px] font-black uppercase">En Taller</Badge>
                                        </div>
                                    ))}
                                    {materials?.filter(m => m.status === 'En Mantenimiento').length === 0 && (
                                        <div className="py-20 text-center opacity-30">
                                            <ShieldCheck size={48} className="mx-auto mb-4" />
                                            <p className="text-xs font-black uppercase tracking-widest">No se reportan fallas técnicas</p>
                                        </div>
                                    )}
                                </div>
                            </Card>

                            <Card className="rounded-[3rem] border-none shadow-xl bg-slate-100 p-10 overflow-hidden relative">
                                <div className="absolute top-0 right-0 p-10 opacity-[0.03]">
                                    <AlertTriangle size={160} />
                                </div>
                                <div className="flex items-center gap-5 mb-10">
                                    <div className="w-14 h-14 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-200 transition-transform hover:scale-110">
                                        <AlertTriangle size={28} />
                                    </div>
                                    <div>
                                        <h4 className="text-2xl font-black uppercase tracking-tighter">Bajas de Activo Fijo</h4>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">Activos propuestos para retiro patrimonial</p>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    {materials?.filter(m => m.status === 'Para Baja').map(m => (
                                        <div key={m.id} className="flex items-center justify-between p-6 bg-slate-50 border border-slate-100 rounded-[2rem] group hover:bg-slate-100 hover:shadow-xl transition-all duration-300">
                                            <div className="flex items-center gap-5">
                                                <div className="w-12 h-12 rounded-xl bg-slate-100 border shadow-sm flex items-center justify-center text-red-600 uppercase font-black text-xs">
                                                    !
                                                </div>
                                                <div>
                                                    <p className="font-black uppercase text-sm text-slate-800">{m.name}</p>
                                                    <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 tracking-widest leading-none">
                                                        {m.internalCode || (m.serialNumber ? `SN: ${m.serialNumber}` : m.id.substring(0, 8).toUpperCase())}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[14px] font-black font-outfit text-slate-900 leading-none">${(m.unitCost || 0).toLocaleString()}</p>
                                                <p className="text-[8px] font-black uppercase text-muted-foreground mt-1">Valor Castigado</p>
                                            </div>
                                        </div>
                                    ))}
                                    {materials?.filter(m => m.status === 'Para Baja').length === 0 && (
                                        <div className="py-20 text-center opacity-30">
                                            <Package size={48} className="mx-auto mb-4" />
                                            <p className="text-xs font-black uppercase tracking-widest">Sin bajas pendientes</p>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </div>
                    </div>
                )}

                {/* IA DIAGNOSTIC TAB */}
                {activeTab === 'AI_INSIGHTS' && (
                    <div className="space-y-10 animate-in slide-in-from-bottom-4 pb-20">

                        {/* Hero card */}
                        <Card className="bg-slate-900 text-white shadow-2xl rounded-[3.5rem] overflow-hidden relative border-none">
                            <div className="absolute top-0 right-0 p-20 opacity-10 blur-2xl bg-pagnol-orange rounded-full -mr-20 -mt-20" />
                            <CardHeader className="p-12 md:p-16 relative z-10">
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="p-4 bg-slate-100/10 rounded-2xl backdrop-blur-md">
                                        <Sparkles size={28} className="text-pagnol-orange" />
                                    </div>
                                    <h3 className="text-3xl font-black uppercase tracking-tighter">IA Diagnostic</h3>
                                </div>
                                <CardDescription className="text-base text-muted-foreground font-medium max-w-xl leading-relaxed">
                                    IA que analiza inventario y genera alertas
                                </CardDescription>
                                <div className="pt-8 flex flex-wrap items-center gap-4">
                                    <Button
                                        onClick={handleGenerateAI}
                                        disabled={isGenerating || cooldownSeconds > 0}
                                        className="bg-pagnol-orange hover:bg-orange-600 text-white rounded-2xl h-14 px-10 text-sm font-black uppercase tracking-widest shadow-2xl shadow-pagnol-orange/40 transition-all hover:scale-105 active:scale-95 disabled:opacity-60 disabled:scale-100 disabled:cursor-not-allowed"
                                    >
                                        {isGenerating
                                            ? <><Loader2 className="animate-spin mr-2" size={16} /> Analizando inventario...</>
                                            : cooldownSeconds > 0
                                                ? <><Clock className="mr-2" size={16} /> Espera {cooldownSeconds}s</>
                                                : <><Sparkles className="mr-2" size={16} /> Analizar Inventario</>
                                        }
                                    </Button>
                                    {aiReport && !isGenerating && cooldownSeconds === 0 && (
                                        <button
                                            onClick={() => { setAiReport(null); setAiError(null); }}
                                            className="text-muted-foreground hover:text-white text-xs font-bold uppercase tracking-widest transition-colors"
                                        >
                                            Nueva consulta
                                        </button>
                                    )}
                                </div>
                            </CardHeader>
                        </Card>

                        {/* Error / cooldown */}
                        {aiError && !isGenerating && (
                            <div className={cn(
                                "rounded-[2rem] border p-8 flex items-start gap-5",
                                aiError === 'overloaded'
                                    ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                                    : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                            )}>
                                <div className={cn(
                                    "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0",
                                    aiError === 'overloaded' ? "bg-amber-100 dark:bg-amber-900 text-amber-600" : "bg-red-100 dark:bg-red-900 text-red-600"
                                )}>
                                    <AlertTriangle size={20} />
                                </div>
                                <div className="space-y-1">
                                    {aiError === 'overloaded' ? (
                                        <>
                                            <p className="font-black text-sm text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                                                Modelo con alta demanda
                                            </p>
                                            <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                                                El servicio de IA está temporalmente saturado. Esto ocurre cuando muchos usuarios lo consultan al mismo tiempo.
                                            </p>
                                            {cooldownSeconds > 0 && (
                                                <p className="text-xs font-black text-amber-600 dark:text-amber-500 uppercase tracking-widest mt-2">
                                                    Puedes volver a intentarlo en{' '}
                                                    <span className="text-amber-900 dark:text-amber-200 tabular-nums">
                                                        {Math.floor(cooldownSeconds / 60) > 0
                                                            ? `${Math.floor(cooldownSeconds / 60)}m ${cooldownSeconds % 60}s`
                                                            : `${cooldownSeconds}s`
                                                        }
                                                    </span>
                                                </p>
                                            )}
                                            {cooldownSeconds === 0 && (
                                                <button
                                                    onClick={handleGenerateAI}
                                                    className="text-xs font-black text-amber-700 dark:text-amber-400 underline underline-offset-4 uppercase tracking-widest mt-1"
                                                >
                                                    Intentar ahora
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <p className="font-black text-sm text-red-800 dark:text-red-300 uppercase tracking-wide">Error de IA</p>
                                            <p className="text-sm text-red-700 dark:text-red-400 font-medium">{aiError}</p>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Resultado del análisis */}
                        {aiReport && (
                            <div className="animate-in fade-in slide-in-from-bottom-10 duration-700">
                                <Card className="rounded-[3.5rem] border shadow-xl bg-card overflow-hidden">
                                    <div className="p-10 border-b flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-pagnol-orange text-white flex items-center justify-center">
                                                <Sparkles size={18} />
                                            </div>
                                            <h4 className="text-base font-black uppercase tracking-tight">Análisis de Inventario</h4>
                                        </div>
                                        <Badge className="bg-success-subtle text-success-subtle-foreground px-3 py-1.5 rounded-xl text-[10px] font-black uppercase">
                                            Generado ahora
                                        </Badge>
                                    </div>
                                    <CardContent className="p-10 md:p-14">
                                        <div className="prose prose-slate max-w-none dark:prose-invert prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tight prose-p:font-medium prose-p:text-muted-foreground prose-strong:text-foreground">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiReport}</ReactMarkdown>
                                        </div>
                                    </CardContent>
                                    <div className="px-10 py-5 border-t flex justify-between items-center text-muted-foreground text-[10px] font-bold uppercase tracking-[0.15em]">
                                        <span>Pagnol IA — Gemini 2.0 Flash</span>
                                        <span>Sugerencia orientativa</span>
                                    </div>
                                </Card>
                            </div>
                        )}

                        {/* Cards informativas — solo cuando no hay reporte ni error */}
                        {!aiReport && !isGenerating && !aiError && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {[
                                    { title: 'Alertas de Stock', desc: 'Detecta activos con stock crítico o agotado y sugiere órdenes de compra', icon: AlertTriangle },
                                    { title: 'Resumen de Inventario', desc: 'Resumen ejecutivo del valor total, clases A/B/C y distribución por categoría', icon: BarChart3 },
                                    { title: 'Acciones Recomendadas', desc: 'Acciones concretas basadas en el estado actual del inventario y movimientos', icon: ShieldCheck }
                                ].map((feature, i) => {
                                    const Icon = feature.icon;
                                    return (
                                        <div key={i} className="p-8 bg-card border rounded-[2rem] shadow-sm hover:shadow-lg transition-all duration-300 group">
                                            <div className="w-11 h-11 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center mb-5 group-hover:bg-pagnol-orange group-hover:text-white transition-all">
                                                <Icon size={22} />
                                            </div>
                                            <h5 className="font-black uppercase text-sm mb-2">{feature.title}</h5>
                                            <p className="text-xs text-muted-foreground font-medium leading-relaxed">{feature.desc}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
