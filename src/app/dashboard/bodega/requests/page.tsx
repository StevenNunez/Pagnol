
"use client";

import React, { useState, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Check, Clock, X, Loader2, Bell } from "lucide-react";
import type { MaterialRequest, Material, User } from "@/modules/core/lib/data";
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
import { cn } from "@/lib/utils";

type Status = "pending" | "approved" | "rejected";

type CompatibleMaterialRequest = MaterialRequest & {
  materialId?: string;
  quantity?: number;
  items?: { materialId: string; quantity: number }[];
};

const StatusBadge = ({ status }: { status: Status }) => {
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


export default function ManageMaterialRequestsPage() {
  const { requests, updateMaterialRequestStatus, users, materials, isLoading, can, refreshData } = useAppState();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Status>("pending");
  const [processingIds, setProcessingIds] = useState<string[]>([]);

  const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);
  const userMap = useMemo(() => new Map((users || []).map((u: User) => [u.id, u.name])), [users]);

  const getDate = (date: any): Date | null => {
    if (!date) return null;
    return date instanceof Date ? date : new Date(date);
  };

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


  const formatDate = (date: any): string => {
    const jsDate = getDate(date);
    return jsDate ? jsDate.toLocaleDateString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "N/A";
  };

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
    <PageShell
      title="Gestión de Solicitudes de Materiales"
      description="Aprueba o rechaza las solicitudes de material de los supervisores."
    >
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
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Status)} className="w-full">
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
            {(["approved", "rejected"] as Status[]).map((status) => (
              <TabsContent key={status} value={status}>
                <ScrollArea className="h-[600px]">
                  <div className="space-y-3 pr-2 pt-2">
                    {(status === "approved" ? approvedRequests : rejectedRequests).length > 0 ? (
                      (status === "approved" ? approvedRequests : rejectedRequests).map((req) => (
                        <div key={req.id} className="flex flex-col sm:flex-row justify-between p-4 border rounded-xl hover:bg-muted/40 transition-colors gap-4">
                          <div className="space-y-2 w-full">
                            <div className="flex items-center gap-2 flex-wrap">
                              <StatusBadge status={req.status as Status} />
                              <span className="text-xs font-mono text-muted-foreground">{formatDate(req.createdAt)}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              <p className="text-sm text-muted-foreground">Solicitante: <span className="font-medium text-foreground">{userMap.get(req.supervisorId) ?? "—"}</span></p>
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
    </PageShell>
  );
}

    
