
'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
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
  Plus, Calendar, Trash2, Layers, ArrowRightLeft, 
  Palette, Users, Search, Clock, TrendingUp, TrendingDown, ChevronsRightLeft, Edit
} from 'lucide-react';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import type { User as UserType, WorkItem } from '@/modules/core/lib/data';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { StatCard } from '@/components/admin/stat-card';
import { cn } from '@/lib/utils';
import { eachDayOfInterval, differenceInDays, startOfDay } from 'date-fns';

// --- Estilos Globales para el Gantt (Adaptado a Shadcn) ---
const GanttCustomStyles = () => (
  <style>{`
    .gantt-container {
      --gantt-font-family: var(--font-sans), system-ui, sans-serif;
    }
    .gantt-container ._3_pmuJ, 
    .gantt-container ._291r0X,
    .gantt-container ._1n_4l- {
        background-color: hsl(var(--card)) !important; 
    }
    .gantt-container ._3_pmuJ button,
    .gantt-container ._1n_4l- > div {
        color: hsl(var(--muted-foreground)) !important;
        font-weight: 500;
    }
    .gantt-container ._1n_4l- ._3Yt5l-, .gantt-container ._291r0X div {
        color: hsl(var(--foreground)) !important;
    }
    .gantt-container ._2-D47- { stroke: hsl(var(--border)) !important; }
    /* Fin de semana */
    .gantt-container ._2IsDI_ { fill: hsl(var(--muted) / 0.5) !important; }
    /* Línea de "Hoy" */
    .gantt-container ._1YV57- { stroke: hsl(var(--primary)) !important; }
    .gantt-container ::-webkit-scrollbar { width: 8px; height: 8px; }
    .gantt-container ::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.3); border-radius: 4px; }
  `}</style>
);

// --- Tipos Extendidos ---
interface TaskType extends Task {
  description?: string;
  assignees?: string[]; // La librería usa 'assignees', nosotros usaremos 'assignedTo'
  plannedProgress?: number;
  assignedTo?: string | null;
}

const PRESET_COLORS = [
    { label: 'Azul (Estándar)', value: '#3b82f6' },
    { label: 'Verde (Completado)', value: '#10b981' },
    { label: 'Naranja (En Progreso)', value: '#f59e0b' },
    { label: 'Rojo (Crítico)', value: '#ef4444' },
    { label: 'Púrpura (Revisión)', value: '#8b5cf6' },
    { label: 'Gris (Pausado)', value: '#6b7280' },
];

export default function GanttChartPage() {
  const { can } = useAuth();
  const { users, workItems, updateWorkItem, deleteWorkItem } = useAppState();
  const { toast } = useToast();
  
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [view, setView] = useState<ViewMode>(ViewMode.Week);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentTask, setCurrentTask] = useState<Partial<TaskType>>({});
  const [isEditing, setIsEditing] = useState(false);

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
        assignedTo: (item as any).assignedTo, // Mapeo de responsable
        // Dependencias necesitarían un campo 'dependencies' en WorkItem
        // dependencies: item.dependencies || [],
      }));
      setTasks(ganttTasks);
    }
  }, [workItems]);


  const filteredTasks = useMemo(() => {
    if (!searchTerm) return tasks;
    return tasks.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [tasks, searchTerm]);

  const handleTaskChange = useCallback(async (task: Task) => {
    try {
      await updateWorkItem(task.id, { plannedStartDate: task.start, plannedEndDate: task.end });
      // El estado se actualizará automáticamente a través del useEffect cuando workItems cambie
    } catch(e) {
      toast({ title: 'Error al actualizar', description: 'No se pudo guardar la nueva fecha.', variant: 'destructive'});
    }
  }, [updateWorkItem, toast]);

  const handleProgressChange = useCallback(async (task: Task) => {
    try {
      await updateWorkItem(task.id, { progress: task.progress });
      // El estado se actualizará automáticamente
    } catch(e) {
       toast({ title: 'Error', description: 'No se pudo actualizar el progreso.', variant: 'destructive'});
    }
  }, [toast, updateWorkItem]);

  const handleDblClick = useCallback((task: Task) => {
    const workItem = workItems.find(item => item.id === task.id);
    if(workItem) {
        setCurrentTask({
            ...task,
            assignedTo: (workItem as any).assignedTo,
        });
        setIsEditing(true);
        setIsModalOpen(true);
    }
  }, [workItems]);

  const handleDelete = useCallback(async (task: Task) => {
    try {
        await deleteWorkItem(task.id);
        toast({ title: "Tarea eliminada", variant: "destructive" });
        setIsModalOpen(false);
    } catch (e) {
      toast({ title: "Error", description: "No se pudo eliminar la tarea.", variant: "destructive" });
    }
  }, [deleteWorkItem, toast]);

  const handleExpanderClick = useCallback((task: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, hideChildren: !t.hideChildren } : t)));
  }, []);

  const openNewTaskModal = () => {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 2);
    setCurrentTask({
      id: `Task-${Date.now()}`, start: startDate, end: endDate, name: '', progress: 0, type: 'task',
      dependencies: [], assignees: [], hideChildren: false,
      styles: { progressColor: '#3b82f6', progressSelectedColor: '#2563eb' }
    });
    setIsEditing(false);
    setIsModalOpen(true);
  };
  
const handleSaveTask = async () => {
    if (!currentTask.name?.trim() || !currentTask.start || !currentTask.end || currentTask.start > currentTask.end) {
      toast({ title: "Datos inválidos", description: "Revisa el nombre y las fechas.", variant: "destructive" });
      return;
    }

    try {
        if (isEditing) {
            const originalItem = workItems.find(item => item.id === currentTask.id);
            if (!originalItem) {
                throw new Error("No se encontró la tarea original para actualizar.");
            }
            
            const taskToSave: Partial<WorkItem> = {
                ...originalItem,
                name: currentTask.name,
                type: currentTask.type as WorkItem['type'],
                parentId: currentTask.project || null,
                plannedStartDate: currentTask.start,
                plannedEndDate: currentTask.end,
                progress: currentTask.progress,
                assignedTo: currentTask.assignedTo,
            };

            await updateWorkItem(currentTask.id!, taskToSave);
            toast({ title: "Tarea actualizada" });
        } else {
            // La creación es manejada por el módulo EDT, aquí solo mostramos una advertencia.
            toast({ title: "Acción Desactivada", description: "Crea nuevas tareas desde el módulo 'Partidas (EDT)' para mantener la consistencia del proyecto." });
        }
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
  
  // --- Lógica de Curva S y SPI ---
  const { sCurveData, projectSPI } = useMemo(() => {
    if (tasks.length === 0) return { sCurveData: [], projectSPI: 1 };
    
    const projectStart = new Date(Math.min(...tasks.map(t => t.start.getTime())));
    const projectEnd = new Date(Math.max(...tasks.map(t => t.end.getTime())));
    const today = startOfDay(new Date());

    const dateRange = eachDayOfInterval({ start: projectStart, end: projectEnd });
    let cumulativePlanned = 0;
    let cumulativeActual = 0;
    
    const relevantTasks = tasks.filter(t => t.type !== 'project' && t.type !== 'milestone');
    if (relevantTasks.length === 0) return { sCurveData: [], projectSPI: 1 };


    const sCurve = dateRange.map(day => {
        let dailyPlanned = 0;
        let dailyActual = 0;
        
        relevantTasks.forEach(task => {
            const taskStart = startOfDay(task.start);
            const taskEnd = startOfDay(task.end);
            const duration = differenceInDays(taskEnd, taskStart) + 1;
            
            if (duration > 0) {
              if (day >= taskStart && day <= taskEnd) {
                  dailyPlanned += 100 / duration; // % diario programado
              }

              if (day <= today) {
                  if (day >= taskStart) {
                      const actualProgressOnDay = Math.min(100, task.progress || 0) / duration;
                      dailyActual += actualProgressOnDay;
                  }
              }
            }
        });

        cumulativePlanned += dailyPlanned / relevantTasks.length;
        cumulativeActual += dailyActual / relevantTasks.length;

        return {
            date: day.toLocaleDateString('es-CL', { month: 'short', day: 'numeric'}),
            programado: Math.min(100, cumulativePlanned),
            real: Math.min(100, cumulativeActual)
        };
    });

    const todayIndex = dateRange.findIndex(d => startOfDay(d) >= today);
    const todayData = sCurve[todayIndex > -1 ? todayIndex : sCurve.length - 1];
    const spi = (todayData?.programado ?? 0) > 0 ? (todayData?.real || 0) / todayData.programado : 1;


    return { sCurveData: sCurve, projectSPI: spi };

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
    <div className="flex flex-col gap-6 fade-in w-full max-w-[100vw] overflow-hidden pb-10">
      <GanttCustomStyles />
      <PageHeader title="Cronograma de Obra" description="Gestión visual de tiempos, dependencias y seguimiento del proyecto." />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
            title="Estado del Proyecto" 
            value={projectSPI > 1.05 ? 'Adelantado' : projectSPI < 0.95 ? 'Atrasado' : 'A tiempo'} 
            icon={projectSPI > 1.05 ? TrendingUp : projectSPI < 0.95 ? TrendingDown : ChevronsRightLeft}
            color={projectSPI > 1.05 ? 'text-green-500' : projectSPI < 0.95 ? 'text-destructive' : 'text-amber-500'}
        />
        <StatCard title="Índice de Rendimiento (SPI)" value={projectSPI.toFixed(2)} icon={Clock} />
        <StatCard title="Tareas Totales" value={tasks.length} icon={Layers} />
      </div>

      <Card className="shadow-lg border-muted">
        <CardHeader className="pb-4 border-b bg-muted/10">
            <div className="flex flex-col lg:flex-row justify-between gap-4 items-center">
                <div className="flex flex-col gap-1 w-full lg:w-auto">
                    <CardTitle className="flex items-center gap-2 text-xl"><Layers className="h-5 w-5 text-primary" /> Diagrama Gantt</CardTitle>
                    <CardDescription>{tasks.length} tareas planificadas</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
                    <div className="relative w-full sm:w-48">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Buscar tarea..." className="pl-8 h-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                    <div className="flex bg-secondary/50 rounded-lg p-1 border">
                        {[ViewMode.Day, ViewMode.Week, ViewMode.Month].map((m) => (<Button key={m} variant={view === m ? "default" : "ghost"} size="sm" onClick={() => setView(m)} className="h-7 text-xs px-3">{m === ViewMode.Day ? 'Día' : m === ViewMode.Week ? 'Semana' : 'Mes'}</Button>))}
                    </div>
                    <Button onClick={openNewTaskModal} size="sm" className="h-9 shadow-sm"><Plus className="mr-2 h-4 w-4" /> Nueva Tarea</Button>
                </div>
            </div>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden relative min-h-[500px] gantt-container">
          {filteredTasks.length > 0 ? (
             <div className="w-full overflow-x-auto">
                <div className="min-w-[800px]"> 
                    <Gantt
                        tasks={filteredTasks} viewMode={view} onDateChange={handleTaskChange} onProgressChange={handleProgressChange} onDoubleClick={handleDblClick} onDelete={handleDelete} onExpanderClick={handleExpanderClick}
                        locale="es" columnWidth={view === ViewMode.Month ? 300 : view === ViewMode.Week ? 250 : 65}
                        listCellWidth="180px" barFill={70} barCornerRadius={4} rowHeight={50} headerHeight={50}
                        todayColor="hsla(var(--primary) / 0.05)" projectBackgroundColor="hsl(var(--secondary))" projectProgressColor="hsl(var(--secondary-foreground))"
                        arrowColor="hsl(var(--muted-foreground))" fontFamily="inherit" fontSize="12px"
                    />
                </div>
            </div>
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground bg-muted/5">
                <div className="bg-background p-4 rounded-full mb-4 shadow-sm border"><Calendar className="h-8 w-8 text-muted-foreground/50" /></div>
                <p className="font-medium">No se encontraron tareas</p>
                <p className="text-sm mb-4">Ajusta los filtros o crea una nueva tarea</p>
                <Button variant="outline" size="sm" onClick={() => setSearchTerm('')} disabled={!searchTerm}>Limpiar Búsqueda</Button>
            </div>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
            <CardTitle>Curva S de Avance</CardTitle>
            <CardDescription>Comparación del avance programado vs. el avance real del proyecto.</CardDescription>
        </CardHeader>
        <CardContent>
            <ResponsiveContainer width="100%" height={300}>
                <LineChart data={sCurveData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickFormatter={(value) => `${value}%`} />
                    <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }} />
                    <Legend />
                    <Line type="monotone" dataKey="programado" stroke="#8884d8" strokeWidth={2} dot={false} name="Avance Programado" />
                    <Line type="monotone" dataKey="real" stroke="#82ca9d" strokeWidth={2} dot={false} name="Avance Real" />
                </LineChart>
            </ResponsiveContainer>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[600px] gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 bg-[#0F172A] border-b">
            <DialogTitle className="flex items-center gap-2 text-lg text-white">
                {isEditing ? <Edit className="h-5 w-5 text-orange-400"/> : <Plus className="h-5 w-5 text-orange-400"/>}
                {isEditing ? 'Editar Tarea' : 'Crear Nueva Tarea'}
            </DialogTitle>
            <DialogDescription className="text-orange-400">Configura la planificación y recursos necesarios.</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-2">
                    <Label htmlFor="name">Nombre de la Tarea</Label>
                    <Input id="name" value={currentTask.name || ''} onChange={(e) => setCurrentTask({ ...currentTask, name: e.target.value })} placeholder="Ej: Instalación de Tuberías" className="font-medium" />
                </div>
                <div className="space-y-2">
                     <Label>Tipo</Label>
                     <Select value={currentTask.type || 'task'} onValueChange={(val: any) => setCurrentTask({...currentTask, type: val})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                              <SelectItem value="task"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500"/> Tarea Estándar</div></SelectItem>
                              <SelectItem value="project"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-yellow-500"/> Proyecto (Padre)</div></SelectItem>
                              <SelectItem value="milestone"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500"/> Hito (Fecha)</div></SelectItem>
                          </SelectContent>
                     </Select>
                </div>
                <div className="space-y-2">
                    <Label>Proyecto Padre</Label>
                     <Select value={currentTask.project || "none"} onValueChange={(val) => setCurrentTask({ ...currentTask, project: val === "none" ? undefined : val })} disabled={currentTask.type === 'project'}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Sin padre" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none" className="text-muted-foreground">-- Raíz --</SelectItem>
                            {tasks.filter(t => t.type === 'project' && t.id !== currentTask.id).map(t => (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="bg-muted/20 p-4 rounded-lg border space-y-4">
                <div className="flex items-center gap-2 mb-2"><Clock className="h-4 w-4 text-muted-foreground" /><h4 className="text-sm font-semibold">Cronograma</h4></div>
                <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-2"><Label htmlFor="start" className="text-xs uppercase text-muted-foreground">Inicio</Label><Input id="start" type="date" value={dateToString(currentTask.start)} onChange={(e) => setCurrentTask({ ...currentTask, start: stringToDate(e.target.value) })}/></div>
                     <div className="space-y-2"><Label htmlFor="end" className="text-xs uppercase text-muted-foreground">Fin</Label><Input id="end" type="date" value={dateToString(currentTask.end)} onChange={(e) => setCurrentTask({ ...currentTask, end: stringToDate(e.target.value) })}/></div>
                </div>
                <div className="space-y-3 pt-2">
                    <div className="flex justify-between items-center"><Label>Avance ({currentTask.progress || 0}%)</Label></div>
                    <Slider value={[currentTask.progress || 0]} max={100} step={5} onValueChange={(val) => setCurrentTask({...currentTask, progress: val[0]})}/>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Users className="h-3 w-3"/> Responsable</Label>
                    <Select value={currentTask.assignedTo || 'none'} onValueChange={(val) => setCurrentTask({ ...currentTask, assignedTo: val === "none" ? null : val})}>
                        <SelectTrigger><SelectValue placeholder="Asignar..." /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Sin asignar</SelectItem>
                            {(users || []).map((u: UserType) => (<SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Palette className="h-3 w-3"/> Color Etiqueta</Label>
                    <Select value={currentTask.styles?.progressColor || PRESET_COLORS[0].value} onValueChange={(val) => setCurrentTask({ ...currentTask, styles: { ...currentTask.styles, progressColor: val, progressSelectedColor: val }})}>
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
            {isEditing ? (<Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(currentTask as Task)}><Trash2 className="h-4 w-4 mr-2" /> Eliminar</Button>) : <div/>} 
            <div className="flex gap-2"><Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button><Button onClick={handleSaveTask}>Guardar Cambios</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
