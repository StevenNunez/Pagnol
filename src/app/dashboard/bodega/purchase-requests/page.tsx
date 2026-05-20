"use client";

import React, { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Badge } from "@/components/ui/badge";
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
import { Button } from "@/components/ui/button";
import { useToast } from "@/modules/core/hooks/use-toast";
import { PurchaseRequest, PurchaseRequestStatus, Material, User } from "@/modules/core/lib/data";
import {
  Check,
  Clock,
  X,
  PackageCheck,
  Loader2,
  Box,
  FileText,
  Edit,
  AlertCircle,
  Search,
  User as UserIcon,
  ChevronsUpDown,
  ShoppingCart,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { EditPurchaseRequestForm } from "@/components/operations/edit-purchase-request-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface ReceiveRequestDialogProps {
  request: PurchaseRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (requestId: string, quantity: number, materialId?: string) => Promise<void>;
  materials: Material[];
}

function ReceiveRequestDialog({ request, isOpen, onClose, onConfirm, materials }: ReceiveRequestDialogProps) {
  const [receivedQuantity, setReceivedQuantity] = useState<number | string>("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    if (request) {
      setReceivedQuantity(request.quantity);
      setSelectedMaterialId(undefined); // Reset on new request
    } else {
      setReceivedQuantity("");
      setSelectedMaterialId(undefined);
    }
  }, [request]);

  const handleConfirmClick = async () => {
    if (!request) return;
    const quantityNum = Number(receivedQuantity);
    if (isNaN(quantityNum) || quantityNum <= 0) {
      toast({ variant: "destructive", title: "Error", description: "La cantidad debe ser un número positivo." });
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(request.id, quantityNum, selectedMaterialId);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const unarchivedMaterials = useMemo(() => materials.filter(m => !m.archived), [materials]);

  if (!request) return null;
  
  const selectedMaterialName = selectedMaterialId
      ? materials.find(m => m.id === selectedMaterialId)?.name
      : "Asignar a material existente...";


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent onInteractOutside={(e) => { e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Registrar Recepción de Material</DialogTitle>
          <DialogDescription>
            Confirma la cantidad de <span className="font-semibold">{String(request.materialName ?? "")}</span> que ha llegado a bodega.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="received-quantity">Cantidad Recibida Real</Label>
            <Input
              id="received-quantity"
              type="number"
              value={receivedQuantity}
              onChange={(e) => setReceivedQuantity(e.target.value)}
              placeholder="Ingresa la cantidad que llegó..."
            />
            <p className="text-xs text-muted-foreground">
              Puedes ajustar la cantidad si es diferente a la aprobada ({request.quantity}).
            </p>
          </div>

          <div className="space-y-2">
            <Label>Asignar a Material Existente (Opcional)</Label>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  <span className="truncate">{selectedMaterialName}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="Buscar material..." />
                  <CommandList>
                    <CommandEmpty>No se encontraron materiales.</CommandEmpty>
                    <CommandGroup>
                      {unarchivedMaterials.map((material) => (
                        <CommandItem
                          key={material.id}
                          value={material.name}
                          onSelect={() => {
                            setSelectedMaterialId(material.id);
                            setPopoverOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", selectedMaterialId === material.id ? "opacity-100" : "opacity-0")} />
                          {material.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Si este material ya existe (ej. es un duplicado), selecciónalo aquí para sumar el stock en lugar de crear uno nuevo.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button onClick={handleConfirmClick} disabled={isSubmitting || !receivedQuantity}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
            Confirmar Recepción
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const getDate = (date: Date | string | null | undefined): Date | null => {
  if (!date) return null;
  return date instanceof Date ? date : new Date(date as any);
};

const formatDate = (date: Date | string | null | undefined): string => {
  const jsDate = getDate(date);
  if (!jsDate) return "N/A";
  return jsDate.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const getStatusBadge = (status: PurchaseRequestStatus) => {
  switch (status) {
    case "pending":
      return <Badge variant="secondary" className="bg-yellow-500 text-white"><Clock className="mr-1 h-3 w-3" />Pendiente</Badge>;
    case "approved":
      return <Badge variant="default" className="bg-green-600 text-white"><Check className="mr-1 h-3 w-3" />Aprobado</Badge>;
    case "rejected":
      return <Badge variant="destructive"><X className="mr-1 h-3 w-3" />Rechazado</Badge>;
    case "received":
      return <Badge variant="default" className="bg-blue-600 text-white"><PackageCheck className="mr-1 h-3 w-3" />Recibido</Badge>;
    case "batched":
      return <Badge variant="default" className="bg-purple-600 text-white"><Box className="mr-1 h-3 w-3" />En Lote</Badge>;
    case "ordered":
      return <Badge variant="default" className="bg-cyan-600 text-white"><FileText className="mr-1 h-3 w-3" />Orden Generada</Badge>;
    default:
      return <Badge variant="outline">Desconocido</Badge>;
  }
};

export default function AdminPurchaseRequestsPage() {
  const { purchaseRequests, users, receivePurchaseRequest, isLoading, materials } = useAppState();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"all" | PurchaseRequestStatus>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [applicantFilter, setApplicantFilter] = useState("");
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;
  const [editingRequest, setEditingRequest] = useState<PurchaseRequest | null>(null);
  const [receivingRequest, setReceivingRequest] = useState<PurchaseRequest | null>(null);

  const supervisorMap = useMemo(
    () => new Map((users || []).map((u: User) => [u.id, u.name])),
    [users]
  );

  const filteredRequests = useMemo(() => {
    let requests = purchaseRequests || [];
    if (statusFilter !== "all") {
      requests = requests.filter((req: PurchaseRequest) => req.status === statusFilter);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      requests = requests.filter((req: PurchaseRequest) =>
        String(req.materialName ?? "").toLowerCase().includes(term)
      );
    }
    if (applicantFilter) {
      const term = applicantFilter.toLowerCase();
      requests = requests.filter((req: PurchaseRequest) =>
        String(supervisorMap.get(req.supervisorId) ?? "").toLowerCase().includes(term)
      );
    }
    return requests;
  }, [purchaseRequests, statusFilter, searchTerm, applicantFilter, supervisorMap]);

  const statusCounts = useMemo(() => {
    const all = purchaseRequests || [];
    return {
      pending: all.filter(r => r.status === "pending").length,
      approved: all.filter(r => r.status === "approved").length,
      ordered: all.filter(r => r.status === "ordered").length,
      batched: all.filter(r => r.status === "batched").length,
      received: all.filter(r => r.status === "received").length,
      rejected: all.filter(r => r.status === "rejected").length,
    };
  }, [purchaseRequests]);

  const paginatedRequests = filteredRequests.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage
  );
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));

  const handleReceive = async (id: string, quantity: number, existingMaterialId?: string) => {
    try {
      await receivePurchaseRequest(id, quantity, existingMaterialId);
      setReceivingRequest(null);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo actualizar el stock.",
      });
    }
  };

  const getChangeTooltip = (req: PurchaseRequest) => {
    if (req.originalQuantity && req.originalQuantity !== req.quantity) {
      return `Cantidad original: ${req.originalQuantity}. ${req.notes || "Sin notas adicionales."}`;
    }
    return req.notes || null;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {editingRequest && (
        <EditPurchaseRequestForm
          request={editingRequest}
          isOpen={true}
          onClose={() => setEditingRequest(null)}
        />
      )}

      <ReceiveRequestDialog
        request={receivingRequest}
        isOpen={!!receivingRequest}
        onClose={() => setReceivingRequest(null)}
        onConfirm={handleReceive}
        materials={materials}
      />

      <PageHeader
        title="Solicitudes de Compra"
        description="Revisa, gestiona y registra el ingreso de materiales aprobados a bodega."
      />

      {/* Resumen de estados */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Pendientes", count: statusCounts.pending, color: "text-yellow-600 dark:text-yellow-400" },
          { label: "Aprobados", count: statusCounts.approved, color: "text-green-600 dark:text-green-400" },
          { label: "En Lote", count: statusCounts.batched, color: "text-purple-600 dark:text-purple-400" },
          { label: "Con Orden", count: statusCounts.ordered, color: "text-cyan-600 dark:text-cyan-400" },
          { label: "Recibidos", count: statusCounts.received, color: "text-blue-600 dark:text-blue-400" },
          { label: "Rechazados", count: statusCounts.rejected, color: "text-red-600 dark:text-red-400" },
        ].map(({ label, count, color }) => (
          <Card key={label} className="text-center py-3 px-2 shadow-sm">
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      <Card className="border-l-4 border-l-orange-500 shadow-sm">
        <CardHeader>
          <CardTitle>Historial de Solicitudes</CardTitle>
          <CardDescription>
            {filteredRequests.length} solicitud{filteredRequests.length !== 1 ? "es" : ""}
            {filteredRequests.length !== (purchaseRequests || []).length && ` filtradas de ${(purchaseRequests || []).length} en total`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-grow">
                <Label htmlFor="search-material">Buscar por material</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search-material"
                    type="search"
                    placeholder="Nombre del material..."
                    className="pl-8"
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                  />
                </div>
              </div>
              <div className="flex-grow">
                <Label htmlFor="applicant-filter">Filtrar por solicitante</Label>
                <div className="relative">
                  <UserIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="applicant-filter"
                    type="search"
                    placeholder="Nombre del solicitante..."
                    className="pl-8"
                    value={applicantFilter}
                    onChange={(e) => { setApplicantFilter(e.target.value); setPage(1); }}
                  />
                </div>
              </div>
              <div className="w-full sm:w-[180px]">
                <Label htmlFor="status-filter">Estado</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value as "all" | PurchaseRequestStatus);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="status-filter">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="pending">Pendiente</SelectItem>
                    <SelectItem value="approved">Aprobado</SelectItem>
                    <SelectItem value="rejected">Rechazado</SelectItem>
                    <SelectItem value="received">Recibido</SelectItem>
                    <SelectItem value="batched">En Lote</SelectItem>
                    <SelectItem value="ordered">Orden Generada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="relative w-full overflow-x-auto rounded-md border">
              <div className="min-w-[1100px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead className="min-w-[220px]">Material</TableHead>
                      <TableHead className="min-w-[120px]">Cantidad</TableHead>
                      <TableHead className="min-w-[260px]">Justificación</TableHead>
                      <TableHead className="min-w-[140px]">Solicitante</TableHead>
                      <TableHead className="min-w-[130px]">Solicitud</TableHead>
                      <TableHead className="min-w-[130px]">Recepción</TableHead>
                      <TableHead className="min-w-[140px]">Estado</TableHead>
                      <TableHead className="min-w-[160px] text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRequests.length > 0 ? (
                      paginatedRequests.map((req: PurchaseRequest) => {
                        const supervisor = String(supervisorMap.get(req.supervisorId) ?? "N/A");
                        const changeTooltip = getChangeTooltip(req);
                        return (
                          <TableRow key={req.id} className="hover:bg-muted/50">
                            <TableCell className="font-medium whitespace-pre-wrap break-words">
                              {String(req.materialName ?? "")}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span>{req.quantity} {req.unit}</span>
                                {changeTooltip && (
                                  <span title={changeTooltip}>
                                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                              {String(req.justification ?? "N/A")}
                            </TableCell>
                            <TableCell>{supervisor}</TableCell>
                            <TableCell className="text-sm">{formatDate(req.createdAt)}</TableCell>
                            <TableCell className="text-sm">
                              {req.receivedAt ? formatDate(req.receivedAt) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>{getStatusBadge(req.status)}</TableCell>
                            <TableCell className="text-right">
                              {req.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingRequest(req)}
                                >
                                  <Edit className="mr-2 h-4 w-4" /> Gestionar
                                </Button>
                              )}
                              {["approved", "batched", "ordered"].includes(req.status) && (
                                <Button
                                  size="sm"
                                  className="bg-blue-600 hover:bg-blue-700"
                                  onClick={() => setReceivingRequest(req)}
                                >
                                  <PackageCheck className="mr-2 h-4 w-4" /> Recibir
                                </Button>
                              )}
                              {req.status === "received" && (
                                <span className="text-xs text-green-600 font-medium">✓ Ingresado</span>
                              )}
                              {req.status === "rejected" && (
                                <span className="text-xs text-red-500 font-medium">✗ Rechazada</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="h-40 text-center">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <ShoppingCart className="h-10 w-10 opacity-30" />
                            <p className="text-sm">
                              {searchTerm || applicantFilter || statusFilter !== "all"
                                ? "No hay solicitudes para los filtros aplicados."
                                : "Aún no hay solicitudes de compra registradas."}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Mostrando {(page - 1) * itemsPerPage + 1}–{Math.min(page * itemsPerPage, filteredRequests.length)} de {filteredRequests.length}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((prev) => prev - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === totalPages}
                    onClick={() => setPage((prev) => prev + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
