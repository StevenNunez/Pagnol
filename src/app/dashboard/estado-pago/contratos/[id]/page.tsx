
'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import {
    Loader2,
    ChevronDown,
    ChevronRight,
    FolderTree,
    GanttChartSquare,
    TrendingUp,
    DollarSign,
    Briefcase,
    CalendarCheck,
    ArrowLeft,
    Info,
    AlertTriangle,
    CheckCircle2,
    FileCheck,
    Send
} from 'lucide-react';
import {
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { WorkItem, ProgressLog } from '@/modules/core/lib/data';
import { generateEstadoDePagoPDF } from '@/lib/ep-pdf-generator';
import { useToast } from '@/modules/core/hooks/use-toast';
import { RegisterProgressForm } from '@/components/operations/register-progress-form';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, eachDayOfInterval, differenceInDays, startOfDay, isAfter, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';
import { Progress } from '@/components/ui/progress';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

// Importación dinámica de Gantt para evitar errores de SSR
const Gantt = dynamic(() => import('gantt-task-react').then(mod => mod.Gantt), {
    ssr: false,
    loading: () => <div className="h-[300px] flex items-center justify-center bg-muted/10 text-muted-foreground"><Loader2 className="h-8 w-8 animate-spin" /></div>
});
import { ViewMode, type Task } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css'; // Asegúrate de importar los estilos

// --- Tipos y Helpers ---

type TreeWorkItem = WorkItem & { children: TreeWorkItem[] };

/**
 * Construye un árbol jerárquico a partir de una lista plana de items, 
 * filtrando solo la rama que pertenece al contrato (rootId) especificado.
 */
const buildTree = (items: WorkItem[], rootId: string): TreeWorkItem[] => {
    const itemMap = new Map<string, TreeWorkItem>();
    const roots: TreeWorkItem[] = [];

    // 1. Inicializar nodos
    items.forEach(item => {
        itemMap.set(item.id, { ...item, children: [] });
    });

    // 2. Construir relaciones
    items.forEach(item => {
        if (item.id === rootId) {
            roots.push(itemMap.get(item.id)!);
        } else if (item.parentId && itemMap.has(item.parentId)) {
            // Verificar recursivamente si este ítem pertenece al árbol del contrato
            let current = itemMap.get(item.id);
            let parent = itemMap.get(item.parentId);

            // Solo agregamos si el padre existe en nuestro mapa (es parte del contrato)
            if (parent) {
                parent.children.push(current!);
            }
        }
    });

    const sortRecursive = (nodes: TreeWorkItem[]) => {
        nodes.sort((a, b) => (a.path || '').localeCompare(b.path || ''));
        nodes.forEach(n => sortRecursive(n.children));
    };

    // Encontrar el nodo raíz del proyecto actual
    const projectNode = roots.find(node => node.id === rootId);

    // Si encontramos el contrato raíz, devolvemos ese nodo (y sus hijos ya enlazados)
    // Si no, buscamos en los items si alguno es el rootId (caso borde)
    const actualRoot = projectNode || itemMap.get(rootId);

    if (actualRoot) {
        sortRecursive(actualRoot.children);
        return [actualRoot];
    }

    return [];
};

// --- Componentes UI Internos ---

const WorkItemNode = ({
    node,
    level = 0,
    onSelect,
    onDoubleClick,
    selectedId,
}: {
    node: TreeWorkItem;
    level?: number;
    onSelect: (item: WorkItem) => void;
    onDoubleClick: (item: WorkItem) => void;
    selectedId: string | null;
}) => {
    // Expandir automáticamente los primeros 2 niveles
    const [isExpanded, setIsExpanded] = useState(level < 2);
    const hasChildren = node.children.length > 0;
    const progress = node.progress || 0;
    const isSelected = selectedId === node.id;

    return (
        <div className="relative select-none">
            <div
                onClick={() => onSelect(node)}
                onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(node); }}
                className={cn(
                    'flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer transition-all duration-200 border border-transparent',
                    isSelected
                        ? 'bg-blue-50 border-blue-200 shadow-sm dark:bg-blue-900/20 dark:border-blue-800'
                        : 'hover:bg-muted/50'
                )}
                style={{ marginLeft: `${level * 1.2}rem` }}
            >
                {/* Línea guía visual para la jerarquía */}
                {level > 0 && (
                    <div className="absolute left-0 top-0 bottom-0 border-l border-dashed border-gray-300 dark:border-gray-700" style={{ left: `${(level * 1.2) - 0.6}rem` }} />
                )}

                <button
                    onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                    className={cn(
                        "p-0.5 rounded-md hover:bg-muted-foreground/10 transition-colors h-5 w-5 flex items-center justify-center shrink-0 text-muted-foreground",
                        !hasChildren && "invisible"
                    )}
                >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                <div className="flex-grow min-w-0 grid gap-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate text-foreground flex items-center gap-2" title={node.name}>
                            <Badge variant="outline" className="font-mono text-[10px] px-1 py-0 h-5 text-muted-foreground border-gray-300">{node.path}</Badge>
                            {node.name}
                        </span>
                    </div>
                    {/* Barra de progreso mini */}
                    <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-1.5 flex-grow bg-gray-200 dark:bg-gray-700" indicatorClassName={progress >= 100 ? "bg-green-500" : "bg-blue-600"} />
                    </div>
                </div>

                <span className={cn(
                    "text-[10px] font-mono font-bold w-10 text-right shrink-0",
                    progress >= 100 ? "text-green-600" : "text-muted-foreground"
                )}>
                    {progress.toFixed(0)}%
                </span>
            </div>

            {hasChildren && isExpanded && (
                <div className="animate-in slide-in-from-top-1 fade-in duration-200">
                    {node.children.map((child) => (
                        <WorkItemNode
                            key={child.id}
                            node={child}
                            level={level + 1}
                            onSelect={onSelect}
                            onDoubleClick={onDoubleClick}
                            selectedId={selectedId}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const WorkItemTree = ({ workItems, onSelect, onDoubleClick, selectedId, rootId }: { workItems: WorkItem[], onSelect: (item: WorkItem) => void, onDoubleClick: (item: WorkItem) => void, selectedId: string | null, rootId: string }) => {
    const tree = useMemo(() => buildTree(workItems || [], rootId), [workItems, rootId]);

    if (!workItems.length) return <div className="p-4 text-center text-sm text-muted-foreground">No hay partidas disponibles.</div>;

    return (
        <ScrollArea className="h-[500px] border rounded-md bg-card/50">
            <div className="p-2 space-y-1">
                {tree.map((node) => (
                    <WorkItemNode
                        key={node.id}
                        node={node}
                        onSelect={onSelect}
                        onDoubleClick={onDoubleClick}
                        selectedId={selectedId}
                        level={0}
                    />
                ))}
            </div>
        </ScrollArea>
    );
};

// --- Componente Principal ---

export default function ContractorContractDetailPage() {
    const router = useRouter();
    const params = useParams();
    const contractId = params.id as string;

    const { toast } = useToast();
    const { user } = useAuth();
    const { workItems, isLoading, progressLogs, addPaymentState } = useAppState();
    const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
    const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
    const [isGeneratingEP, setIsGeneratingEP] = useState(false);

    // 1. Obtener Contrato y sus Ítems (Jerarquía)
    const { contract, contractItems } = useMemo(() => {
        if (!workItems || !user || !contractId) return { contract: null, contractItems: [] };

        // Obtener todos los items donde el usuario es responsable o creador
        const allUserItems = workItems.filter(item => item.assignedTo === user.id || item.createdBy === user.id);

        // Buscar el contrato raíz
        const contract = allUserItems.find(item => item.id === contractId);

        if (!contract) return { contract: null, contractItems: [] };

        // Construir lista plana de todos los hijos de este contrato
        const itemsForThisContract: WorkItem[] = [contract];
        const findChildren = (parentId: string) => {
            const children = allUserItems.filter(item => item.parentId === parentId);
            children.forEach(child => {
                itemsForThisContract.push(child);
                findChildren(child.id);
            });
        };
        findChildren(contractId);

        return { contract, contractItems: itemsForThisContract };
    }, [workItems, user, contractId]);

    // 2. Preparar tareas para Gantt con Jerarquía
    const tasksForGantt = useMemo(() => contractItems.map((item: WorkItem): Task => {
        const isProject = 'children' in item && Array.isArray(item.children) && item.children.length > 0 || item.id === contractId;
        return {
            id: item.id,
            name: item.name,
            type: 'task', // Usamos 'task' genérico pero agrupamos con 'project' property
            project: item.parentId || undefined, // Esto permite el agrupamiento en la librería Gantt
            start: item.plannedStartDate ? new Date(item.plannedStartDate) : new Date(),
            end: item.plannedEndDate ? new Date(item.plannedEndDate) : new Date(),
            progress: item.progress || 0,
            isDisabled: true, // Solo lectura
            styles: {
                progressColor: progressLogs?.some(l => l.workItemId === item.id) ? '#10b981' : '#3b82f6', // Verde si hay avance, Azul si no
                progressSelectedColor: '#10b981',
                backgroundColor: isProject ? '#8b5cf6' : '#3b82f6', // Púrpura para padres, Azul para hijos
                backgroundSelectedColor: '#2563eb'
            },
            // Ocultar hijos por defecto en el Gantt si son muchos puede ser útil, aquí los mostramos
            hideChildren: false
        };
    }).sort((a, b) => a.start.getTime() - b.start.getTime()), [contractItems, contractId, progressLogs]);

    // 3. Calcular Curva S y KPIs Financieros (Optimizado)
    const { sCurveData, financialKPIs, spi } = useMemo(() => {
        if (tasksForGantt.length === 0 || !contract) return { sCurveData: [], financialKPIs: { totalContract: 0, earnedValue: 0, progressWeighted: 0 }, spi: 0 };

        // Filtrar fechas válidas
        const validTasks = tasksForGantt.filter(t => !isNaN(t.start.getTime()) && !isNaN(t.end.getTime()));
        if (validTasks.length === 0) return { sCurveData: [], financialKPIs: { totalContract: 0, earnedValue: 0, progressWeighted: 0 }, spi: 0 };

        const projectStart = new Date(Math.min(...validTasks.map(d => d.start.getTime())));
        const projectEnd = new Date(Math.max(...validTasks.map(d => d.end.getTime())));

        // Buffer visual para la gráfica
        const chartEnd = new Date(Math.max(projectEnd.getTime(), new Date().getTime()));
        const dateRange = eachDayOfInterval({ start: projectStart, end: chartEnd });

        const totalContractValue = contractItems.reduce((acc, item) => acc + ((item.quantity || 0) * (item.unitPrice || 0)), 0);
        const totalEarnedValue = contractItems.reduce((acc, item) => acc + ((item.quantity || 0) * (item.unitPrice || 0) * (item.progress || 0) / 100), 0);

        const today = startOfDay(new Date());
        let currentPlannedValue = 0;

        const sCurve = dateRange.map(day => {
            let dailyPlanned = 0;

            contractItems.forEach(item => {
                if (!item.plannedStartDate || !item.plannedEndDate || item.id === contractId) return; // Ignorar raíz para suma

                const taskStart = startOfDay(new Date(item.plannedStartDate));
                const taskEnd = startOfDay(new Date(item.plannedEndDate));
                const duration = differenceInDays(taskEnd, taskStart) + 1;
                const itemValue = (item.quantity || 0) * (item.unitPrice || 0);

                if (duration > 0 && totalContractValue > 0) {
                    const weight = itemValue / totalContractValue;

                    if (isAfter(day, taskEnd)) {
                        dailyPlanned += (100 * weight);
                    } else if (!isBefore(day, taskStart)) {
                        const daysPassed = differenceInDays(day, taskStart) + 1;
                        const progressPercent = (daysPassed / duration) * 100;
                        dailyPlanned += (progressPercent * weight);
                    }
                }
            });

            // Capturar el valor planificado a la fecha de hoy para el SPI
            if (day.getTime() === today.getTime()) {
                currentPlannedValue = dailyPlanned;
            }

            return {
                date: format(day, 'dd/MM', { locale: es }),
                timestamp: day.getTime(),
                Planificado: Math.min(100, Math.round(dailyPlanned)),
                // Solo mostramos la curva Real hasta el día de hoy
                Real: isAfter(day, today) ? null : Math.min(100, Math.round((totalEarnedValue / totalContractValue) * 100) || 0)
            };
        });

        // SPI (Schedule Performance Index) = EV / PV
        const currentProgressPercent = totalContractValue > 0 ? (totalEarnedValue / totalContractValue) * 100 : 0;
        const spiValue = currentPlannedValue > 0 ? currentProgressPercent / currentPlannedValue : 1;

        return {
            sCurveData: sCurve,
            financialKPIs: {
                totalContract: totalContractValue,
                earnedValue: totalEarnedValue,
                progressWeighted: currentProgressPercent
            },
            spi: spiValue
        };
    }, [tasksForGantt, contractItems, contract, contractId]);

    // 4. Logs del ítem seleccionado
    const selectedItemLogs = useMemo(() => {
        if (!selectedItem || !progressLogs) return [];
        return progressLogs
            .filter((log: ProgressLog) => log.workItemId === selectedItem.id)
            .sort((a, b) => {
                const dateA = new Date(a.date as any);
                const dateB = new Date(b.date as any);
                return dateB.getTime() - dateA.getTime();
            });
    }, [selectedItem, progressLogs]);

    const handleGenerateEP = async () => {
        if (!user || !contract) return;
        setIsGeneratingEP(true);
        try {
            const leafItems = contractItems.filter(i => i.id !== contractId);
            const epId = await addPaymentState({
                totalValue: financialKPIs.totalContract,
                earnedValue: financialKPIs.earnedValue,
                items: leafItems,
            } as any);
            await generateEstadoDePagoPDF(epId, user.name, financialKPIs.totalContract, financialKPIs.earnedValue, leafItems);
            toast({
                title: 'Estado de Pago Generado',
                description: 'El documento PDF se descargó y el registro fue guardado en el historial.',
                className: 'border-green-500',
            });
            router.push('/dashboard/estado-pago/historial');
        } catch (err: any) {
            toast({ title: 'Error', description: err?.message ?? 'No se pudo generar el estado de pago.', variant: 'destructive' });
        } finally {
            setIsGeneratingEP(false);
        }
    };

    const handleDoubleClick = (item: WorkItem) => {
        if (item.id !== contractId) {
            setSelectedItem(item);
            setIsProgressModalOpen(true);
        }
    };

    const formatDate = (date: Date | string | undefined) => {
        if (!date) return 'N/A';
        const jsDate = date instanceof Date ? date : new Date(date as any);
        return format(jsDate, "dd MMM yyyy", { locale: es });
    };

    if (isLoading) {
        return (
            <div className="flex h-[80vh] items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
        )
    }

    if (!contract) {
        return (
            <div className="text-center py-20">
                <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <Briefcase className="h-8 w-8 text-muted-foreground" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Contrato no encontrado</h2>
                <p className="text-muted-foreground mb-6">El contrato que buscas no existe o no tienes permiso para verlo.</p>
                <Button onClick={() => router.push('/dashboard/estado-pago')}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Volver a mis contratos
                </Button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-8 fade-in pb-12">
            {/* Estilos locales para Gantt */}
            <style jsx global>{`
        .gantt-container { --gantt-font-family: var(--font-sans), system-ui, sans-serif; }
        .gantt-container ._3_pmuJ, .gantt-container ._291r0X, .gantt-container ._1n_4l- { background-color: hsl(var(--card)) !important; color: hsl(var(--foreground)); }
        .gantt-container ._3_pmuJ button { color: hsl(var(--muted-foreground)) !important; font-weight: 600; }
        .gantt-container ._2-D47- { stroke: hsl(var(--border)) !important; }
        .gantt-container ._1YV57- { stroke: #8b5cf6 !important; stroke-width: 2px; } /* Today line */
      `}</style>

            {selectedItem && (
                <Dialog open={isProgressModalOpen} onOpenChange={setIsProgressModalOpen}>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <CalendarCheck className="h-5 w-5 text-primary" /> Registrar Avance
                            </DialogTitle>
                            <DialogDescription>
                                Actualizando: <span className="font-semibold text-foreground">{selectedItem.name}</span>
                            </DialogDescription>
                        </DialogHeader>
                        <RegisterProgressForm workItem={selectedItem} onSuccess={() => setIsProgressModalOpen(false)} />
                    </DialogContent>
                </Dialog>
            )}

            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/estado-pago')} className="hover:bg-muted/50 shrink-0">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <PageHeader
                        title={contract.name}
                        description={`Contrato #${contract.id.substring(0, 8).toUpperCase()} • ${user?.name.split(' ')[0] || 'Contratista'}`}
                        className="mb-0 border-0 pb-0"
                    />
                </div>
                <Button
                    onClick={handleGenerateEP}
                    disabled={isGeneratingEP || financialKPIs.earnedValue === 0}
                    className="bg-green-600 hover:bg-green-700 shrink-0"
                >
                    {isGeneratingEP
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <Send className="mr-2 h-4 w-4" />
                    }
                    Generar Estado de Pago
                </Button>
            </div>

            {/* --- KPI CARDS (Resumen Financiero) --- */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-blue-50/50 border-blue-100 dark:bg-blue-900/10 dark:border-blue-800">
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className="p-3 bg-blue-100 dark:bg-blue-800 rounded-full text-blue-600 dark:text-blue-100 shadow-sm">
                            <DollarSign className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase">Monto Total</p>
                            <h3 className="text-xl font-bold text-foreground">${financialKPIs.totalContract.toLocaleString('es-CL', { maximumFractionDigits: 0 })}</h3>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-green-50/50 border-green-100 dark:bg-green-900/10 dark:border-green-800">
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className="p-3 bg-green-100 dark:bg-green-800 rounded-full text-green-600 dark:text-green-100 shadow-sm">
                            <TrendingUp className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase">Valor Ganado</p>
                            <h3 className="text-xl font-bold text-foreground">${financialKPIs.earnedValue.toLocaleString('es-CL', { maximumFractionDigits: 0 })}</h3>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className="p-3 bg-purple-100 dark:bg-purple-800 rounded-full text-purple-600 dark:text-purple-100 shadow-sm">
                            <Briefcase className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase">Avance Ponderado</p>
                            <h3 className="text-xl font-bold text-foreground">{financialKPIs.progressWeighted.toFixed(1)}%</h3>
                        </div>
                    </CardContent>
                </Card>

                {/* Card SPI (Eficiencia) */}
                <Card className={cn(
                    "border-l-4",
                    spi >= 1 ? "border-l-green-500" : "border-l-red-500"
                )}>
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className={cn(
                            "p-3 rounded-full shadow-sm",
                            spi >= 1 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                        )}>
                            {spi >= 1 ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase">SPI (Eficiencia)</p>
                            <h3 className={cn("text-xl font-bold", spi >= 1 ? "text-green-700" : "text-red-700")}>
                                {spi.toFixed(2)}x
                            </h3>
                            <p className="text-[10px] text-muted-foreground">
                                {spi >= 1 ? "Adelantado" : "Retrasado"}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-4 space-y-6">
                    <Card className="flex flex-col border-l-4 border-l-blue-500 shadow-sm h-[600px]">
                        <CardHeader className="pb-4">
                            <CardTitle className="flex items-center gap-2 text-lg"><FolderTree className="h-5 w-5 text-blue-500" /> Estructura WBS</CardTitle>
                            <CardDescription>Haz doble clic para registrar avance.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0 flex-1 overflow-hidden">
                            <WorkItemTree
                                workItems={contractItems}
                                onSelect={setSelectedItem}
                                onDoubleClick={handleDoubleClick}
                                selectedId={selectedItem?.id || null}
                                rootId={contractId}
                            />
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-8 space-y-6">
                    {selectedItem ? (
                        <Card className="border-t-4 border-t-green-500 shadow-md">
                            <CardHeader className="pb-4 border-b bg-muted/20">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <Badge variant="outline" className="mb-2 font-mono bg-background">{selectedItem.path}</Badge>
                                        <CardTitle className="text-xl">{selectedItem.name}</CardTitle>
                                        <CardDescription className="mt-1">
                                            Precio Unitario: <span className="font-mono font-medium text-foreground">${selectedItem.unitPrice?.toLocaleString()}</span> • Cantidad: {selectedItem.quantity.toLocaleString()} {selectedItem.unit}
                                        </CardDescription>
                                    </div>
                                    <Button onClick={() => setIsProgressModalOpen(true)} className="bg-green-600 hover:bg-green-700">
                                        <CalendarCheck className="mr-2 h-4 w-4" /> Registrar Avance
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="p-6 bg-muted/10 grid grid-cols-3 gap-4 text-center border-b">
                                    <div>
                                        <p className="text-xs uppercase text-muted-foreground font-bold">Avance Actual</p>
                                        <p className="text-2xl font-bold text-green-600">{selectedItem.progress || 0}%</p>
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase text-muted-foreground font-bold">Por Ejecutar</p>
                                        <p className="text-2xl font-bold text-blue-600">{100 - (selectedItem.progress || 0)}%</p>
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase text-muted-foreground font-bold">Valor Ejecutado</p>
                                        <p className="text-2xl font-bold text-foreground">
                                            ${((selectedItem.quantity * selectedItem.unitPrice) * (selectedItem.progress || 0) / 100).toLocaleString('es-CL', { maximumFractionDigits: 0 })}
                                        </p>
                                    </div>
                                </div>

                                <div className="p-4">
                                    <h4 className="font-medium mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                                        <Info className="h-4 w-4" /> Historial de Registros
                                    </h4>
                                    <ScrollArea className="h-[250px] border rounded-md">
                                        <Table>
                                            <TableHeader className="bg-muted/50 sticky top-0">
                                                <TableRow>
                                                    <TableHead className="w-[120px]">Fecha</TableHead>
                                                    <TableHead className="text-right">Cantidad</TableHead>
                                                    <TableHead>Usuario</TableHead>
                                                    <TableHead className="w-[40%]">Observaciones</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {selectedItemLogs.length > 0 ? (
                                                    selectedItemLogs.map(log => (
                                                        <TableRow key={log.id}>
                                                            <TableCell className="font-mono text-xs w-28">{formatDate(log.date)}</TableCell>
                                                            <TableCell className="text-right font-bold text-green-600 w-24">+{log.quantity.toLocaleString()}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">{log.userName}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground italic truncate max-w-[200px]">{log.observations || "-"}</TableCell>
                                                        </TableRow>
                                                    ))
                                                ) : (
                                                    <TableRow><TableCell colSpan={4} className="text-center h-24 text-muted-foreground">Sin historial de avance.</TableCell></TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </ScrollArea>
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="h-[500px] flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl bg-card">
                            <div className="p-6 bg-muted/50 rounded-full mb-6 animate-pulse">
                                <CalendarCheck className="h-12 w-12 text-muted-foreground/50" />
                            </div>
                            <h3 className="text-xl font-semibold text-foreground">Selecciona una Partida</h3>
                            <p className="max-w-md text-center mt-2 text-sm">
                                Navega por la estructura a la izquierda y selecciona una actividad para ver sus detalles, presupuesto y registrar avances físicos.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-4">
                <Card className="shadow-md">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2"><GanttChartSquare className="h-5 w-5 text-purple-500" /> Cronograma Maestro</CardTitle>
                            <div className="flex gap-1 bg-muted p-1 rounded-md">
                                <Button variant={viewMode === ViewMode.Day ? 'secondary' : 'ghost'} size="sm" className="h-6 text-xs px-2" onClick={() => setViewMode(ViewMode.Day)}>Día</Button>
                                <Button variant={viewMode === ViewMode.Week ? 'secondary' : 'ghost'} size="sm" className="h-6 text-xs px-2" onClick={() => setViewMode(ViewMode.Week)}>Sem</Button>
                                <Button variant={viewMode === ViewMode.Month ? 'secondary' : 'ghost'} size="sm" className="h-6 text-xs px-2" onClick={() => setViewMode(ViewMode.Month)}>Mes</Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="min-h-[350px] p-0 overflow-hidden">
                        {tasksForGantt.length > 0 ? (
                            <div className="w-full overflow-x-auto p-4 gantt-container">
                                <div className="min-w-[600px]">
                                    <Gantt
                                        tasks={tasksForGantt}
                                        viewMode={viewMode}
                                        locale="es"
                                        columnWidth={viewMode === ViewMode.Month ? 300 : 60}
                                        listCellWidth=""
                                        barFill={80}
                                        barCornerRadius={4}
                                        projectProgressColor="#10b981"
                                        projectProgressSelectedColor="#059669"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="h-[300px] flex items-center justify-center text-muted-foreground"><Info className="h-4 w-4 mr-2" /> No hay datos de planificación.</div>
                        )}
                    </CardContent>
                </Card>

                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-blue-500" /> Curva S de Valor Ganado</CardTitle>
                        <CardDescription>Evolución financiera: Planificado vs Ejecutado Real.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={sCurveData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorPlanned" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} /><stop offset="95%" stopColor="#8884d8" stopOpacity={0} /></linearGradient>
                                        <linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8} /><stop offset="95%" stopColor="#82ca9d" stopOpacity={0} /></linearGradient>
                                    </defs>
                                    <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis unit="%" fontSize={12} tickLine={false} axisLine={false} />
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                    <RechartsTooltip
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        formatter={(value: any) => [`${value}%`, '']}
                                    />
                                    <Legend verticalAlign="top" height={36} />
                                    <Area type="monotone" dataKey="Planificado" stroke="#8884d8" fillOpacity={1} fill="url(#colorPlanned)" strokeWidth={2} />
                                    <Area type="monotone" dataKey="Real" stroke="#82ca9d" fillOpacity={1} fill="url(#colorReal)" strokeWidth={2} connectNulls />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

        </div>
    );
}