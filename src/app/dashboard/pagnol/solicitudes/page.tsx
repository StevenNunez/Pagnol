
"use client";

import React, { useState, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useAppState } from "@/modules/core/contexts/app-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Check, Clock, X, Loader2, Bell, Search, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import type { MaterialRequest, Material, ReturnRequest, User } from "@/modules/core/lib/data";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { cn } from "@/lib/utils";

// ────────────────────────────────────────────────────────────────────────────
// Bandeja unificada del pañol: Retiros (material_requests) + Devoluciones
// (return_requests). Fusiona las antiguas páginas bodega/requests y
// bodega/return-requests en una sola superficie.
// ────────────────────────────────────────────────────────────────────────────

type RequestStatus = "pending" | "approved" | "rejected";
type ReturnStatus = "pending" | "completed" | "rejected";

type CompatibleMaterialRequest = MaterialRequest & {
  materialId?: string;
  quantity?: number;
  items?: { materialId: string; quantity: number }[];
};

const getDate = (date: any): Date | null => {
  if (!date) return null;
  return date instanceof Date ? date : new Date(date);
};

const formatDate = (date: any): string => {
  const jsDate = getDate(date);
  return jsDate ? jsDate.toLocaleDateString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "N/A";
};

const RequestStatusBadge = ({ status }: { status: RequestStatus }) => {
  switch (status) {
    case "pending":
      return <Badge variant="outline" className="gap-1 border-warning/30 bg-warning-subtle text-warning-subtle-foreground"><Clock className="h-3 w-3" /> Pendiente</Badge>;
    case "approved":
      return <Badge variant="outline" className="gap-1 border-success/30 bg-success-subtle text-success-subtle-foreground"><Check className="h-3 w-3" /> Aprobado</Badge>;
    case "rejected":
      return <Badge variant="destructive" className="gap-1 border-none"><X className="h-3 w-3" /> Rechazado</Badge>;
    default:
      return <Badge variant="outline">Desconocido</Badge>;
  }
};

const RequestItemsList = ({ req, materialMap }: { req: CompatibleMaterialRequest; materialMap: Map<string, Material> }) => {
  const items = req.items && Array.isArray(req.items)
    ? req.items
    : req.materialId && req.quantity
    ? [{ materialId: req.materialId, quantity: req.quantity }]
    : [];

  return (
    <ul className="list-disc list-inside space-y-1 text-sm mt-1">
      {items.map((item, index) => {
        const material = materialMap.get(item.materialId);
        const currentStock = material?.stock || 0;
        const isInsufficient = req.status === 'pending' && currentStock < item.quantity;

        return (
          <li key={index} className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{item.quantity}</span>
            <span className="text-muted-foreground">x</span>
            <span className={cn("font-medium", isInsufficient ? "text-destructive" : "text-foreground")}>
              {material?.name ?? "Material desconocido"}
            </span>
            {material?.unit && <span className="text-xs text-muted-foreground">({material.unit})</span>}
            {material?.class && (
              <Badge variant="outline" className={cn(
                "text-[10px] h-4 px-1 shrink-0 font-bold",
                material.class === 'A' && "border-destructive/30 text-destructive bg-destructive/10",
                material.class === 'B' && "border-warning/30 text-warning-subtle-foreground bg-warning-subtle",
                material.class === 'C' && "border-success/30 text-success-subtle-foreground bg-success-subtle",
              )}>
                Clase {material.class}
              </Badge>
            )}
            {isInsufficient && (
               <Badge variant="destructive" className="text-[10px] h-5 px-1">
                 Stock insuficiente: {currentStock}
               </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// ── Pestaña Retiros (ex bodega/requests) ────────────────────────────────────

function WithdrawalsInbox() {
  const { requests, updateMaterialRequestStatus, users, materials, isLoading, can, refreshData } = useAppState();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<RequestStatus>("pending");
  const [processingIds, setProcessingIds] = useState<string[]>([]);

  const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);
  const userMap = useMemo(() => new Map((users || []).map((u: User) => [u.id, u.name])), [users]);

  const sortedRequests = useMemo(() => {
    if (!requests) return [];
    return [...(requests as CompatibleMaterialRequest[])].sort((a, b) => {
      const dateA = getDate(a.createdAt)?.getTime() || 0;
      const dateB = getDate(b.createdAt)?.getTime() || 0;
      return dateB - dateA;
    });
  }, [requests]);

  // Gate ADC: solo las pendientes ya autorizadas por el ADC llegan al pañol.
  const pendingRequests = useMemo(() => sortedRequests.filter((req) => req.status === "pending" && (req as any).adcAuthorizedAt), [sortedRequests]);
  const approvedRequests = useMemo(() => sortedRequests.filter((req) => req.status === "approved"), [sortedRequests]);
  const rejectedRequests = useMemo(() => sortedRequests.filter((req) => req.status === "rejected"), [sortedRequests]);

  const handleStatusUpdate = async (requestId: string, status: "approved" | "rejected") => {
    setProcessingIds(prev => [...prev, requestId]);

    try {
      if (status === "approved") {
        const request = sortedRequests.find(r => r.id === requestId);
        if (request) {
          const items = request.items || (request.materialId ? [{ materialId: request.materialId, quantity: request.quantity || 0 }] : []);
          const insufficientItems = items.filter(item => {
             const mat = materialMap.get(item.materialId);
             return !mat || mat.stock < item.quantity;
          });

          if (insufficientItems.length > 0) {
             throw new Error(`Stock insuficiente para ${insufficientItems.length} ítem(s). Revisa el inventario.`);
          }
        }
      }

      await updateMaterialRequestStatus(requestId, status);
      toast({
        title: status === "approved" ? "¡Solicitud Aprobada!" : "Solicitud Rechazada",
        description: status === "approved" ? "El stock ha sido descontado correctamente." : "No se realizaron cambios en el inventario.",
        variant: status === "approved" ? "default" : "destructive"
      });
      // Refrescar datos desde Supabase para que la UI refleje el nuevo estado sin recargar
      refreshData();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "No se pudo procesar",
        description: error.message || "Ocurrió un error inesperado.",
      });
    } finally {
      // Siempre limpiamos el estado de proceso (éxito o error)
      setProcessingIds(prev => prev.filter(id => id !== requestId));
    }
  };

  const QuickPendingItem = ({ req }: { req: CompatibleMaterialRequest }) => {
    const supervisor = userMap.get(req.supervisorId);
    const isProcessing = processingIds.includes(req.id);
    return (
      <li className={cn(
        "relative flex flex-col sm:flex-row sm:items-start sm:justify-between p-4 rounded-xl bg-card border shadow-sm gap-4 transition-all",
        isProcessing ? "opacity-60 pointer-events-none" : "hover:shadow-md"
      )}>
        {/* Overlay de bloqueo visible mientras procesa */}
        {isProcessing && (
          <div className="absolute inset-0 rounded-xl bg-background/60 flex items-center justify-center z-10 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-xs font-semibold text-muted-foreground">Procesando...</span>
          </div>
        )}

        <div className="flex-grow space-y-2">
          <div className="flex justify-between items-start">
             <RequestItemsList req={req} materialMap={materialMap} />
             <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded">{formatDate(req.createdAt)}</span>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
             <span className="font-medium text-foreground">{supervisor || "Desconocido"}</span>
             {req.deliveryMode === 'directed' && req.beneficiaryName && (
               <><span>•</span><Badge variant="outline" className="text-[10px] h-4 px-1.5 border-info/30 bg-info-subtle text-info">Retira: {req.beneficiaryName}</Badge></>
             )}
             {req.deliveryMode === 'open' && (
               <><span>•</span><Badge variant="outline" className="text-[10px] h-4 px-1.5 border-warning/30 bg-warning-subtle text-warning-subtle-foreground">Retiro abierto</Badge></>
             )}
             {(req.contractName) && <><span>•</span><Badge variant="outline" className="text-[10px] h-4 px-1.5 border-primary/30 text-primary">{req.contractName}</Badge></>}
             {req.area && <><span>•</span>{req.area}</>}
          </p>
        </div>

        {can("material_requests:approve") && (
          <div className="flex gap-2 shrink-0">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2" disabled={isProcessing}>
                  <X className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rechazar Solicitud</AlertDialogTitle>
                  <AlertDialogDescription>Esta acción es irreversible. ¿Deseas continuar?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleStatusUpdate(req.id, "rejected")} className="bg-destructive hover:bg-destructive/90">Rechazar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90 h-8" disabled={isProcessing}>
                  Aprobar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar Aprobación</AlertDialogTitle>
                  <AlertDialogDescription>Se descontarán los materiales del inventario automáticamente.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleStatusUpdate(req.id, "approved")} className="bg-success text-success-foreground hover:bg-success/90">Confirmar y Descontar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </li>
    );
  };

  return (
    <Card className="border-l-4 border-l-primary shadow-sm">
      <CardHeader className="pb-3 border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="h-5 w-5 text-primary" /> Solicitudes de Materiales
        </CardTitle>
        <CardDescription>
          Al aprobar, el stock se descuenta automáticamente del inventario.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as RequestStatus)} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4 p-1 bg-muted rounded-lg">
            <TabsTrigger value="pending" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-warning data-[state=active]:shadow-sm gap-2">
              Pendientes
              {pendingRequests.length > 0 && (
                <Badge className="bg-warning text-warning-foreground text-[10px] h-4 px-1.5 font-bold">{pendingRequests.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-success data-[state=active]:shadow-sm gap-2">
              Aprobadas
              {approvedRequests.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{approvedRequests.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="rejected" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-destructive data-[state=active]:shadow-sm gap-2">
              Rechazadas
              {rejectedRequests.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{rejectedRequests.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Tab Pendientes */}
          <TabsContent value="pending">
            {isLoading ? (
              <LoadingState />
            ) : pendingRequests.length > 0 ? (
              <ScrollArea className="h-[600px] pr-4">
                <ul className="space-y-3 pt-2">
                  {pendingRequests.map((req) => (
                    <QuickPendingItem key={req.id} req={req} />
                  ))}
                </ul>
              </ScrollArea>
            ) : (
              <EmptyState
                icon={<Check size={24} className="text-success" />}
                title="¡Todo al día!"
                description="No hay solicitudes pendientes."
              />
            )}
          </TabsContent>

          {/* Tab Aprobadas / Rechazadas */}
          {(["approved", "rejected"] as RequestStatus[]).map((status) => (
            <TabsContent key={status} value={status}>
              <ScrollArea className="h-[600px]">
                <div className="space-y-3 pr-2 pt-2">
                  {(status === "approved" ? approvedRequests : rejectedRequests).length > 0 ? (
                    (status === "approved" ? approvedRequests : rejectedRequests).map((req) => (
                      <div key={req.id} className="flex flex-col sm:flex-row justify-between p-4 border rounded-xl hover:bg-muted/40 transition-colors gap-4">
                        <div className="space-y-2 w-full">
                          <div className="flex items-center gap-2 flex-wrap">
                            <RequestStatusBadge status={req.status as RequestStatus} />
                            <span className="text-xs font-mono text-muted-foreground">{formatDate(req.createdAt)}</span>
                            {/* Aprobada pero nadie la ha retirado: el stock ya salió del inventario. */}
                            {req.status === 'approved' && !req.deliveryDate && (() => {
                              const approvedAt = getDate(req.approvalDate)?.getTime();
                              const days = approvedAt ? Math.floor((Date.now() - approvedAt) / 86400000) : 0;
                              return (
                                <Badge variant="outline" className={cn(
                                  "gap-1 text-[10px]",
                                  days >= 3
                                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                                    : "border-warning/30 bg-warning-subtle text-warning-subtle-foreground"
                                )}>
                                  <Clock className="h-3 w-3" />
                                  Sin retirar{days > 0 ? ` hace ${days} día${days > 1 ? 's' : ''}` : ''}
                                </Badge>
                              );
                            })()}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            <p className="text-sm text-muted-foreground">Solicitante: <span className="font-medium text-foreground">{userMap.get(req.supervisorId) ?? "—"}</span></p>
                            {req.deliveryMode === 'directed' && req.beneficiaryName && (
                              <p className="text-sm text-muted-foreground">Retira: <span className="font-medium text-foreground">{req.beneficiaryName}</span></p>
                            )}
                            {req.deliveryMode === 'open' && (
                              <p className="text-sm text-muted-foreground">Retiro: <span className="font-medium text-foreground">Abierto</span></p>
                            )}
                            {req.receivedByUserName && (
                              <p className="text-sm text-muted-foreground">Recibió: <span className="font-medium text-foreground">{req.receivedByUserName}</span></p>
                            )}
                            <p className="text-sm text-muted-foreground">Contrato: <span className="font-medium text-foreground">{req.contractName ?? "—"}</span></p>
                            {req.area && <p className="text-sm text-muted-foreground">Detalle: <span className="font-medium text-foreground">{req.area}</span></p>}
                          </div>
                          <div className="bg-muted/40 p-3 rounded-lg">
                            <p className="text-xs font-semibold text-muted-foreground mb-1">Materiales:</p>
                            <RequestItemsList req={req} materialMap={materialMap} />
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      className="border-0 bg-transparent"
                      title={`No hay solicitudes ${status === "approved" ? "aprobadas" : "rechazadas"}`}
                    />
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ── Pestaña Devoluciones (ex bodega/return-requests) ────────────────────────

function ReturnsInbox() {
  const { returnRequests, updateReturnRequestStatus, isLoading } = useAppState();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ReturnStatus>("pending");
  const [searchTerm, setSearchTerm] = useState("");

  const formatReturnDate = (date: Date | string | null | undefined): string => {
    const jsDate = getDate(date);
    return jsDate ? jsDate.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "N/A";
  };

  const handleStatusUpdate = async (requestId: string, status: 'completed' | 'rejected') => {
      try {
          await updateReturnRequestStatus(requestId, status);
          toast({
              title: status === 'completed' ? 'Devolución Aceptada' : 'Devolución Rechazada',
              description: 'El estado de la solicitud ha sido actualizado.'
          });
      } catch (error: any) {
          toast({
              variant: 'destructive',
              title: 'Error',
              description: error.message || 'No se pudo actualizar la solicitud.'
          });
      }
  }

  const counts = useMemo(() => ({
    pending: (returnRequests || []).filter(r => r.status === 'pending').length,
    completed: (returnRequests || []).filter(r => r.status === 'completed').length,
    rejected: (returnRequests || []).filter(r => r.status === 'rejected').length,
  }), [returnRequests]);

  const filteredRequests = useMemo(() => {
    return (returnRequests || [])
      .filter((req: ReturnRequest) => req.status === activeTab)
      .filter((req: ReturnRequest) => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
          req.supervisorName?.toLowerCase().includes(term) ||
          req.materialName?.toLowerCase().includes(term)
        );
      })
      .sort((a: ReturnRequest, b: ReturnRequest) => {
        const dateA = getDate(a.createdAt)?.getTime() || 0;
        const dateB = getDate(b.createdAt)?.getTime() || 0;
        return dateB - dateA;
      });
  }, [returnRequests, activeTab, searchTerm]);

  const getStatusBadge = (status: ReturnStatus) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="gap-1 border-warning/30 bg-warning-subtle text-warning-subtle-foreground"><Clock className="h-3 w-3" /> Pendiente</Badge>;
      case "completed":
        return <Badge variant="outline" className="gap-1 border-success/30 bg-success-subtle text-success-subtle-foreground"><Check className="h-3 w-3" /> Completada</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="gap-1"><X className="h-3 w-3" /> Rechazada</Badge>;
      default:
        return <Badge variant="outline">Desconocido</Badge>;
    }
  };

  const columns: DataTableColumn<ReturnRequest>[] = [
    { key: 'fecha', header: 'Fecha', headerClassName: 'w-[140px]', className: 'text-xs text-muted-foreground', cell: (r) => formatReturnDate(r.createdAt) },
    { key: 'supervisor', header: 'Supervisor', className: 'font-medium', cell: (r) => r.supervisorName },
    { key: 'material', header: 'Material', className: 'font-medium', cell: (r) => r.materialName },
    { key: 'cantidad', header: 'Cantidad', headerClassName: 'w-[100px]', className: 'font-mono', cell: (r) => `${r.quantity} ${r.unit}` },
    { key: 'notas', header: 'Notas', cell: (r) => <span className="block max-w-[200px] truncate text-sm text-muted-foreground" title={r.notes || undefined}>{r.notes || '—'}</span> },
    { key: 'estado', header: 'Estado', headerClassName: 'w-[110px]', cell: (r) => getStatusBadge(r.status) },
    ...(activeTab === 'pending' ? [{
      key: 'acciones',
      header: 'Acciones',
      headerClassName: 'text-right w-[200px]',
      className: 'text-right',
      cell: (r: ReturnRequest) => (
        <div className="flex justify-end gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive">
                <X className="mr-1 h-3 w-3" /> Rechazar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Confirmar Rechazo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción marcará la solicitud como rechazada y el stock no se modificará.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleStatusUpdate(r.id, 'rejected')} className="bg-destructive hover:bg-destructive/90">
                  Sí, Rechazar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90">
                <Check className="mr-1 h-3 w-3" /> Aprobar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Confirmar Devolución?</AlertDialogTitle>
                <AlertDialogDescription>
                  Al confirmar, se añadirán <strong>{r.quantity} {r.unit} de {r.materialName}</strong> de vuelta al inventario.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleStatusUpdate(r.id, 'completed')} className="bg-success text-success-foreground hover:bg-success/90">
                  Confirmar Ingreso
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por supervisor o material..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9 rounded-xl"
        />
      </div>

      <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value as ReturnStatus); setSearchTerm(""); }}>
        <TabsList className="grid w-full grid-cols-3 p-1 bg-muted rounded-xl">
          <TabsTrigger value="pending" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-warning data-[state=active]:shadow-sm gap-2">
            Pendientes
            {counts.pending > 0 && <Badge className="bg-warning text-warning-foreground text-[10px] h-4 px-1.5 font-bold">{counts.pending}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="completed" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-success data-[state=active]:shadow-sm gap-2">
            Completadas
            {counts.completed > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{counts.completed}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="rejected" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-destructive data-[state=active]:shadow-sm gap-2">
            Rechazadas
            {counts.rejected > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{counts.rejected}</Badge>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        data={filteredRequests}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        maxHeight="500px"
        minWidth="700px"
        empty={{
          icon: <Check size={24} />,
          title: searchTerm ? 'Sin resultados' : 'No hay solicitudes en esta categoría',
          description: searchTerm ? `No se encontró "${searchTerm}".` : undefined,
        }}
      />
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function PanolInboxPage() {
  const { requests, returnRequests } = useAppState();
  const [section, setSection] = useState<'retiros' | 'devoluciones'>('retiros');

  const pendingWithdrawals = useMemo(
    () => ((requests || []) as CompatibleMaterialRequest[]).filter(r => r.status === 'pending' && (r as any).adcAuthorizedAt).length,
    [requests]
  );
  const pendingReturns = useMemo(
    () => (returnRequests || []).filter(r => r.status === 'pending').length,
    [returnRequests]
  );

  return (
    <PageShell
      title="Solicitudes y Devoluciones"
      description="Bandeja del pañol: aprueba retiros de material y gestiona las devoluciones desde faena."
    >
      <Tabs value={section} onValueChange={(v) => setSection(v as 'retiros' | 'devoluciones')} className="w-full">
        <TabsList className="grid w-full max-w-xl grid-cols-2 p-1 bg-muted rounded-xl mb-6">
          <TabsTrigger value="retiros" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm gap-2">
            <ArrowUpRight className="h-4 w-4" /> Retiros
            {pendingWithdrawals > 0 && (
              <Badge className="bg-warning text-warning-foreground text-[10px] h-4 px-1.5 font-bold">{pendingWithdrawals}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="devoluciones" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm gap-2">
            <ArrowDownLeft className="h-4 w-4" /> Devoluciones
            {pendingReturns > 0 && (
              <Badge className="bg-warning text-warning-foreground text-[10px] h-4 px-1.5 font-bold">{pendingReturns}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="retiros">
          <WithdrawalsInbox />
        </TabsContent>
        <TabsContent value="devoluciones">
          <ReturnsInbox />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
