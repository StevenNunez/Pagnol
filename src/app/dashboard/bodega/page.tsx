
"use client";
import * as React from 'react';
import Link from 'next/link';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
    Package,
    Wrench,
    ArrowRight,
    AlertTriangle,
    PackagePlus,
    PackageOpen,
    PackageCheck,
    ClipboardList,
    RotateCcw,
    History,
    TrendingDown,
    User as UserIcon,
    ArrowUpRight,
    ArrowDownLeft
} from 'lucide-react';
import { StatCard } from '@/components/admin/stat-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import type {
    Material,
    MaterialRequest,
    ReturnRequest,
    StockMovement,
    Tool,
    ToolLog,
    User,
} from '@/modules/core/lib/data';

// --- Tipos Auxiliares para la Vista ---
type ActivityItem = {
    id: string;
    date: Date;
    title: string;
    subtitle: string;
    user: string;
    type: 'entry' | 'exit' | 'warning';
    quantity?: number;
};

export default function WarehouseHubPage() {
    const {
        materials = [],
        tools = [],
        requests = [],
        toolLogs = [],
        returnRequests = [],
        stockMovements = [],
        users = [],
    } = useAppState();

    // --- Helpers & Memos ---

    // Optimización: Mapa de usuarios para búsqueda O(1)
    const userMap = React.useMemo(() => {
        const map = new Map<string, User>();
        users.forEach((u) => map.set(u.id, u));
        return map;
    }, [users]);

    // Optimización: Mapa de materiales
    const materialMap = React.useMemo(() => {
        const map = new Map<string, Material>();
        materials.forEach((m) => map.set(m.id, m));
        return map;
    }, [materials]);

    const toDate = (date: Date | string | null | undefined): Date | null => {
        if (!date) return null;
        return date instanceof Date ? date : new Date(date as any);
    };

    const getRelativeTime = (date: Date | null) => {
        if (!date) return '';
        try {
            return formatDistanceToNow(date, { addSuffix: true, locale: es });
        } catch (e) {
            return 'Fecha inválida';
        }
    };

    // --- Estadísticas Principales ---
    const stats = React.useMemo(() => {
        const checkedOutToolsCount = new Set(
            toolLogs
                .filter((log) => log.returnDate === null)
                .map((log) => log.toolId)
        ).size;

        const materialsInFaena = materials.filter(m => !m.archived && (m.inUse ?? 0) > 0).length;

        return {
            totalMaterials: materials.length,
            totalTools: tools.length,
            toolsInUse: checkedOutToolsCount,
            toolsAvailable: Math.max(0, tools.length - checkedOutToolsCount),
            materialsInFaena,
        };
    }, [materials, tools, toolLogs]);

    // --- Stock Bajo (Top 10 críticos) ---
    const lowStockMaterials = React.useMemo(() => {
        return materials
            .filter((m) => !m.archived && m.stock <= 10) // Ajusté a <= para incluir el 10
            .sort((a, b) => a.stock - b.stock) // Menor stock primero
            .slice(0, 5); // Top 5 para no saturar la UI inicial
    }, [materials]);

    // --- Actividad Reciente (Salidas) ---
    const recentExits: ActivityItem[] = React.useMemo(() => {
        return requests
            .filter((r) => r.status === 'approved' && (r.approvalDate || r.createdAt))
            .sort((a, b) => {
                const dateA = toDate(a.approvalDate || a.createdAt)?.getTime() || 0;
                const dateB = toDate(b.approvalDate || b.createdAt)?.getTime() || 0;
                return dateB - dateA;
            })
            .slice(0, 10)
            .map((r: any) => {
                const date = toDate(r.approvalDate || r.createdAt) || new Date();
                const supervisorName = userMap.get(r.supervisorId)?.name || 'Desconocido';
                // Lógica para obtener nombre del material (soporte legacy y array)
                let title = 'Solicitud de Material';
                const items = r.items || (r.materialId ? [{ materialId: r.materialId, quantity: r.quantity || 0 }] : []);

                if (items.length === 1) {
                    const matName = materialMap.get(items[0].materialId)?.name || 'Material';
                    title = `${items[0].quantity} x ${matName}`;
                } else if (items.length > 1) {
                    title = `${items.length} materiales varios`;
                } else if (r.materialName) {
                    title = `${r.quantity} x ${r.materialName}`;
                }

                return {
                    id: r.id,
                    date,
                    title,
                    subtitle: `Destino: ${r.area}`,
                    user: supervisorName,
                    type: 'exit',
                };
            });
    }, [requests, userMap, materialMap]);

    // --- Actividad Reciente (Entradas) ---
    const recentEntries: ActivityItem[] = React.useMemo(() => {
        const returns = returnRequests
            .filter((r) => r.status === 'completed' && r.completionDate)
            .map((r) => ({
                id: r.id,
                date: toDate(r.completionDate)!,
                title: `${r.quantity} x ${r.materialName}`,
                subtitle: 'Devolución de obra',
                user: r.supervisorName || 'Desconocido',
                type: 'entry' as const,
            }));

        const manuals = stockMovements
            .filter((m) => m.type === 'manual-entry' && m.quantityChange > 0)
            .map((m) => ({
                id: m.id,
                date: toDate(m.date)!,
                title: `${m.quantityChange} x ${m.materialName}`,
                subtitle: 'Ingreso Manual / Compra',
                user: m.userName || 'Admin',
                type: 'entry' as const,
            }));

        return [...returns, ...manuals]
            .sort((a, b) => b.date.getTime() - a.date.getTime())
            .slice(0, 10);
    }, [returnRequests, stockMovements]);


    return (
        <div className="flex flex-col gap-8 pb-10 fade-in">
            <PageHeader
                title="Centro de Control de Bodega"
                description="Vista general del inventario, alertas y movimientos recientes."
            />

            {/* 1. SECCIÓN DE ACCIONES RÁPIDAS */}
            <section>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <Link href="/dashboard/bodega/requests" passHref>
                        <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2 hover:border-primary hover:bg-primary/5 transition-all">
                            <ClipboardList className="h-6 w-6 text-primary" />
                            <span className="font-semibold">Solicitudes</span>
                        </Button>
                    </Link>
                    <Link href="/dashboard/bodega/return-requests" passHref>
                        <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-all">
                            <RotateCcw className="h-6 w-6 text-blue-500" />
                            <span className="font-semibold">Devoluciones</span>
                        </Button>
                    </Link>
                    <Link href="/dashboard/bodega/manual-stock-entry" passHref>
                        <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2 hover:border-amber-500 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 transition-all">
                            <PackagePlus className="h-6 w-6 text-amber-500" />
                            <span className="font-semibold">Ingreso Stock</span>
                        </Button>
                    </Link>
                    <Link href="/dashboard/bodega/tools" passHref>
                        <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2 hover:border-purple-500 hover:bg-purple-50/50 dark:hover:bg-purple-950/30 transition-all">
                            <Wrench className="h-6 w-6 text-purple-500" />
                            <span className="font-semibold">Herramientas</span>
                        </Button>
                    </Link>
                    <Link href="/dashboard/pagnol/movimientos" passHref>
                        <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2 hover:border-teal-500 hover:bg-teal-50/50 dark:hover:bg-teal-950/30 transition-all col-span-2 md:col-span-1">
                            <ArrowUpRight className="h-6 w-6 text-teal-500" />
                            <span className="font-semibold">Pagnol → Faena</span>
                        </Button>
                    </Link>
                </div>
            </section>

            {/* 2. STATS CARDS */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Materiales Únicos" value={stats.totalMaterials} icon={Package} />
                <StatCard title="En Faena (Pagnol)" value={stats.materialsInFaena} icon={ArrowUpRight} color="text-amber-500" />
                <StatCard title="Herramientas" value={stats.totalTools} icon={Wrench} />
                <StatCard title="Herram. Disponibles" value={stats.toolsAvailable} icon={PackageCheck} color="text-green-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* 3. COLUMNA IZQUIERDA: ALERTAS DE STOCK (VISUAL MEJORADO) */}
                <div className="lg:col-span-1 space-y-6">
                    <Card className="border-l-4 border-l-red-500 shadow-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                                <TrendingDown className="h-5 w-5" /> Stock Crítico
                            </CardTitle>
                            <CardDescription>
                                Materiales con 10 o menos unidades.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {lowStockMaterials.length > 0 ? (
                                <div className="space-y-4">
                                    {lowStockMaterials.map((material) => {
                                        // Calculamos porcentaje visual (asumiendo 20 como base "sana" visualmente)
                                        const percentage = Math.min((material.stock / 20) * 100, 100);
                                        return (
                                            <div key={material.id} className="space-y-1.5">
                                                <div className="flex justify-between items-end">
                                                    <div>
                                                        <p className="font-medium text-sm text-foreground">{material.name}</p>
                                                        <p className="text-xs text-muted-foreground">{material.category}</p>
                                                    </div>
                                                    <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 dark:bg-red-950 dark:text-red-300 font-mono">
                                                        {material.stock} {material.unit}
                                                    </Badge>
                                                </div>
                                                <Progress value={percentage} className="h-2 bg-red-100 dark:bg-red-900/50" />
                                            </div>
                                        );
                                    })}
                                    <Link href="/dashboard/bodega/materials" className="block mt-4">
                                        <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground">
                                            Ver inventario completo <ArrowRight className="ml-1 h-3 w-3" />
                                        </Button>
                                    </Link>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-8">
                                    <PackageCheck className="h-10 w-10 text-green-500 mb-2 opacity-50" />
                                    <p className="text-sm">Todo el stock está saludable.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* 4. COLUMNA DERECHA: ACTIVIDAD RECIENTE (TABLERO UNIFICADO VISUALMENTE) */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
                        {/* SALIDAS RECIENTES */}
                        <Card className="flex flex-col h-full">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <ArrowUpRight className="h-5 w-5 text-orange-500" /> Salidas Recientes
                                </CardTitle>
                                <CardDescription>Entregas de material a obra</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1">
                                <ScrollArea className="h-[400px] pr-4">
                                    {recentExits.length > 0 ? (
                                        <ul className="space-y-4">
                                            {recentExits.map((item) => (
                                                <li key={item.id} className="flex gap-3 items-start">
                                                    <div className="mt-1 bg-orange-100 dark:bg-orange-950 p-1.5 rounded-full shrink-0">
                                                        <PackageOpen className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                                                    </div>
                                                    <div className="space-y-0.5 w-full">
                                                        <p className="text-sm font-medium leading-none">{item.title}</p>
                                                        <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                                                        <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-dashed">
                                                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
                                                                <UserIcon className="h-3 w-3" /> {item.user.split(' ')[0]}
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {getRelativeTime(item.date)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                                            No hay salidas registradas recientemente.
                                        </div>
                                    )}
                                </ScrollArea>
                            </CardContent>
                        </Card>

                        {/* INGRESOS RECIENTES */}
                        <Card className="flex flex-col h-full">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <ArrowDownLeft className="h-5 w-5 text-green-500" /> Ingresos Recientes
                                </CardTitle>
                                <CardDescription>Devoluciones y compras</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1">
                                <ScrollArea className="h-[400px] pr-4">
                                    {recentEntries.length > 0 ? (
                                        <ul className="space-y-4">
                                            {recentEntries.map((item) => (
                                                <li key={item.id} className="flex gap-3 items-start">
                                                    <div className="mt-1 bg-green-100 dark:bg-green-950 p-1.5 rounded-full shrink-0">
                                                        <PackageCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
                                                    </div>
                                                    <div className="space-y-0.5 w-full">
                                                        <p className="text-sm font-medium leading-none">{item.title}</p>
                                                        <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                                                        <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-dashed">
                                                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
                                                                <UserIcon className="h-3 w-3" /> {item.user.split(' ')[0]}
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {getRelativeTime(item.date)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                                            No hay ingresos registrados recientemente.
                                        </div>
                                    )}
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}

