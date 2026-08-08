
'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Calendar, Trash2, Layers,
  Palette, Users, Search, Clock, TrendingUp, TrendingDown, ChevronsRightLeft, Pencil
} from 'lucide-react';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import type { User as UserType, WorkItem } from '@/modules/core/lib/data';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { StatCard } from '@/components/admin/stat-card';
import { eachDayOfInterval, differenceInDays, startOfDay } from 'date-fns';

// --- Estilos del Gantt (adaptados a tokens Pagnol) ---
// Las clases hasheadas de gantt-task-react se verificaron contra el DOM
// renderizado real (no copiadas de una versión anterior — la migración previa
// tenía 7 clases obsoletas que ya no existían en el bundle instalado). Se
// combinan con selectores por TAG (text/line), inmunes a cambios de versión.
const GanttCustomStyles = () => (
  <style>{`
    .gantt-container {
      --gantt-font-family: var(--font-sans), system-ui, sans-serif;
    }
    /* Texto y líneas: selectores por tag, no dependen de hashes de build */
    .gantt-container text { fill: hsl(var(--foreground)) !important; }
    .gantt-container line { stroke: hsl(var(--border)) !important; }
    /* Panel de lista (Name/From/To) y su zebra */
    .gantt-container ._3ZbQT { background-color: hsl(var(--card)) !important; }
    .gantt-container ._34SS0 { background-color: hsl(var(--muted) / 0.35) !important; }
    /* Fondo del área de calendario (grid) y su zebra */
    .gantt-container ._35nLX { fill: hsl(var(--card)) !important; }
    .gantt-container ._2dZTy { fill: hsl(var(--muted) / 0.35) !important; }
    .gantt-container ::-webkit-scrollbar { width: 8px; height: 8px; }
    .gantt-container ::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.3); border-radius: 4px; }
  `}</style>
);

// --- Tipos Extendidos ---
interface TaskType extends Task {
  assignedTo?: string | null;
  hasRealDates: boolean; // true si el WorkItem tiene fechas planificadas reales (no default)
}

const PRESET_COLORS = [
    { label: 'Azul (Estándar)', value: '#3b82f6' },
    { label: 'Verde (Completado)', value: '#10b981' },
    { label: 'Naranja (En Progreso)', value: '#f59e0b' },
    { label: 'Rojo (Crítico)', value: '#ef4444' },
    { label: 'Púrpura (Revisión)', value: '#8b5cf6' },
    { label: 'Gris (Pausado)', value: '#6b7280' },
];

const TYPE_LABELS: Record<WorkItem['type'], string> = {
  project: 'Contrato / Obra',
  phase: 'Fase',
  subphase: 'Subfase',
  activity: 'Actividad',
  task: 'Tarea',
};

export default function GanttChartPage() {
  const { can } = useAuth();
  const { users, workItems, updateWorkItem, deleteWorkItem } = useAppState();
  const { toast } = useToast();
  const canEditStructure = can('construction_control:edit_structure');

  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [view, setView] = useState<ViewMode>(ViewMode.Week);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentTask, setCurrentTask] = useState<Partial<TaskType>>({});
  const [currentType, setCurrentType] = useState<WorkItem['type']>('task');

  // Mapear workItems a Tasks de Gantt cada vez que workItems cambie
  useEffect(() => {
    if (workItems) {
      const ganttTasks: TaskType[] = workItems.map((item: WorkItem): TaskType => ({
        id: item.id,
        name: item.name,
        type: item.type === 'project' || item.type === 'phase' || item.type === 'subphase' ? 'project' : 'task',
        start: item.plannedStartDate ? new Date(item.plannedStartDate) : new Date(),
        end: item.plannedEndDate ? new Date(item.plannedEndDate) : new Date(),
        progress: item.progress || 0,
        project: item.parentId || undefined,
        hideChildren: false,
        assignedTo: (item as any).assignedTo,
        hasRealDates: !!(item.plannedStartDate && item.plannedEndDate),
      }));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- `tasks` no es derivación pura: encima lleva estado local del Gantt (hideChildren, línea ~155), así que no puede ser un useMemo
      setTasks(ganttTasks);
    }
  }, [workItems]);


  const filteredTasks = useMemo(() => {
    if (!searchTerm) return tasks;
    return tasks.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [tasks, searchTerm]);

  const handleTaskChange = useCallback(async (task: Task) => {
    if (!canEditStructure) return;
    try {
      await updateWorkItem(task.id, { plannedStartDate: task.start, plannedEndDate: task.end });
      // El estado se actualizará automáticamente a través del useEffect cuando workItems cambie
    } catch(e) {
      toast({ title: 'Error al actualizar', description: 'No se pudo guardar la nueva fecha.', variant: 'destructive'});
    }
  }, [updateWorkItem, toast, canEditStructure]);

  const handleDblClick = useCallback((task: Task) => {
    const workItem = workItems.find(item => item.id === task.id);
    if (workItem) {
        setCurrentTask({ ...task, assignedTo: (workItem as any).assignedTo });
        setCurrentType(workItem.type);
        setIsModalOpen(true);
    }
  }, [workItems]);

  const handleDelete = useCallback(async (task: Task) => {
    if (!canEditStructure) return;
    try {
        await deleteWorkItem(task.id);
        toast({ title: "Tarea eliminada", variant: "destructive" });
        setIsModalOpen(false);
    } catch (e: any) {
      toast({ title: "No se pudo eliminar", description: e?.message || "Intenta nuevamente.", variant: "destructive" });
    }
  }, [deleteWorkItem, toast, canEditStructure]);

  const handleExpanderClick = useCallback((task: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, hideChildren: !t.hideChildren } : t)));
  }, []);

  const handleSaveTask = async () => {
    if (!currentTask.name?.trim() || !currentTask.start || !currentTask.end || currentTask.start > currentTask.end) {
      toast({ title: "Datos inválidos", description: "Revisa el nombre y las fechas.", variant: "destructive" });
      return;
    }
    try {
        const taskToSave: Partial<WorkItem> = {
            name: currentTask.name,
            plannedStartDate: currentTask.start,
            plannedEndDate: currentTask.end,
            assignedTo: currentTask.assignedTo,
        };
        await updateWorkItem(currentTask.id!, taskToSave);
        toast({ title: "Tarea actualizada" });
        setIsModalOpen(false);
    } catch(e: any) {
        toast({ title: "Error", description: e.message || "No se pudo guardar la tarea.", variant: 'destructive'});
    }
  };

  const dateToString = (date?: Date) => date ? date.toISOString().split('T')[0] : '';
  const stringToDate = (str: string) => {
      if(!str) return undefined;
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
  };

  // --- Lógica de Curva S y SPI — SOLO sobre tareas con fechas planificadas
  // reales (item.plannedStartDate/EndDate). Antes se usaba `new Date()` como
  // default para las que no tenían fecha, lo que inflaba TODAS las tareas sin
  // planificar como si vencieran "hoy" y mostraba un SPI/estado falsos.
  const { sCurveData, projectSPI, hasScheduledTasks } = useMemo(() => {
    const relevantTasks = tasks.filter(t => t.type !== 'project' && t.hasRealDates);
    if (relevantTasks.length === 0) return { sCurveData: [], projectSPI: 1, hasScheduledTasks: false };

    const projectStart = new Date(Math.min(...relevantTasks.map(t => t.start.getTime())));
    const projectEnd = new Date(Math.max(...relevantTasks.map(t => t.end.getTime())));
    const today = startOfDay(new Date());

    const dateRange = eachDayOfInterval({ start: projectStart, end: projectEnd });

    // Bucle explícito en vez de un `.map` cuyo callback reasignaba los acumuladores
    // del scope de arriba: el resultado es idéntico (el `.map` ya era síncrono), pero
    // sin ese closure el React Compiler puede optimizar el componente — con la forma
    // anterior lo saltaba entero ("Cannot reassign variable after render completes").
    const sCurve: { date: string; programado: number; real: number }[] = [];
    let cumulativePlanned = 0;
    let cumulativeActual = 0;

    for (const day of dateRange) {
        let dailyPlanned = 0;
        let dailyActual = 0;

        for (const task of relevantTasks) {
            const taskStart = startOfDay(task.start);
            const taskEnd = startOfDay(task.end);
            const duration = differenceInDays(taskEnd, taskStart) + 1;

            if (duration > 0) {
              if (day >= taskStart && day <= taskEnd) {
                  dailyPlanned += 100 / duration;
              }
              if (day <= today && day >= taskStart) {
                  const actualProgressOnDay = Math.min(100, task.progress || 0) / duration;
                  dailyActual += actualProgressOnDay;
              }
            }
        }

        cumulativePlanned += dailyPlanned / relevantTasks.length;
        cumulativeActual += dailyActual / relevantTasks.length;

        sCurve.push({
            date: day.toLocaleDateString('es-CL', { month: 'short', day: 'numeric'}),
            programado: Math.min(100, cumulativePlanned),
            real: Math.min(100, cumulativeActual),
        });
    }

    const todayIndex = dateRange.findIndex(d => startOfDay(d) >= today);
    const todayData = sCurve[todayIndex > -1 ? todayIndex : sCurve.length - 1];
    const spi = (todayData?.programado ?? 0) > 0 ? (todayData?.real || 0) / todayData.programado : 1;

    return { sCurveData: sCurve, projectSPI: spi, hasScheduledTasks: true };
  }, [tasks]);

  if (!can('module_construction_control:view')) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <p className="font-semibold">Acceso Denegado</p>
          <p className="text-sm">No tienes permisos para acceder al cronograma.</p>
        </div>
      </div>
    );
  }

  return (
    <PageShell title="Cronograma de Obra" description="Gestión visual de tiempos y seguimiento del proyecto.">
      <GanttCustomStyles />

      {hasScheduledTasks ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
              title="Estado del Proyecto"
              value={projectSPI > 1.05 ? 'Adelantado' : projectSPI < 0.95 ? 'Atrasado' : 'A tiempo'}
              icon={projectSPI > 1.05 ? TrendingUp : projectSPI < 0.95 ? TrendingDown : ChevronsRightLeft}
              color={projectSPI > 1.05 ? 'text-success' : projectSPI < 0.95 ? 'text-destructive' : 'text-warning'}
          />
          <StatCard title="Índice de Rendimiento (SPI)" value={projectSPI.toFixed(2)} icon={Clock} />
          <StatCard title="Tareas Totales" value={tasks.length} icon={Layers} />
        </div>
      ) : (
        <EmptyState
          icon={<Calendar size={22} />}
          title="Sin fechas planificadas"
          description="Ninguna partida tiene fecha de inicio/fin definida todavía, así que no hay un cronograma real que medir. Arrastra las barras del Gantt para asignar fechas y ver el Estado del Proyecto, SPI y la Curva S."
        />
      )}

      <Card className="shadow-lg border-muted">
        <CardHeader className="pb-4 border-b bg-muted/10">
            <div className="flex flex-col lg:flex-row justify-between gap-4 items-center">
                <div className="flex flex-col gap-1 w-full lg:w-auto">
                    <CardTitle className="flex items-center gap-2 text-xl"><Layers className="h-5 w-5 text-primary" /> Diagrama Gantt</CardTitle>
                    <CardDescription>{tasks.length} tareas planificadas · doble clic para editar</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
                    <div className="relative w-full sm:w-48">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Buscar tarea..." className="pl-8 h-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                    <div className="flex bg-secondary/50 rounded-lg p-1 border">
                        {[ViewMode.Day, ViewMode.Week, ViewMode.Month].map((m) => (<Button key={m} variant={view === m ? "default" : "ghost"} size="sm" onClick={() => setView(m)} className="h-7 text-xs px-3">{m === ViewMode.Day ? 'Día' : m === ViewMode.Week ? 'Semana' : 'Mes'}</Button>))}
                    </div>
                </div>
            </div>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden relative min-h-[500px] gantt-container">
          {filteredTasks.length > 0 ? (
             <div className="w-full overflow-x-auto">
                <div className="min-w-[800px]">
                    <Gantt
                        tasks={filteredTasks} viewMode={view}
                        onDateChange={canEditStructure ? handleTaskChange : undefined}
                        onDoubleClick={handleDblClick}
                        onDelete={canEditStructure ? handleDelete : undefined}
                        onExpanderClick={handleExpanderClick}
                        locale="es" columnWidth={view === ViewMode.Month ? 300 : view === ViewMode.Week ? 250 : 65}
                        listCellWidth="180px" barFill={70} barCornerRadius={4} rowHeight={50} headerHeight={50}
                        todayColor="hsla(var(--primary) / 0.05)" projectBackgroundColor="hsl(var(--secondary))" projectProgressColor="hsl(var(--secondary-foreground))"
                        arrowColor="hsl(var(--muted-foreground))" fontFamily="inherit" fontSize="12px"
                    />
                </div>
            </div>
          ) : (
            <EmptyState
                className="min-h-[400px] border-0"
                icon={<Calendar size={24} />}
                title="No se encontraron tareas"
                description="Ajusta los filtros de búsqueda"
                action={<Button variant="outline" size="sm" onClick={() => setSearchTerm('')} disabled={!searchTerm}>Limpiar Búsqueda</Button>}
            />
          )}
        </CardContent>
      </Card>

      {hasScheduledTasks && (
        <Card>
          <CardHeader>
              <CardTitle>Curva S de Avance</CardTitle>
              <CardDescription>Avance programado vs. real — solo partidas con fechas planificadas definidas.</CardDescription>
          </CardHeader>
          <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={sCurveData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickFormatter={(value) => `${value}%`} />
                      <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }} />
                      <Legend />
                      <Line type="monotone" dataKey="programado" stroke="hsl(var(--info))" strokeWidth={2} dot={false} name="Avance Programado" />
                      <Line type="monotone" dataKey="real" stroke="hsl(var(--success))" strokeWidth={2} dot={false} name="Avance Real" />
                  </LineChart>
              </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[600px] gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 bg-pagnol-dark border-b">
            <DialogTitle className="flex items-center gap-2 text-lg text-white">
                <Pencil className="h-5 w-5 text-pagnol-orange"/> Editar Tarea
            </DialogTitle>
            <DialogDescription className="text-pagnol-orange">
              Ajusta fechas, responsable y color. La estructura (tipo/jerarquía) y el avance físico se gestionan desde <strong>Partidas (EDT)</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-2">
                    <Label htmlFor="name">Nombre de la Tarea</Label>
                    <Input id="name" value={currentTask.name || ''} onChange={(e) => setCurrentTask({ ...currentTask, name: e.target.value })} placeholder="Ej: Instalación de Tuberías" className="font-medium" disabled={!canEditStructure} />
                </div>
                <div className="space-y-2">
                     <Label>Tipo</Label>
                     <div className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">
                        {TYPE_LABELS[currentType]}
                     </div>
                </div>
                <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Clock className="h-3 w-3" /> Avance físico</Label>
                    <div className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">
                        {(currentTask.progress || 0).toFixed(1)}% · se registra en EDT
                    </div>
                </div>
            </div>
            <div className="bg-muted/20 p-4 rounded-lg border space-y-4">
                <div className="flex items-center gap-2 mb-2"><Clock className="h-4 w-4 text-muted-foreground" /><h4 className="text-sm font-semibold">Cronograma</h4></div>
                <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-2"><Label htmlFor="start" className="text-xs uppercase text-muted-foreground">Inicio</Label><Input id="start" type="date" value={dateToString(currentTask.start)} onChange={(e) => setCurrentTask({ ...currentTask, start: stringToDate(e.target.value) })} disabled={!canEditStructure} /></div>
                     <div className="space-y-2"><Label htmlFor="end" className="text-xs uppercase text-muted-foreground">Fin</Label><Input id="end" type="date" value={dateToString(currentTask.end)} onChange={(e) => setCurrentTask({ ...currentTask, end: stringToDate(e.target.value) })} disabled={!canEditStructure} /></div>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Users className="h-3 w-3"/> Responsable</Label>
                    <Select value={currentTask.assignedTo || 'none'} onValueChange={(val) => setCurrentTask({ ...currentTask, assignedTo: val === "none" ? null : val})} disabled={!canEditStructure}>
                        <SelectTrigger><SelectValue placeholder="Asignar..." /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Sin asignar</SelectItem>
                            {(users || []).map((u: UserType) => (<SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Palette className="h-3 w-3"/> Color Etiqueta</Label>
                    <Select value={currentTask.styles?.progressColor || PRESET_COLORS[0].value} onValueChange={(val) => setCurrentTask({ ...currentTask, styles: { ...currentTask.styles, progressColor: val, progressSelectedColor: val }})} disabled={!canEditStructure}>
                        <SelectTrigger>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentTask.styles?.progressColor || PRESET_COLORS[0].value }}></div>
                                <span className="text-sm text-muted-foreground">Seleccionar</span>
                            </div>
                        </SelectTrigger>
                        <SelectContent>
                            {PRESET_COLORS.map(c => (<SelectItem key={c.value} value={c.value}><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: c.value }}></div>{c.label}</div></SelectItem>))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
          </div>
          <DialogFooter className="px-6 py-4 bg-muted/30 border-t flex items-center !justify-between">
            {canEditStructure ? (<Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(currentTask as Task)}><Trash2 className="h-4 w-4 mr-2" /> Eliminar</Button>) : <div/>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cerrar</Button>
              {canEditStructure && <Button onClick={handleSaveTask}>Guardar Cambios</Button>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
