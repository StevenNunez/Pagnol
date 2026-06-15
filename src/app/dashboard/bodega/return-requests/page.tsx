"use client";

import React, { useState, useMemo } from "react";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Clock, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { ReturnRequest } from "@/modules/core/lib/data";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { PageShell } from "@/components/page-shell";
import { DataTable, type DataTableColumn } from "@/components/data-table";


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
    { key: 'fecha', header: 'Fecha', headerClassName: 'w-[140px]', className: 'text-xs text-muted-foreground', cell: (r) => formatDate(r.createdAt) },
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
    <PageShell
      title="Gestionar Devoluciones de Material"
      description="Aprueba o rechaza las devoluciones de material sobrante que los supervisores han registrado. Al aprobar, el stock se re-ingresa automáticamente al inventario."
    >
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

        <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value as Status); setSearchTerm(""); }}>
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
    </PageShell>
  );
}
