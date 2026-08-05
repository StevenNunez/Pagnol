"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { DataTable, DataTableColumn } from "@/components/data-table";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/modules/core/hooks/use-toast";
import { PurchaseRequest, Material, User } from "@/modules/core/lib/data";
import {
  Check,
  PackageCheck,
  Loader2,
  Edit,
  AlertCircle,
  Search,
  User as UserIcon,
  ChevronsUpDown,
  ShoppingCart,
  Building2,
  FileDown,
  ShieldQuestion,
  ArrowRight,
  Truck,
  X,
} from "lucide-react";
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
import * as ExcelJS from "exceljs";
import { resolvePurchaseStage, resolveRentalStage, isRentalDerived, STAGE_META, PurchaseStage } from "@/components/supervisor-purchases/purchase-pipeline";
import { PurchaseStageBadge, STAGE_ICON } from "@/components/supervisor-purchases/purchase-stage-badge";
import { UrgencyBadge, ExpenseKindBadge, ItemSpec, SuggestedSupplier, CecoLine, UrgencyReason, ServiceBadge } from "@/components/operations/request-meta";

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
      <DialogContent className="rounded-[1.5rem]" onInteractOutside={(e) => { e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Registrar Recepción de Material</DialogTitle>
          <DialogDescription>
            Confirma la cantidad de <span className="font-semibold">{String(request.materialName ?? "")}</span> que ha llegado al pañol.
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
              className="rounded-xl"
            />
            <p className="text-xs text-muted-foreground">
              Puedes ajustar la cantidad si es diferente a la aprobada ({request.quantity}).
            </p>
          </div>

          {request.requestTarget === 'client' ? (
            <div className="flex items-start gap-2 p-3 rounded-xl border border-info/30 bg-info-subtle text-info-subtle-foreground text-xs font-medium">
              <Building2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Suministro de <b>{request.clientName || 'el cliente'}</b>: ingresará como <b>activo del cliente</b> (fila separada del stock propio, para su restitución al cierre del contrato). La asignación manual de material no aplica.</span>
            </div>
          ) : (
          <div className="space-y-2">
            <Label>Asignar a Material Existente (Opcional)</Label>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between rounded-xl"
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
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button className="rounded-xl gap-2" onClick={handleConfirmClick} disabled={isSubmitting || !receivedQuantity}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
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
  if (!jsDate) return "—";
  return jsDate.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

type DisplayFilter = "all" | "waiting_adc" | "managing" | "approved" | "ordered" | "received" | "rejected";

export default function AdminPurchaseRequestsPage() {
  const { purchaseRequests, rentalRequests, users, receivePurchaseRequest, isLoading, materials, can } = useAppState();
  const { toast } = useToast();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<DisplayFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [applicantFilter, setApplicantFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const itemsPerPage = 10;
  const [editingRequest, setEditingRequest] = useState<PurchaseRequest | null>(null);
  const [receivingRequest, setReceivingRequest] = useState<PurchaseRequest | null>(null);

  const supervisorMap = useMemo(
    () => new Map((users || []).map((u: User) => [u.id, u.name])),
    [users]
  );

  const getRequesterName = (req: PurchaseRequest) =>
    req.requesterName || supervisorMap.get(req.supervisorId) || "N/A";

  // La etapa de un requerimiento de arriendo se PROYECTA desde su solicitud:
  // acá no hay copia que sincronizar, así que no puede quedar desfasada. Se
  // define antes de los KPI y los filtros porque todos deben contar lo mismo.
  const rentalStatusById = useMemo(() => {
    const m = new Map<string, any>();
    ((rentalRequests || []) as any[]).forEach((r: any) => m.set(r.id, r.status));
    return m;
  }, [rentalRequests]);
  const stageOf = useCallback((req: PurchaseRequest): PurchaseStage =>
    isRentalDerived(req) ? resolveRentalStage(rentalStatusById.get(req.rentalRequestId!)) : resolvePurchaseStage(req),
  [rentalStatusById]);

  const kpis = useMemo(() => {
    const all = purchaseRequests || [];
    const stages = all.map((r) => stageOf(r));
    const count = (pred: (s: PurchaseStage) => boolean) => stages.filter(pred).length;
    return {
      total: all.length,
      waitingAdc: count((s) => s === "waiting_adc"),
      managing: count((s) => s === "in_review" || s === "to_send"),
      approved: count((s) => s === "approved"),
      ordered: count((s) => s === "ordered"),
      received: count((s) => s === "received"),
      rejected: count((s) => s === "rejected"),
    };
  }, [purchaseRequests, stageOf]);

  const KPI_DEFS: { key: DisplayFilter; label: string; count: number; icon: any; iconCls: string }[] = [
    { key: "all", label: "Todas", count: kpis.total, icon: ShoppingCart, iconCls: "bg-primary/10 text-primary" },
    { key: "waiting_adc", label: "Esperando ADC", count: kpis.waitingAdc, icon: ShieldQuestion, iconCls: kpis.waitingAdc > 0 ? "bg-warning-subtle text-warning" : "bg-muted text-muted-foreground" },
    { key: "managing", label: "Por Gestionar", count: kpis.managing, icon: Search, iconCls: kpis.managing > 0 ? "bg-info-subtle text-info" : "bg-muted text-muted-foreground" },
    { key: "approved", label: "Aprobadas", count: kpis.approved, icon: Check, iconCls: "bg-success-subtle text-success-subtle-foreground" },
    { key: "ordered", label: "Ordenadas", count: kpis.ordered, icon: Truck, iconCls: "bg-info-subtle text-info" },
    { key: "received", label: "Recibidas", count: kpis.received, icon: PackageCheck, iconCls: "bg-muted text-muted-foreground" },
    { key: "rejected", label: "Rechazadas", count: kpis.rejected, icon: X, iconCls: kpis.rejected > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground" },
  ];

  const filteredRequests = useMemo(() => {
    let requests = purchaseRequests || [];
    if (statusFilter !== "all") {
      requests = requests.filter((req: PurchaseRequest) => {
        const stage = stageOf(req);
        return statusFilter === "managing" ? (stage === "in_review" || stage === "to_send") : stage === statusFilter;
      });
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      requests = requests.filter((req: PurchaseRequest) =>
        String(req.materialName ?? "").toLowerCase().includes(term) ||
        String(req.internalCode ?? "").toLowerCase().includes(term)
      );
    }
    if (applicantFilter) {
      const term = applicantFilter.toLowerCase();
      requests = requests.filter((req: PurchaseRequest) => getRequesterName(req).toLowerCase().includes(term));
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      requests = requests.filter((req) => { const d = getDate(req.createdAt); return d ? d >= from : false; });
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      requests = requests.filter((req) => { const d = getDate(req.createdAt); return d ? d <= to : false; });
    }
    return requests;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseRequests, statusFilter, searchTerm, applicantFilter, dateFrom, dateTo, supervisorMap]);

  const paginatedRequests = filteredRequests.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage
  );
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));

  const handleReceive = async (id: string, quantity: number, existingMaterialId?: string) => {
    try {
      await receivePurchaseRequest(id, quantity, existingMaterialId);
      setReceivingRequest(null);
      toast({ title: "Recepción registrada", description: "El stock se actualizó correctamente." });
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

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Requerimientos");
      const header = { font: { bold: true }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFEFEF" } } };
      ws.columns = [
        { header: "Código", key: "code", width: 16 },
        { header: "Tipo", key: "type", width: 14 },
        { header: "Material / Servicio", key: "material", width: 34 },
        { header: "Descripción", key: "spec", width: 32 },
        { header: "Cantidad", key: "qty", width: 12 },
        { header: "Unidad", key: "unit", width: 10 },
        { header: "Justificación", key: "just", width: 40 },
        { header: "Solicitante", key: "req", width: 22 },
        // CeCo = contrato (obra) × partida (categoría), los dos ejes juntos.
        { header: "Contrato (CeCo)", key: "contract", width: 26 },
        { header: "Partida (CeCo)", key: "ceco", width: 22 },
        { header: "Urgencia", key: "urgency", width: 12 },
        { header: "Requerido para", key: "neededBy", width: 16 },
        { header: "Motivo de la urgencia", key: "urgencyReason", width: 40 },
        { header: "Tipo de gasto", key: "expenseKind", width: 16 },
        { header: "Proveedor sugerido", key: "supplier", width: 26 },
        { header: "Estado", key: "status", width: 18 },
        { header: "Fecha solicitud", key: "created", width: 16 },
        { header: "Fecha recepción", key: "received", width: 16 },
      ];
      ws.getRow(1).eachCell((c) => Object.assign(c, header));
      for (const req of filteredRequests) {
        ws.addRow({
          code: req.internalCode || req.id.slice(0, 8).toUpperCase(),
          type: req.requestType === "servicio" ? "Servicio" : "Producto",
          material: req.materialName,
          spec: req.itemDescription || "",
          qty: req.quantity,
          unit: req.unit,
          just: req.justification || "",
          req: getRequesterName(req),
          contract: req.contractName || "—",
          // Los requerimientos anteriores a la migración 20260807000000 no
          // tienen estos datos: van vacíos, no se inventan.
          ceco: req.category || "—",
          urgency: req.urgency || "—",
          neededBy: req.neededBy || "—",
          urgencyReason: req.urgencyReason || "",
          expenseKind: req.expenseKind || "—",
          supplier: req.suggestedSupplierName || "—",
          status: STAGE_META[stageOf(req)].label,
          created: formatDate(req.createdAt),
          received: req.receivedAt ? formatDate(req.receivedAt) : "—",
        });
      }
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `solicitudes-compra-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const columns: DataTableColumn<PurchaseRequest>[] = [
    {
      key: "code",
      header: "Código",
      cell: (req) => <span className="font-mono text-xs font-bold text-muted-foreground">{req.internalCode || req.id.slice(0, 8).toUpperCase()}</span>,
    },
    {
      key: "material",
      header: "Material",
      className: "min-w-[220px]",
      cell: (req) => (
        <div className="space-y-1.5">
          <p className="font-medium whitespace-pre-wrap break-words">{String(req.materialName ?? "")}</p>
          <ItemSpec req={req} />
          <CecoLine req={req} />
          <div className="flex flex-wrap items-center gap-1.5">
            {req.requestTarget === "client" && (
              <Badge variant="outline" className="gap-1 border-info/40 bg-info-subtle text-info-subtle-foreground text-[9px] font-black uppercase tracking-widest w-fit">
                <Building2 className="h-3 w-3" /> Cliente{req.clientName ? `: ${req.clientName}` : ""}
              </Badge>
            )}
            <ServiceBadge req={req} />
            <UrgencyBadge req={req} />
            <ExpenseKindBadge req={req} />
          </div>
          <UrgencyReason req={req} />
          <SuggestedSupplier req={req} />
        </div>
      ),
    },
    {
      key: "qty",
      header: "Cantidad",
      cell: (req) => {
        const tooltip = getChangeTooltip(req);
        return (
          <div className="flex items-center gap-2">
            <span>{req.quantity} {req.unit}</span>
            {tooltip && (
              <span title={tooltip}>
                <AlertCircle className="h-4 w-4 text-warning shrink-0" />
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "justification",
      header: "Justificación",
      className: "min-w-[220px] whitespace-pre-wrap break-words text-sm text-muted-foreground",
      cell: (req) => String(req.justification ?? "N/A"),
    },
    { key: "requester", header: "Solicitante", cell: (req) => getRequesterName(req) },
    { key: "created", header: "Solicitud", className: "text-sm", cell: (req) => formatDate(req.createdAt) },
    { key: "received", header: "Recepción", className: "text-sm", cell: (req) => formatDate(req.receivedAt) },
    { key: "status", header: "Estado", cell: (req) => <PurchaseStageBadge stage={stageOf(req)} /> },
    {
      key: "action",
      header: "Acción",
      headerClassName: "text-right",
      className: "text-right",
      cell: (req) => {
        // Un arriendo derivado no se recibe ni se gestiona desde acá: su acción
        // vive en el módulo de Arriendos (RFC-004 F3).
        const stage = stageOf(req);
        if (isRentalDerived(req)) {
          return <span className="text-xs text-muted-foreground">Se gestiona en Arriendos</span>;
        }
        if (stage === "waiting_adc") {
          return <span className="text-xs text-muted-foreground">Esperando autorización ADC</span>;
        }
        if (stage === "to_send") {
          return <span className="text-xs text-muted-foreground">El supervisor debe enviarla al cliente</span>;
        }
        if (stage === "in_review") {
          if (!can("purchase_requests:approve")) {
            return <span className="text-xs text-muted-foreground">Pendiente de gestión por Abastecimiento</span>;
          }
          return (
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setEditingRequest(req)}>
              <Edit className="mr-2 h-4 w-4" /> Gestionar
            </Button>
          );
        }
        if (stage === "approved" || stage === "ordered") {
          return (
            <Button size="sm" className="rounded-xl gap-2" onClick={() => setReceivingRequest(req)}>
              <PackageCheck className="h-4 w-4" /> Recibir
            </Button>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  return (
    <PageShell
      title="Requerimientos (RQ)"
      description="Revisa, gestiona y registra el ingreso de materiales aprobados al pañol."
      toolbar={
        <>
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Material o código..."
                className="pl-9 rounded-xl h-10"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              />
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Solicitante..."
                className="pl-9 rounded-xl h-10"
                value={applicantFilter}
                onChange={(e) => { setApplicantFilter(e.target.value); setPage(1); }}
              />
            </div>
            <Input
              type="date"
              className="rounded-xl h-10 w-full sm:w-[150px]"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
            <Input
              type="date"
              className="rounded-xl h-10 w-full sm:w-[150px]"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>
          <Button
            onClick={handleExport}
            disabled={isExporting || filteredRequests.length === 0}
            className="rounded-[1.5rem] shadow-lg shadow-primary/10 hover:scale-105 active:scale-95 shrink-0"
          >
            {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            Exportar Excel
          </Button>
        </>
      }
    >
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

      {/* KPIs clickeables — filtran la tabla al hacer click */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {KPI_DEFS.map((k) => (
          <button key={k.key} onClick={() => { setStatusFilter(k.key); setPage(1); }} className="text-left">
            <Card className={cn(
              "p-4 rounded-[1.5rem] border-none shadow-sm hover:shadow-lg transition-all h-full",
              statusFilter === k.key && "ring-2 ring-primary",
            )}>
              <div className={cn("inline-flex p-2 rounded-xl mb-3", k.iconCls)}>
                <k.icon size={16} />
              </div>
              <p className="text-2xl font-black font-outfit text-foreground">{k.count}</p>
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mt-1">{k.label}</p>
            </Card>
          </button>
        ))}
      </div>

      {/* Banner: solicitudes esperando al ADC (si el usuario puede autorizar) */}
      {kpis.waitingAdc > 0 && can("purchase_requests:authorize") && (
        <button
          onClick={() => router.push("/dashboard/authorizations")}
          className="w-full flex items-center gap-4 p-4 rounded-2xl border border-warning/30 bg-warning-subtle hover:shadow-md transition-all group text-left"
        >
          <div className="p-2.5 rounded-xl bg-warning/15 text-warning shrink-0"><ShieldQuestion size={18} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black uppercase tracking-tight text-warning-subtle-foreground">
              {kpis.waitingAdc} solicitud{kpis.waitingAdc > 1 ? "es" : ""} esperando al ADC
            </p>
            <p className="text-[11px] text-muted-foreground font-medium">Aún no autorizadas por el Administrador de Contrato — no puedes gestionarlas todavía.</p>
          </div>
          <ArrowRight size={16} className="text-warning shrink-0 group-hover:translate-x-1 transition-transform" />
        </button>
      )}

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Historial de Solicitudes</h2>
          <p className="text-sm text-muted-foreground">
            {filteredRequests.length} solicitud{filteredRequests.length !== 1 ? "es" : ""}
            {filteredRequests.length !== (purchaseRequests || []).length && ` filtradas de ${(purchaseRequests || []).length} en total`}
          </p>
        </div>

        <DataTable
          columns={columns}
          data={paginatedRequests}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          minWidth="1100px"
          empty={{
            icon: <ShoppingCart className="h-8 w-8" />,
            title: searchTerm || applicantFilter || statusFilter !== "all" || dateFrom || dateTo
              ? "No hay solicitudes para los filtros aplicados."
              : "Aún no hay requerimientos registrados.",
          }}
        />

        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Mostrando {(page - 1) * itemsPerPage + 1}–{Math.min(page * itemsPerPage, filteredRequests.length)} de {filteredRequests.length}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={page === 1}
                onClick={() => setPage((prev) => prev - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={page === totalPages}
                onClick={() => setPage((prev) => prev + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
