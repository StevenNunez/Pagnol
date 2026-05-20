'use client';

import React, { useState, useMemo } from 'react';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clock,
  Check,
  X,
  PackageCheck,
  Box,
  FileText,
  Edit,
  Loader2,
  AlertCircle,
  Package,
  Trash2,
  Search,
  ShoppingCart,
  Filter
} from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { EditPurchaseRequestForm } from '@/components/operations/edit-purchase-request-form';
import type { PurchaseRequest, PurchaseRequestStatus, Material, User } from '@/modules/core/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// --- CONFIGURACIÓN DE ESTADOS (Tu paleta de colores) ---
const STATUS_CONFIG: Record<PurchaseRequestStatus, { label: string; icon: React.ElementType; color: string; border: string }> = {
  pending: { label: 'Pendiente', icon: Clock, color: 'bg-amber-100 text-amber-700', border: 'border-amber-200' },
  approved: { label: 'Aprobado', icon: Check, color: 'bg-green-100 text-green-700', border: 'border-green-200' },
  rejected: { label: 'Rechazado', icon: X, color: 'bg-red-100 text-red-700', border: 'border-red-200' },
  ordered: { label: 'Ordenada', icon: FileText, color: 'bg-blue-100 text-blue-700', border: 'border-blue-200' },
  batched: { label: 'En Lote', icon: Box, color: 'bg-purple-100 text-purple-700', border: 'border-purple-200' },
  received: { label: 'Recibido', icon: PackageCheck, color: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-200' },
};


// --- PÁGINA PRINCIPAL ---
export default function PurchaseRequestsManagementPage() {
  const { purchaseRequests, users, deletePurchaseRequest, isLoading } = useAppState();
  const { user: authUser, can } = useAuth();
  const { toast } = useToast();
  
  // Estados Locales
  const [editingRequest, setEditingRequest] = useState<PurchaseRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending'); // Por defecto ver pendientes
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const itemsPerPage = 8;
  
  // Permisos
  const canDelete = can('purchase_requests:delete');
  const canApprove = can('purchase_requests:approve');

  // Optimizaciones O(1)
  const supervisorMap = useMemo(() => {
      const map = new Map<string, string>();
      (users || []).forEach(u => map.set(u.id, u.name));
      return map;
  }, [users]);

  // Helpers de Fecha
  const getDate = (date: Date | string | null | undefined): Date | null => {
    if (!date) return null;
    return new Date(date as any);
  };

  const formatDate = (date: any) => {
    const d = getDate(date);
    return d ? d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
  };

  const getRelativeTime = (date: any) => {
      const d = getDate(date);
      return d ? formatDistanceToNow(d, { addSuffix: true, locale: es }) : '';
  };
  
  // Acciones
  const handleDeleteRequest = async (requestId: string) => {
    try {
      await deletePurchaseRequest(requestId);
      toast({ title: "Solicitud Eliminada", description: "Registro eliminado correctamente." });
    } catch(error) {
      toast({ title: "Error", description: "No se pudo eliminar.", variant: "destructive" });
    }
  };

  // Filtrado y Ordenamiento
  const filteredRequests = useMemo(() => {
      let filtered = [...(purchaseRequests || [])];

      // Filtro de Estado (Tabs)
      if (statusFilter !== 'all') {
          // Agrupación lógica para tabs simplificados
          if (statusFilter === 'active') {
             filtered = filtered.filter(r => ['approved', 'batched', 'ordered'].includes(r.status));
          } else {
             filtered = filtered.filter(r => r.status === statusFilter);
          }
      }

      // Búsqueda de Texto
      if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        filtered = filtered.filter(req => 
            req.materialName.toLowerCase().includes(lowerTerm) ||
            (supervisorMap.get(req.supervisorId) || '').toLowerCase().includes(lowerTerm) ||
            (req.area || '').toLowerCase().includes(lowerTerm)
        );
      }
      
      // Ordenar: Pendientes primero, luego por fecha más reciente
      return filtered.sort((a, b) => {
          const timeA = getDate(a.createdAt)?.getTime() || 0;
          const timeB = getDate(b.createdAt)?.getTime() || 0;
          return timeB - timeA;
      });
  }, [purchaseRequests, statusFilter, searchTerm, supervisorMap]);

  const paginatedRequests = useMemo(() => {
      return filteredRequests.slice((page - 1) * itemsPerPage, page * itemsPerPage);
  }, [filteredRequests, page]);

  const totalPages = Math.ceil(filteredRequests.length / itemsPerPage);

  // Estadísticas Rápidas
  const stats = useMemo(() => {
      const all = purchaseRequests || [];
      return {
          pending: all.filter(r => r.status === 'pending').length,
          active: all.filter(r => ['approved', 'batched', 'ordered'].includes(r.status)).length,
          total: all.length
      };
  }, [purchaseRequests]);

  // Render Helpers
  const renderStatusBadge = (status: PurchaseRequestStatus) => {
    const config = STATUS_CONFIG[status] || { label: status, icon: Package, color: 'bg-gray-100 text-gray-700', border: 'border-gray-200' };
    const Icon = config.icon;
    return (
      <Badge variant="outline" className={cn("flex w-fit items-center gap-1.5 px-2 py-0.5", config.color, config.border)}>
        <Icon className="h-3 w-3" /> {config.label}
      </Badge>
    );
  };

  return (
    <div className="flex flex-col gap-8 pb-12 fade-in">
      <PageHeader
        title="Gestión de Compras"
        description="Administra el flujo de adquisiciones, aprobaciones y recepciones."
      />

      {/* --- DASHBOARD METRICAS --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-lg">
              <CardContent className="p-4 flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-full"><Clock className="h-6 w-6" /></div>
                  <div>
                      <p className="text-sm font-medium opacity-80">Pendientes de Revisión</p>
                      <h3 className="text-2xl font-bold">{stats.pending}</h3>
                  </div>
              </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg">
              <CardContent className="p-4 flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-full"><ShoppingCart className="h-6 w-6" /></div>
                  <div>
                      <p className="text-sm font-medium opacity-80">En Proceso de Compra</p>
                      <h3 className="text-2xl font-bold">{stats.active}</h3>
                  </div>
              </CardContent>
          </Card>
          <Card className="bg-card border shadow-sm">
              <CardContent className="p-4 flex items-center gap-4">
                  <div className="p-3 bg-muted rounded-full text-muted-foreground"><FileText className="h-6 w-6" /></div>
                  <div>
                      <p className="text-sm text-muted-foreground font-medium">Total Histórico</p>
                      <h3 className="text-2xl font-bold">{stats.total}</h3>
                  </div>
              </CardContent>
          </Card>
      </div>

      {/* --- CONTENIDO PRINCIPAL --- */}
      <Card className="border-none shadow-sm bg-transparent">
        <Tabs defaultValue="pending" value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }} className="w-full">
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <TabsList className="bg-background border p-1 h-auto">
                    <TabsTrigger value="pending" className="px-4 py-2 data-[state=active]:bg-amber-100 data-[state=active]:text-amber-800">
                        Pendientes
                        {stats.pending > 0 && <span className="ml-2 bg-amber-200 text-amber-800 text-[10px] px-1.5 py-0.5 rounded-full">{stats.pending}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="active" className="px-4 py-2 data-[state=active]:bg-blue-100 data-[state=active]:text-blue-800">
                        En Proceso
                    </TabsTrigger>
                    <TabsTrigger value="received" className="px-4 py-2 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-800">Recibidos</TabsTrigger>
                    <TabsTrigger value="all" className="px-4 py-2">Todos</TabsTrigger>
                </TabsList>

                <div className="relative w-full md:w-[300px]">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input 
                        placeholder="Buscar material, área o solicitante..." 
                        className="pl-9 bg-card"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <Card className="border shadow-sm">
                <CardContent className="p-0">
                    <ScrollArea className="h-[600px]">
                        <Table>
                            <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                <TableRow>
                                    <TableHead className="w-[25%]">Material</TableHead>
                                    <TableHead className="w-[15%]">Cantidad</TableHead>
                                    <TableHead className="w-[20%]">Solicitante / Área</TableHead>
                                    <TableHead className="w-[15%]">Fecha</TableHead>
                                    <TableHead className="w-[10%]">Estado</TableHead>
                                    <TableHead className="w-[15%] text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></TableCell>
                                    </TableRow>
                                ) : paginatedRequests.length > 0 ? (
                                    paginatedRequests.map((req) => (
                                        <TableRow key={req.id} className="group hover:bg-muted/30 transition-colors">
                                            <TableCell>
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-medium text-sm">{req.materialName}</span>
                                                    {req.justification && (
                                                        <span className="text-[11px] text-muted-foreground truncate max-w-[200px]" title={req.justification}>
                                                            "{req.justification}"
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="secondary" className="font-mono font-normal bg-muted">
                                                    {req.quantity} {req.unit}
                                                </Badge>
                                                {/* Tooltip de cambios si existen */}
                                                {(req.originalQuantity && req.originalQuantity !== req.quantity) && (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger><AlertCircle className="h-3 w-3 text-amber-500 ml-2 inline" /></TooltipTrigger>
                                                            <TooltipContent>Cantidad original: {req.originalQuantity}</TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium">{supervisorMap.get(req.supervisorId) || 'Desconocido'}</span>
                                                    <span className="text-xs text-muted-foreground">{req.area}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="text-sm">{formatDate(req.createdAt)}</span>
                                                    <span className="text-[10px] text-muted-foreground">{getRelativeTime(req.createdAt)}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {renderStatusBadge(req.status)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                                    {canApprove && ['pending', 'approved', 'batched', 'ordered'].includes(req.status) && (
                                                        <Button variant="ghost" size="icon" onClick={() => setEditingRequest(req)} title="Gestionar / Editar">
                                                            <Edit className="h-4 w-4 text-blue-600" />
                                                        </Button>
                                                    )}
                                                    {canDelete && (
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="hover:bg-destructive/10">
                                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                                </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>¿Anular Solicitud?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        Esta acción anulará la solicitud de <b>{req.materialName}</b>. Esto es útil para ítems que ya no se comprarán. Esta acción es irreversible.
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleDeleteRequest(req.id)} className="bg-destructive hover:bg-destructive/90">Anular Solicitud</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                                            <div className="flex flex-col items-center gap-2">
                                                <Filter className="h-10 w-10 opacity-20" />
                                                <p>No se encontraron solicitudes con los filtros actuales.</p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>

                    {/* Paginación */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between p-4 border-t">
                            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Anterior</Button>
                            <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
                            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Siguiente</Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </Tabs>
      </Card>

      {/* --- DIÁLOGOS MODALES --- */}
      {editingRequest && (
        <EditPurchaseRequestForm
          request={editingRequest}
          isOpen={!!editingRequest}
          onClose={() => setEditingRequest(null)}
        />
      )}
    </div>
  );
}
