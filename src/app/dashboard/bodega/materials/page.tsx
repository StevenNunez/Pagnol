
"use client";

import React, { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { CreateMaterialForm } from "@/components/admin/create-material-form";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  PackageCheck,
  PackageOpen,
  Edit,
  Trash2,
  Archive,
  Search,
  Filter,
  MoreHorizontal,
  AlertTriangle,
  Package,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  ArchiveRestore,
  PlusCircle,
} from "lucide-react";
import { Material, MaterialRequest, PurchaseRequest, User, Supplier } from "@/modules/core/lib/data";
import { EditMaterialForm } from "@/components/admin/edit-material-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

// --- Tipos ---
type CompatibleMaterialRequest = MaterialRequest & {
  materialId?: string;
  quantity?: number;
  items?: { materialId: string; quantity: number }[];
};

export default function AdminMaterialsPage() {
  const { materials, purchaseRequests, users, requests, suppliers, isLoading, deleteMaterial, updateMaterial, can } = useAppState();
  const { toast } = useToast();

  // Estados
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  
  const itemsPerPage = 10;
  
  // Permisos
  const canCreate = can('materials:create');
  const canEdit = can('materials:edit');
  const canDelete = can('materials:delete');
  const canArchive = can('materials:archive');

  // --- Optimizaciones con useMemo (Mapas O(1)) ---
  const supplierMap = useMemo(() => {
    const map = new Map<string, string>();
    (suppliers || []).forEach(s => {
        if(s.id) map.set(s.id, s.name);
    });
    return map;
  }, [suppliers]);

  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    (users || []).forEach(u => map.set(u.id, u));
    return map;
  }, [users]);
  
  const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);

  // --- Lógica de Negocio ---

  const handleDeleteMaterial = async (materialId: string, materialName: string) => {
    try {
      await deleteMaterial(materialId);
      toast({
        title: "Material Eliminado",
        description: `El material ${materialName} ha sido eliminado permanentemente.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al Eliminar",
        description: error instanceof Error ? error.message : "No se pudo eliminar el material.",
      });
    }
  };

  const handleArchiveMaterial = async (material: Material) => {
    if (material.stock > 0 && !material.archived) {
      toast({ variant: 'destructive', title: 'Acción bloqueada', description: 'No se puede archivar un material que aún tiene stock físico.' });
      return;
    }
    const newStatus = !material.archived;
    try {
      await updateMaterial(material.id, { archived: newStatus });
      toast({
        title: newStatus ? "Material Archivado" : "Material Restaurado",
        description: `El material ${material.name} ha sido ${newStatus ? 'archivado' : 'restaurado'} exitosamente.`,
      });
    } catch (error) {
       toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo actualizar el estado del material.",
      });
    }
  };

  // --- Filtros y Paginación ---

  const categories = useMemo(() => {
    if (!materials) return ["all"];
    const allCats = materials.map((m: Material) => m.category).filter((cat): cat is string => typeof cat === 'string');
    return ["all", ...new Set(allCats)].sort();
  }, [materials]);

  const filteredMaterials = useMemo(() => {
    let filtered: Material[] = materials || [];
    
    // Filtro Archivo
    if (!showArchived) {
        filtered = filtered.filter((m) => !m.archived);
    }
    
    // Filtro Texto
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter((m) => m.name.toLowerCase().includes(lower));
    }
    
    // Filtro Categoría
    if (categoryFilter !== "all") {
      filtered = filtered.filter((m) => m.category === categoryFilter);
    }
    
    return filtered;
  }, [materials, searchTerm, categoryFilter, showArchived]);

  const paginatedMaterials = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredMaterials.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredMaterials, currentPage]);

  const totalPages = Math.ceil(filteredMaterials.length / itemsPerPage);

  // --- Estadísticas Rápidas ---
  const quickStats = useMemo(() => {
      const total = materials?.length || 0;
      const lowStock = materials?.filter(m => !m.archived && m.stock <= 10).length || 0;
      const archived = materials?.filter(m => m.archived).length || 0;
      const inFaena = materials?.filter(m => !m.archived && (m.inUse ?? 0) > 0).length || 0;
      return { total, lowStock, archived, inFaena };
  }, [materials]);

  // --- Datos Recientes ---
  
  const toDate = (date: Date | string | null | undefined): Date | null => {
    if (!date) return null;
    return date instanceof Date ? date : new Date(date as any);
  };

  const getRelativeTime = (date: Date | string | null | undefined) => {
    const d = toDate(date);
    if (!d) return "Fecha desconocida";
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
  };

  const recentReceived = useMemo(() => {
    if (!purchaseRequests) return [];
    return purchaseRequests
      .filter((pr) => pr.status === "received" && pr.receivedAt)
      .sort((a, b) => (toDate(b.receivedAt)?.getTime() || 0) - (toDate(a.receivedAt)?.getTime() || 0))
      .slice(0, 5);
  }, [purchaseRequests]);

  const recentApprovedRequests = useMemo(() => {
    if (!requests) return [];
    return (requests as CompatibleMaterialRequest[])
      .filter((r) => r.status === "approved" && r.createdAt)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
      .slice(0, 5);
  }, [requests]);


  // --- Render ---

  return (
    <div className="flex flex-col gap-8 pb-10 fade-in">
      <PageHeader
        title="Gestión de Materiales"
        description="Administra el catálogo maestro de inventario, stock y proveedores."
      />

      {editingMaterial && canEdit && (
        <EditMaterialForm
          material={editingMaterial}
          isOpen={true}
          onClose={() => setEditingMaterial(null)}
        />
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card shadow-sm border-l-4 border-l-primary">
            <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 bg-primary/10 rounded-full text-primary"><Package className="h-6 w-6"/></div>
                <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Materiales</p>
                    <h3 className="text-2xl font-bold">{quickStats.total}</h3>
                </div>
            </CardContent>
        </Card>
        <Card className="bg-card shadow-sm border-l-4 border-l-amber-500">
            <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 bg-amber-100 dark:bg-amber-950 rounded-full text-amber-600 dark:text-amber-400"><ArrowUpRight className="h-6 w-6"/></div>
                <div>
                    <p className="text-sm font-medium text-muted-foreground">En Faena</p>
                    <h3 className="text-2xl font-bold">{quickStats.inFaena}</h3>
                    <p className="text-[10px] text-muted-foreground">materiales activos en obra</p>
                </div>
            </CardContent>
        </Card>
        <Card className="bg-card shadow-sm border-l-4 border-l-destructive">
            <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 bg-destructive/10 rounded-full text-destructive"><AlertTriangle className="h-6 w-6"/></div>
                <div>
                    <p className="text-sm font-medium text-muted-foreground">Stock Crítico</p>
                    <h3 className="text-2xl font-bold">{quickStats.lowStock}</h3>
                </div>
            </CardContent>
        </Card>
        <Card className="bg-card shadow-sm border-l-4 border-l-muted">
            <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 bg-muted rounded-full text-muted-foreground"><Archive className="h-6 w-6"/></div>
                <div>
                    <p className="text-sm font-medium text-muted-foreground">Archivados</p>
                    <h3 className="text-2xl font-bold">{quickStats.archived}</h3>
                </div>
            </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 grid-cols-1 lg:grid-cols-3">
        {/* Columna Izquierda: Inventario (2/3) */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="h-full shadow-sm flex flex-col">
            <CardHeader>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle>Inventario Maestro</CardTitle>
                    <CardDescription>Catálogo completo de materiales.</CardDescription>
                  </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 flex-grow">
              {/* Toolbar de Filtros */}
              <div className="flex flex-col sm:flex-row gap-3 p-1">
                <div className="relative flex-grow">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                    placeholder="Buscar por nombre..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    className="pl-9"
                    />
                </div>
                <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <div className="flex items-center gap-2">
                        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                        <SelectValue placeholder="Categoría" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat, index) => (
                      <SelectItem key={`${cat}-${index}`} value={cat}>
                        {cat === "all" ? "Todas las categorías" : cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center space-x-2 border rounded-md px-3 bg-muted/20">
                    <Checkbox id="showArchived" checked={showArchived} onCheckedChange={(c) => setShowArchived(!!c)} />
                    <Label htmlFor="showArchived" className="text-xs font-medium cursor-pointer">Ver Archivados</Label>
                </div>
              </div>

              {/* Tabla */}
              <ScrollArea className="h-[600px] border rounded-md bg-card">
                 <div className="min-w-[800px] p-1">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 z-10 backdrop-blur-sm">
                        <TableRow>
                          <TableHead className="min-w-[200px]">Material</TableHead>
                          <TableHead className="w-[150px]">Categoría</TableHead>
                          <TableHead className="w-[150px]">Proveedor</TableHead>
                          <TableHead className="w-[100px] text-right">Stock</TableHead>
                          <TableHead className="w-[80px] text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLoading ? (
                          <TableRow>
                            <TableCell colSpan={5} className="h-32 text-center">
                                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary/50" />
                            </TableCell>
                          </TableRow>
                        ) : paginatedMaterials.length > 0 ? (
                          paginatedMaterials.map((material) => {
                              const isLowStock = !material.archived && material.stock <= 10;
                              return (
                                <TableRow
                                    key={material.id}
                                    className={cn(
                                        "transition-colors",
                                        material.archived && "opacity-60 bg-muted/30 grayscale"
                                    )}
                                >
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium">{material.name}</span>
                                                {material.class && (
                                                    <Badge variant="outline" className={cn(
                                                        "text-[10px] h-4 px-1 shrink-0 font-bold",
                                                        material.class === 'A' && "border-red-300 text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300",
                                                        material.class === 'B' && "border-yellow-300 text-yellow-600 bg-yellow-50 dark:bg-yellow-950 dark:text-yellow-300",
                                                        material.class === 'C' && "border-green-300 text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-300",
                                                    )}>
                                                        Clase {material.class}
                                                    </Badge>
                                                )}
                                            </div>
                                            {material.archived && <Badge variant="outline" className="w-fit text-[10px] h-4">Archivado</Badge>}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="font-normal text-xs bg-muted text-muted-foreground">
                                            {material.category}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate" title={material.supplierId ? (supplierMap.get(material.supplierId) || "Sin proveedor") : "Sin proveedor"}>
                                        {material.supplierId ? supplierMap.get(material.supplierId) || "-" : "-"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex flex-col items-end gap-0.5">
                                            <span className={cn(
                                                "font-mono font-bold",
                                                isLowStock ? "text-destructive" : "text-foreground"
                                            )}>
                                                {material.stock.toLocaleString()}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground">{material.unit} disponible</span>
                                            {(material.inUse ?? 0) > 0 && (
                                                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                                    {material.inUse} en faena
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                                            <DropdownMenuSeparator />
                                            {canEdit && (
                                                <DropdownMenuItem onClick={() => setEditingMaterial(material)}>
                                                <Edit className="mr-2 h-4 w-4" /> Editar
                                                </DropdownMenuItem>
                                            )}
                                            {canArchive && (
                                                <DropdownMenuItem onClick={() => handleArchiveMaterial(material)}>
                                                    {material.archived ? (
                                                        <><ArchiveRestore className="mr-2 h-4 w-4" /> Restaurar</>
                                                    ) : (
                                                        <><Archive className="mr-2 h-4 w-4" /> Archivar</>
                                                    )}
                                                </DropdownMenuItem>
                                            )}
                                            {canDelete && (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
                                                            <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                                                        </DropdownMenuItem>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Eliminarás <b>{material.name}</b> permanentemente. Esta acción no se puede deshacer.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                            <AlertDialogAction 
                                                                onClick={() => handleDeleteMaterial(material.id, material.name)}
                                                                className="bg-destructive hover:bg-destructive/90"
                                                            >
                                                                Eliminar
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            )}
                                        </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                              );
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                No se encontraron materiales con los filtros actuales.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                 </div>
                 <ScrollBar orientation="horizontal" />
              </ScrollArea>
              
              {/* Paginación Simple */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                    <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                        Anterior
                    </Button>
                    <span className="text-xs text-muted-foreground">Página {currentPage} de {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                        Siguiente
                    </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Columna Derecha: Acciones y Actividad (1/3) */}
        <div className="space-y-6">
          
          {/* Formulario Crear (Siempre visible en desktop) */}
          {canCreate && (
             <Card className="border-l-4 border-l-blue-500 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <PlusCircle className="h-5 w-5 text-blue-500" /> Crear Material
                </CardTitle>
                <CardDescription>Agrega un nuevo ítem al catálogo.</CardDescription>
              </CardHeader>
              <CardContent>
                <CreateMaterialForm />
              </CardContent>
            </Card>
          )}

          {/* Actividad Reciente (Tabs para ahorrar espacio) */}
          <Card className="h-fit">
              <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                      <History className="h-5 w-5 text-muted-foreground" /> Actividad Reciente
                  </CardTitle>
              </CardHeader>
              <CardContent>
                  <Tabs defaultValue="out" className="w-full">
                      <TabsList className="grid w-full grid-cols-2 mb-4">
                          <TabsTrigger value="out">Salidas</TabsTrigger>
                          <TabsTrigger value="in">Ingresos</TabsTrigger>
                      </TabsList>
                      
                      {/* Tab: Salidas */}
                      <TabsContent value="out" className="mt-0">
                        <ScrollArea className="h-[300px] pr-3">
                            {recentApprovedRequests.length > 0 ? (
                                <div className="space-y-3">
                                    {recentApprovedRequests.map((req) => (
                                        <div key={req.id} className="text-sm p-3 rounded-lg bg-orange-100/20 dark:bg-orange-950/40 border border-orange-200/50 dark:border-orange-800/60 flex flex-col gap-1">
                                            <div className="flex justify-between items-start">
                                                <span className="font-semibold text-orange-700 dark:text-orange-300 flex items-center gap-1">
                                                    <ArrowUpRight className="h-3 w-3" /> Salida
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">{getRelativeTime(req.createdAt)}</span>
                                            </div>
                                            <div className="pl-4 border-l-2 border-orange-200 dark:border-orange-700 ml-1">
                                                <ul className="list-disc list-inside text-xs space-y-0.5">
                                                    {req.items && req.items.length > 0 ? req.items.map(i => (
                                                        <li key={i.materialId}>
                                                            {materialMap.get(i.materialId)?.name} <b>({i.quantity})</b>
                                                        </li>
                                                    )) : (
                                                        <li>{materialMap.get(req.materialId || '')?.name} <b>({req.quantity})</b></li>
                                                    )}
                                                </ul>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    Destino: {req.area} • Por: {userMap.get(req.supervisorId)?.name.split(' ')[0]}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : <p className="text-center text-xs text-muted-foreground py-8">Sin salidas recientes.</p>}
                        </ScrollArea>
                      </TabsContent>

                      {/* Tab: Ingresos */}
                      <TabsContent value="in" className="mt-0">
                         <ScrollArea className="h-[300px] pr-3">
                            {recentReceived.length > 0 ? (
                                <div className="space-y-3">
                                    {recentReceived.map((req) => (
                                        <div key={req.id} className="text-sm p-3 rounded-lg bg-green-100/20 dark:bg-green-950/40 border border-green-200/50 dark:border-green-800/60 flex flex-col gap-1">
                                            <div className="flex justify-between items-start">
                                                <span className="font-semibold text-green-700 dark:text-green-300 flex items-center gap-1">
                                                    <ArrowDownLeft className="h-3 w-3" /> Ingreso
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">{getRelativeTime(req.receivedAt)}</span>
                                            </div>
                                            <div className="pl-4 border-l-2 border-green-200 dark:border-green-700 ml-1">
                                                <p className="font-medium text-xs">{req.materialName} <b>({req.quantity} {req.unit})</b></p>
                                                <p className="text-[10px] text-muted-foreground mt-1 italic line-clamp-2">
                                                    "{req.justification || 'Sin comentarios'}"
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : <p className="text-center text-xs text-muted-foreground py-8">Sin ingresos recientes.</p>}
                        </ScrollArea>
                      </TabsContent>
                  </Tabs>
              </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
