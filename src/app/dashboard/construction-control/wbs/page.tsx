
'use client';

import React, { useMemo, useState } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  History,
  FolderTree,
  Send,
  Search,
  UserCheck,
  HardHat,
  Pencil,
  Loader2,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { WorkItem, ProgressLog, WorkProject } from '@/modules/core/lib/data';
import { CreateWorkItemForm } from '@/components/operations/create-work-item-form';
import { ProjectSwitcher, useActiveProject, useProjectWorkItems } from '@/components/operations/active-project';
import { WorkProjectDialog } from '@/components/operations/work-project-dialog';
import { RegisterProgressForm } from '@/components/operations/register-progress-form';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

type TreeWorkItem = WorkItem & { children: TreeWorkItem[] };

const buildTree = (items: WorkItem[]): TreeWorkItem[] => {
  const itemMap = new Map<string, TreeWorkItem>();
  const roots: TreeWorkItem[] = [];

  items.forEach(item => {
    itemMap.set(item.id, { ...item, children: [] });
  });

  items.forEach(item => {
    const node = itemMap.get(item.id)!;
    if (item.parentId && itemMap.has(item.parentId)) {
      itemMap.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortRecursive = (nodes: TreeWorkItem[]) => {
    nodes.sort((a, b) => a.path.localeCompare(b.path));
    nodes.forEach(n => sortRecursive(n.children));
  };

  sortRecursive(roots);
  return roots;
};


const WorkItemNode = ({
  node,
  level = 0,
  onSelect,
  selectedId,
}: {
  node: TreeWorkItem;
  level?: number;
  onSelect: (item: WorkItem) => void;
  selectedId: string | null;
}) => {
  const [isExpanded, setIsExpanded] = useState(level < 2);
  const hasChildren = node.children.length > 0;
  
  const progress = node.progress || 0;

  return (
    <div style={{ paddingLeft: `${level * 1}rem` }} className="space-y-1">
      <div
        onClick={() => onSelect(node)}
        className={cn(
          'flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors group',
          selectedId === node.id
            ? 'bg-primary/20'
            : 'hover:bg-muted/50'
        )}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-0.5 rounded-md hover:bg-muted-foreground/10"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <div className="w-5" />
        )}
        <div className="flex-grow truncate flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground w-16 shrink-0 group-hover:text-primary transition-colors">
            {node.path}
            </span>
            <div className="flex-grow truncate">
                <p className="truncate text-sm font-medium">{node.name}</p>
                 <Progress value={progress} className="h-1 mt-1 bg-muted/50" />
            </div>
        </div>
        <span className={cn(
            "text-xs font-mono rounded px-2 py-1",
            progress >= 100 ? "bg-success-subtle text-success-subtle-foreground font-bold" : "bg-muted/80"
        )}>
          {progress.toFixed(2)}%
        </span>
      </div>
      {hasChildren && isExpanded && (
        <div className="pl-3">
          {node.children.map((child) => (
            <WorkItemNode
              key={child.id}
              node={child}
              level={level + 1}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const WorkItemTree = ({ workItems, onSelect, selectedId }: { workItems: WorkItem[], onSelect: (item: WorkItem) => void, selectedId: string | null }) => {
    const tree = useMemo(() => buildTree(workItems || []), [workItems]);

    return (
        <ScrollArea className="h-[500px] border rounded-md">
            <div className="p-2 space-y-1">
                {tree.map((node) => (
                    <WorkItemNode
                        key={node.id}
                        node={node}
                        onSelect={onSelect}
                        selectedId={selectedId}
                    />
                ))}
            </div>
        </ScrollArea>
    );
};


export default function ConstructionWBSPage() {
  const { can } = useAuth();
  const { workItems: allWorkItems, isLoading, progressLogs, submitForQualityReview, updateWorkItem, users } = useAppState();
  const { project, projects } = useActiveProject();
  // Todo el módulo trabaja sobre UNA obra a la vez (RFC-006 F1).
  const workItems = useProjectWorkItems(allWorkItems);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<WorkProject | null>(null);
  const [selectedItemRaw, setSelectedItem] = useState<WorkItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSubmittingProtocol, setIsSubmittingProtocol] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const { toast } = useToast();

  // Al cambiar de obra, la partida seleccionada ya no pertenece a lo que se ve.
  // Se deriva en el render y no en un efecto: con un efecto, el panel derecho
  // alcanzaría a pintar un frame con la partida de la obra anterior.
  const selectedItem = selectedItemRaw && workItems.some(i => i.id === selectedItemRaw.id)
    ? selectedItemRaw
    : null;

  const filteredItems = useMemo(() => {
    if (!workItems) return [];
    if (!searchTerm) return workItems;
    const lowerTerm = searchTerm.toLowerCase();

    const matchingIds = new Set(
        workItems
            .filter(item =>
                item.name.toLowerCase().includes(lowerTerm) ||
                item.path.toLowerCase().includes(lowerTerm)
            )
            .map(item => item.id)
    );

    const ancestorIds = new Set<string>();
    workItems.forEach(item => {
        if (!matchingIds.has(item.id)) return;
        let current: WorkItem | undefined = item;
        while (current?.parentId) {
            ancestorIds.add(current.parentId);
            current = workItems.find(w => w.id === current!.parentId);
        }
    });

    return workItems.filter(item => matchingIds.has(item.id) || ancestorIds.has(item.id));
  }, [workItems, searchTerm]);


  const userNames = useMemo(
    () => new Map((users || []).map(u => [u.id, u.name])),
    [users],
  );

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

  if (!can('module_construction_control:view')) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Acceso Denegado</AlertTitle>
        <AlertDescription>
          No tienes los permisos necesarios para acceder a este módulo.
        </AlertDescription>
      </Alert>
    );
  }
  
  const handleSendToProtocol = async () => {
    if (!selectedItem) return;
    setIsSubmittingProtocol(true);
    try {
        await submitForQualityReview(selectedItem.id); 
        toast({
            title: 'Enviado a Protocolo',
            description: `La partida "${selectedItem.name}" ha sido enviada para revisión de calidad.`
        });
    } catch(error: any) {
        toast({
            variant: 'destructive',
            title: 'Error al Enviar',
            description: error.message || 'No se pudo enviar la partida a revisión.'
        });
    } finally {
        setIsSubmittingProtocol(false);
    }
  };


  const handleAssignContractor = async (userId: string) => {
    if (!selectedItem) return;
    setIsAssigning(true);
    try {
      await updateWorkItem(selectedItem.id, { assignedTo: userId });
      setSelectedItem(prev => prev ? { ...prev, assignedTo: userId } : null);
      const assignedUser = (users || []).find(u => u.id === userId);
      toast({
        title: 'Contratista Asignado',
        description: `El contrato "${selectedItem.name}" fue asignado a ${assignedUser?.name ?? 'nuevo usuario'}.`,
        className: 'border-success',
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err?.message ?? 'No se pudo reasignar.' });
    } finally {
      setIsAssigning(false);
    }
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'N/A';
    const jsDate = date instanceof Date ? date : new Date(date as any);
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
  };

  return (
    <PageShell
      title="Partidas de Obra (EDT)"
      description="Gestiona la estructura de desglose del trabajo y registra el avance físico."
      toolbar={
        <div className="w-full flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <ProjectSwitcher />
          {can('construction_control:manage_projects') && (
            <div className="flex gap-2">
              {project && (
                <Button
                  variant="ghost"
                  className="gap-2 rounded-xl"
                  onClick={() => { setEditingProject(project); setIsProjectDialogOpen(true); }}
                >
                  <Pencil className="h-4 w-4" />
                  Editar obra
                </Button>
              )}
              <Button
                variant="outline"
                className="gap-2 rounded-xl"
                onClick={() => { setEditingProject(null); setIsProjectDialogOpen(true); }}
              >
                <HardHat className="h-4 w-4" />
                Nueva Obra
              </Button>
            </div>
          )}
        </div>
      }
    >
      <WorkProjectDialog
        open={isProjectDialogOpen}
        onOpenChange={(open) => { setIsProjectDialogOpen(open); if (!open) setEditingProject(null); }}
        project={editingProject}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<HardHat size={22} />}
          title="Todavía no hay obras"
          description={can('construction_control:manage_projects')
            ? 'Crea la primera obra para empezar a cargarle partidas y su programación.'
            : 'Un administrador debe crear la obra antes de que puedas cargar partidas.'}
          action={can('construction_control:manage_projects') && (
            <Button className="gap-2 rounded-xl" onClick={() => { setEditingProject(null); setIsProjectDialogOpen(true); }}>
              <HardHat size={14} /> Crear la primera obra
            </Button>
          )}
        />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Columna Izquierda: Estructura y Creación */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2"><FolderTree className="h-5 w-5 text-primary"/> Estructura de la Obra (EDT)</CardTitle>
               <div className="relative pt-2">
                  <Search className="absolute left-2.5 top-4 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Buscar partida por nombre o código..." 
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <LoadingState label="Cargando estructura..." />
              ) : (workItems || []).length > 0 ? (
                <WorkItemTree
                    workItems={filteredItems || []}
                    onSelect={setSelectedItem}
                    selectedId={selectedItem?.id || null}
                />
              ) : (
                <EmptyState
                  icon={<FolderTree size={22} />}
                  title="Esta obra no tiene partidas"
                  description={can('construction_control:edit_structure')
                    ? 'Cárgale su primera partida con el formulario de abajo.'
                    : 'Aún no se ha definido la estructura de desglose de esta obra.'}

                />
              )}
            </CardContent>
          </Card>

          {can('construction_control:edit_structure') && (
            <Card>
              <CardHeader>
                <CardTitle>Añadir Partida/Actividad</CardTitle>
                <CardDescription>
                  Construye la estructura de desglose de la obra.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CreateWorkItemForm workItems={workItems} />
              </CardContent>
            </Card>
          )}

        </div>

        {/* Columna Derecha: Detalle y Avance */}
        <div className="lg:col-span-2 lg:sticky lg:top-8">
          <Card className="min-h-[70vh]">
            <CardHeader>
              <CardTitle>Detalle y Avance</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
              {selectedItem ? (
                <div className="w-full space-y-6 flex-1 flex flex-col">
                    <div>
                        <h3 className="text-lg font-semibold text-primary">{selectedItem.name}</h3>
                        <p className="text-sm text-muted-foreground">Ruta: {selectedItem.path}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 border p-4 rounded-lg text-sm">
                        <p><strong>Unidad:</strong> {selectedItem.unit}</p>
                        <p><strong>Cantidad:</strong> {selectedItem.quantity.toLocaleString()}</p>
                        <p><strong>Precio Unitario:</strong> ${selectedItem.unitPrice.toLocaleString()}</p>
                        <p><strong>Costo Total:</strong> ${(selectedItem.quantity * selectedItem.unitPrice).toLocaleString()}</p>
                    </div>

                    {/* Asignar Contratista — solo visible en contratos raíz para admins */}
                    {selectedItem.parentId === null && can('construction_control:edit_structure') && (
                      <div className="border rounded-lg p-4 bg-muted/20 space-y-2">
                        <Label className="flex items-center gap-2 text-sm font-semibold">
                          <UserCheck className="h-4 w-4 text-primary" />
                          Contratista Responsable
                        </Label>
                        <Select
                          value={selectedItem.assignedTo ?? ''}
                          onValueChange={handleAssignContractor}
                          disabled={isAssigning}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder="Seleccionar responsable..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(users || [])
                              .slice()
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map(u => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.name}
                                  {u.role === 'contratista' && (
                                    <span className="ml-2 text-xs text-muted-foreground">(Contratista)</span>
                                  )}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Este usuario verá el contrato en su módulo &quot;Estado de Pago&quot;.
                        </p>
                      </div>
                    )}
                    
                    {/* El motivo del rechazo se veía solo en "Mis Partidas". Acá es
                        donde el ejecutor corrige y reenvía: sin el motivo a la vista,
                        reenvía lo mismo y Calidad lo vuelve a rechazar. */}
                    {selectedItem.status === 'rejected' && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>
                          Rechazada por Calidad
                          {selectedItem.reviewedAt && ` · ${formatDate(selectedItem.reviewedAt)}`}
                          {selectedItem.reviewedBy && userNames.get(selectedItem.reviewedBy) && ` · ${userNames.get(selectedItem.reviewedBy)}`}
                        </AlertTitle>
                        <AlertDescription>
                          {selectedItem.rejectionReason || 'Sin motivo registrado.'}
                        </AlertDescription>
                      </Alert>
                    )}

                    { selectedItem.progress < 100 && selectedItem.status !== 'pending-quality-review' ? (
                       <RegisterProgressForm workItem={selectedItem} />
                    ) : (
                        <div className="py-4">
                            {selectedItem.status === 'pending-quality-review' ? (
                                 <Alert className="bg-info-subtle border-info/30 text-info-subtle-foreground [&>svg]:text-info">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertTitle>Pendiente de Revisión</AlertTitle>
                                    <AlertDescription>
                                        Esta partida ya fue enviada a Calidad y está esperando aprobación.
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                <>
                                 {/* Una partida rechazada está al 100% igual, pero decirle
                                     "Completada" arriba del motivo del rechazo es contradictorio:
                                     lo que corresponde ahí es corregir y reenviar. */}
                                 {selectedItem.status !== 'rejected' && (
                                   <Alert className="bg-success-subtle border-success/30 text-success-subtle-foreground [&>svg]:text-success">
                                      <AlertCircle className="h-4 w-4" />
                                      <AlertTitle>Partida Completada</AlertTitle>
                                      <AlertDescription>
                                          Esta partida ha alcanzado el 100% de su avance.
                                          {selectedItem.status === 'completed' && selectedItem.reviewedAt && (
                                              <> Aprobada por {userNames.get(selectedItem.reviewedBy ?? '') ?? 'Calidad'} el {formatDate(selectedItem.reviewedAt)}.</>
                                          )}
                                      </AlertDescription>
                                  </Alert>
                                 )}
                                {selectedItem.status !== 'completed' && (
                                  <div className="mt-4 text-center">
                                    <Button onClick={handleSendToProtocol} disabled={isSubmittingProtocol}>
                                        {isSubmittingProtocol ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                                        {selectedItem.status === 'rejected' ? 'Corregir y reenviar a Calidad' : 'Enviar a Revisión de Calidad'}
                                    </Button>
                                  </div>
                                )}
                                </>
                            )}
                        </div>
                    )}


                    <Card className="mt-6 flex-1 flex flex-col">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2"><History className="h-5 w-5"/> Historial de Avances</CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-hidden">
                          <DataTable
                            columns={[
                              { key: 'fecha', header: 'Fecha', cell: (log) => formatDate(log.date) },
                              { key: 'cantidad', header: 'Cantidad', headerClassName: 'text-right', className: 'text-right font-mono', cell: (log) => log.quantity.toLocaleString() },
                              { key: 'usuario', header: 'Usuario', cell: (log) => log.userName },
                              { key: 'obs', header: 'Observaciones', className: 'text-xs text-muted-foreground', cell: (log) => log.observations },
                            ] satisfies DataTableColumn<ProgressLog>[]}
                            data={selectedItemLogs}
                            rowKey={(log) => log.id}
                            maxHeight="15rem"
                            empty={{ title: 'No hay registros de avance para esta partida.' }}
                          />
                        </CardContent>
                    </Card>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center min-h-[40vh]">
                    <p className="text-muted-foreground text-center">
                    Selecciona un ítem de la estructura para ver sus detalles y
                    registrar el avance.
                    </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      )}
    </PageShell>
  );
}
