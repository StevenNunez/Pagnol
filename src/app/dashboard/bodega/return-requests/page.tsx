
"use client";

import React, { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Clock, X, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { ReturnRequest } from "@/modules/core/lib/data";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";


type Status = "pending" | "completed" | "rejected";

export default function AdminReturnRequestsPage() {
  const { returnRequests, updateReturnRequestStatus, isLoading } = useAppState();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Status>("pending");
  const [searchTerm, setSearchTerm] = useState("");

  const getDate = (date: Date | string | null | undefined): Date | null => {
    if (!date) return null;
    return date instanceof Date ? date : new Date(date as any);
  };

  const formatDate = (date: Date | string | null | undefined): string => {
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
  
  const getStatusBadge = (status: Status) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="bg-yellow-500 text-white"><Clock className="mr-1 h-3 w-3" /> Pendiente</Badge>;
      case "completed":
        return <Badge className="bg-green-600 text-white"><Check className="mr-1 h-3 w-3" /> Completada</Badge>;
      case "rejected":
        return <Badge variant="destructive"><X className="mr-1 h-3 w-3" /> Rechazada</Badge>;
      default:
        return <Badge variant="outline">Desconocido</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Gestionar Devoluciones de Material"
        description="Aprueba o rechaza las devoluciones de material sobrante que los supervisores han registrado."
      />
      <Card className="border-l-4 border-l-blue-500 shadow-sm">
        <CardHeader className="pb-3 border-b">
          <CardTitle>Solicitudes de Devolución</CardTitle>
          <CardDescription>Al aprobar, el stock se re-ingresa automáticamente al inventario.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {/* Búsqueda */}
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por supervisor o material..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value as Status); setSearchTerm(""); }}>
            <TabsList className="grid w-full grid-cols-3 mb-4 p-1 bg-muted rounded-lg">
              <TabsTrigger value="pending" className="rounded-md data-[state=active]:bg-card data-[state=active]:text-yellow-600 data-[state=active]:shadow-sm gap-2">
                Pendientes
                {counts.pending > 0 && <Badge className="bg-yellow-500 text-white text-[10px] h-4 px-1.5 font-bold">{counts.pending}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="completed" className="rounded-md data-[state=active]:bg-card data-[state=active]:text-green-600 data-[state=active]:shadow-sm gap-2">
                Completadas
                {counts.completed > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{counts.completed}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="rejected" className="rounded-md data-[state=active]:bg-card data-[state=active]:text-red-600 data-[state=active]:shadow-sm gap-2">
                Rechazadas
                {counts.rejected > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{counts.rejected}</Badge>}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-0">
              <ScrollArea className="h-[500px] border rounded-md">
                <div className="overflow-x-auto">
                  <Table className="min-w-[700px]">
                    <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                      <TableRow>
                        <TableHead className="w-[140px]">Fecha</TableHead>
                        <TableHead>Supervisor</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead className="w-[100px]">Cantidad</TableHead>
                        <TableHead>Notas</TableHead>
                        <TableHead className="w-[110px]">Estado</TableHead>
                        {activeTab === 'pending' && <TableHead className="text-right w-[200px]">Acciones</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                          <TableRow>
                              <TableCell colSpan={activeTab === 'pending' ? 7 : 6} className="h-24 text-center">
                                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                              </TableCell>
                          </TableRow>
                      ) : filteredRequests.length > 0 ? (
                        filteredRequests.map((req: ReturnRequest) => (
                          <TableRow key={req.id} className="hover:bg-muted/40 transition-colors">
                            <TableCell className="text-xs text-muted-foreground">{formatDate(req.createdAt)}</TableCell>
                            <TableCell className="font-medium">{req.supervisorName}</TableCell>
                            <TableCell className="font-medium">{req.materialName}</TableCell>
                            <TableCell className="font-mono">{req.quantity} {req.unit}</TableCell>
                            <TableCell className="text-muted-foreground max-w-[200px] truncate text-sm" title={req.notes || undefined}>{req.notes || '—'}</TableCell>
                            <TableCell>{getStatusBadge(req.status)}</TableCell>
                            {activeTab === 'pending' && (
                              <TableCell className="text-right">
                                <div className="flex gap-2 justify-end">
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
                                          <AlertDialogAction onClick={() => handleStatusUpdate(req.id, 'rejected')} className="bg-destructive hover:bg-destructive/90">
                                              Sí, Rechazar
                                          </AlertDialogAction>
                                          </AlertDialogFooter>
                                      </AlertDialogContent>
                                  </AlertDialog>
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                          <Button size="sm" className="bg-green-600 hover:bg-green-700">
                                              <Check className="mr-1 h-3 w-3" /> Aprobar
                                          </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                          <AlertDialogHeader>
                                          <AlertDialogTitle>¿Confirmar Devolución?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                              Al confirmar, se añadirán <strong>{req.quantity} {req.unit} de {req.materialName}</strong> de vuelta al inventario.
                                          </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleStatusUpdate(req.id, 'completed')} className="bg-green-600 hover:bg-green-700">
                                              Confirmar Ingreso
                                          </AlertDialogAction>
                                          </AlertDialogFooter>
                                      </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={activeTab === 'pending' ? 7 : 6} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <Check className="h-8 w-8 opacity-30" />
                              <p className="text-sm">{searchTerm ? `Sin resultados para "${searchTerm}"` : "No hay solicitudes en esta categoría."}</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
