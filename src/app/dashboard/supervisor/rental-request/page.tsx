"use client";

import React, { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Send, Loader2, KeyRound, Clock, Check, X, AlertCircle, Truck, Calendar, Search, Plus, Trash2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type {
  Contract, ContractWorker, RentalRequest, RentalRequestItem, RentalCategory,
  RentalAssetCategory, RentalBillingCycle,
} from "@/modules/core/lib/data";
import { RENTAL_CATEGORY_DEFAULTS, rentalCategoryLabel } from "@/modules/core/lib/data";

const CYCLE_LABELS: Record<RentalBillingCycle, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  one_time: "Pago único",
};

export default function RentalRequestPage() {
  const { rentalRequests, addRentalRequest, rentalCategories, addRentalCategory, contracts, contractWorkers, can } = useAppState();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  // Opciones de categoría = defaults (código) + custom del tenant (tabla rental_categories).
  const categoryOptions = useMemo(() => {
    const custom = ((rentalCategories || []) as RentalCategory[])
      .map((c) => ({ value: c.name, label: c.name }));
    const seen = new Set(RENTAL_CATEGORY_DEFAULTS.map((d) => d.value));
    return [...RENTAL_CATEGORY_DEFAULTS, ...custom.filter((c) => !seen.has(c.value))];
  }, [rentalCategories]);

  // Diálogo de creación de categoría.
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);

  // Línea en edición (lo que se está por agregar al carrito).
  const [equipmentName, setEquipmentName] = useState("");
  const [category, setCategory] = useState<RentalAssetCategory>("other");
  const [quantity, setQuantity] = useState<number | string>(1);
  // Carrito de equipos del pedido (multi-ítem).
  const [cart, setCart] = useState<RentalRequestItem[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [billingCycle, setBillingCycle] = useState<RentalBillingCycle>("monthly");
  const [contractId, setContractId] = useState("");
  const [area, setArea] = useState("");
  const [justification, setJustification] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Selector de contrato por perfil (oficina elige cualquiera, terreno autocarga el suyo).
  const activeContracts = useMemo(
    () => ((contracts || []) as Contract[])
      .filter((c) => c.status === "active")
      .sort((a, b) => a.name.localeCompare(b.name)),
    [contracts]
  );
  const contractMap = useMemo(
    () => new Map(((contracts || []) as Contract[]).map((c) => [c.id, c])),
    [contracts]
  );
  const canSelectAnyContract = can("material_requests:select_any_contract");
  const myAssignedContracts = useMemo(() => {
    if (!authUser) return [] as Contract[];
    const myIds = new Set(
      ((contractWorkers || []) as ContractWorker[])
        .filter((cw) => cw.userId === authUser.id)
        .map((cw) => cw.contractId)
    );
    return activeContracts.filter((c) => myIds.has(c.id));
  }, [contractWorkers, authUser, activeContracts]);
  const selectableContracts = canSelectAnyContract ? activeContracts : myAssignedContracts;
  const isFieldWorkerSingleContract = !canSelectAnyContract && myAssignedContracts.length === 1;

  useEffect(() => {
    if (isFieldWorkerSingleContract && !contractId) setContractId(myAssignedContracts[0].id);
  }, [isFieldWorkerSingleContract, myAssignedContracts, contractId]);

  const myRequests = useMemo(
    () => ((rentalRequests || []) as RentalRequest[])
      .filter((r) => r.supervisorId === authUser?.id)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [rentalRequests, authUser]
  );

  const resetForm = () => {
    setEquipmentName(""); setCategory("other"); setQuantity(1);
    setCart([]);
    setStartDate(""); setEndDate(""); setBillingCycle("monthly");
    if (!isFieldWorkerSingleContract) setContractId("");
    setArea(""); setJustification("");
  };

  const addLineToCart = () => {
    const name = equipmentName.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Falta el equipo", description: "Escribe el nombre del equipo a arrendar." });
      return;
    }
    setCart((prev) => [...prev, { name, category, quantity: Number(quantity) || 1 }]);
    // Limpia la línea para seguir agregando (mantiene categoría por comodidad).
    setEquipmentName(""); setQuantity(1);
  };

  const removeLineFromCart = (index: number) =>
    setCart((prev) => prev.filter((_, i) => i !== index));

  const handleCreateCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    setCreatingCat(true);
    try {
      await addRentalCategory(name);
      setCategory(name);            // selecciona la recién creada en la línea actual
      setNewCatName("");
      setCatDialogOpen(false);
      toast({ title: "Categoría creada", description: `"${name}" ya está disponible.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo crear", description: e?.message || "Intenta con otro nombre." });
    } finally {
      setCreatingCat(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Permite enviar con la línea en edición sin haber pulsado "Agregar".
    const pending = equipmentName.trim()
      ? [{ name: equipmentName.trim(), category, quantity: Number(quantity) || 1 }]
      : [];
    const items = [...cart, ...pending];
    if (items.length === 0 || !contractId || !authUser) {
      toast({ variant: "destructive", title: "Datos incompletos", description: "Agrega al menos un equipo y selecciona el contrato/obra." });
      return;
    }
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      toast({ variant: "destructive", title: "Fechas inválidas", description: "La fecha de término no puede ser anterior al inicio." });
      return;
    }
    setIsSubmitting(true);
    try {
      const contract = contractMap.get(contractId);
      await addRentalRequest({
        items,
        startDate: startDate || null,
        endDate: endDate || null,
        billingCycleEstimate: billingCycle,
        contractId,
        contractName: contract?.name || null,
        area: area.trim(),
        justification: justification.trim(),
      });
      toast({ title: "Solicitud de arriendo enviada", description: `${items.length} equipo(s). Abastecimiento la revisará y cotizará.` });
      resetForm();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo enviar la solicitud." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusBadge = (status: RentalRequest["status"]) => {
    switch (status) {
      case "pending": return <Badge className="badge-warning"><Clock className="mr-1 h-3 w-3" /> Pendiente</Badge>;
      case "quoting": return <Badge className="badge-info"><Search className="mr-1 h-3 w-3" /> En cotización</Badge>;
      case "approved": return <Badge className="badge-success"><Check className="mr-1 h-3 w-3" /> Aprobada</Badge>;
      case "fulfilled": return <Badge className="badge-success"><KeyRound className="mr-1 h-3 w-3" /> Arriendo creado</Badge>;
      case "rejected": return <Badge variant="destructive"><X className="mr-1 h-3 w-3" /> Rechazada</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const fmt = (d: Date | string | null | undefined) =>
    d ? new Date(d as any).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <PageHeader
        title="Solicitud de Arriendo"
        description="Pide a Abastecimiento el arriendo de maquinaria, camiones, andamios u otros equipos de terceros."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* FORM */}
        <div className="lg:col-span-5">
          <Card className="rounded-[1.5rem] border-l-4 border-l-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <KeyRound className="h-5 w-5 text-primary" /> Nueva Solicitud
              </CardTitle>
              <CardDescription>Describe el equipo y el período que necesitas arrendar.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Carrito de equipos (multi-ítem) */}
                <div className="space-y-3 p-4 border rounded-xl bg-muted/20">
                  <div className="space-y-2">
                    <Label htmlFor="equipment">Equipo a arrendar <span className="text-destructive">*</span></Label>
                    <Input id="equipment" placeholder="Ej: Contenedor oficina, Camión pluma 12 ton..."
                      value={equipmentName} onChange={(e) => setEquipmentName(e.target.value)} disabled={isSubmitting}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLineToCart(); } }} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Categoría</Label>
                      <div className="flex gap-2">
                        <Select value={category} onValueChange={(v) => setCategory(v as RentalAssetCategory)} disabled={isSubmitting}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {categoryOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={isSubmitting}
                          title="Crear categoría" onClick={() => { setNewCatName(""); setCatDialogOpen(true); }}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="qty">Cantidad</Label>
                      <Input id="qty" type="number" min={1} step={1} value={quantity}
                        onChange={(e) => setQuantity(e.target.value.replace(/-/g, ""))} disabled={isSubmitting} />
                    </div>
                  </div>
                  <Button type="button" variant="secondary" className="w-full" onClick={addLineToCart}
                    disabled={isSubmitting || !equipmentName.trim()}>
                    <Plus className="mr-1 h-4 w-4" /> Agregar equipo al pedido
                  </Button>
                </div>

                {/* Lista del carrito */}
                {cart.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      Equipos del pedido ({cart.length})
                    </Label>
                    <div className="space-y-1">
                      {cart.map((it, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 rounded-xl border bg-card text-sm">
                          <Truck className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-medium truncate flex-1">{it.name}</span>
                          <Badge variant="secondary" className="text-[10px] shrink-0">{rentalCategoryLabel(it.category)}</Badge>
                          <span className="text-muted-foreground shrink-0">×{it.quantity}</span>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => removeLineFromCart(idx)} disabled={isSubmitting}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="start" className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Desde</Label>
                    <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={isSubmitting} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end" className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Hasta</Label>
                    <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={isSubmitting} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Modalidad de cobro estimada</Label>
                  <Select value={billingCycle} onValueChange={(v) => setBillingCycle(v as RentalBillingCycle)} disabled={isSubmitting}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CYCLE_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contract">Contrato / Faena <span className="text-destructive">*</span></Label>
                  {isFieldWorkerSingleContract ? (
                    <div className="flex items-center gap-2 h-10 px-3 rounded-xl border bg-muted/40 text-sm">
                      <Truck className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium truncate">
                        {myAssignedContracts[0].name}{myAssignedContracts[0].code ? ` (${myAssignedContracts[0].code})` : ""}
                      </span>
                      <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">Tu contrato</Badge>
                    </div>
                  ) : selectableContracts.length === 0 ? (
                    <div className="flex items-start gap-2 p-3 rounded-xl border border-warning/30 bg-warning-subtle text-warning-subtle-foreground text-xs">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{canSelectAnyContract
                        ? "No hay contratos activos. Crea uno antes de solicitar arriendos."
                        : "No tienes un contrato asignado. Contacta a tu administrador."}</span>
                    </div>
                  ) : (
                    <Select value={contractId} onValueChange={setContractId} disabled={isSubmitting}>
                      <SelectTrigger id="contract"><SelectValue placeholder="Selecciona el contrato..." /></SelectTrigger>
                      <SelectContent>
                        {selectableContracts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="area">Detalle / Ubicación <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                  <Input id="area" placeholder="Ej: Frente de excavación, sector norte" value={area}
                    onChange={(e) => setArea(e.target.value)} disabled={isSubmitting} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="just">Justificación <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                  <Input id="just" placeholder="¿Para qué se necesita?" value={justification}
                    onChange={(e) => setJustification(e.target.value)} disabled={isSubmitting} />
                </div>

                <Button type="submit" className="w-full h-11" disabled={isSubmitting || (cart.length === 0 && !equipmentName.trim()) || !contractId}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando...</> : <><Send className="mr-2 h-4 w-4" /> Enviar Solicitud</>}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* HISTORIAL */}
        <div className="lg:col-span-7 space-y-4">
          <div>
            <h3 className="text-lg font-bold">Mis solicitudes de arriendo</h3>
            <p className="text-sm text-muted-foreground">Seguimiento del estado de tus pedidos.</p>
          </div>
          {myRequests.length > 0 ? (
            myRequests.map((req) => (
              <Card key={req.id} className="rounded-[1.5rem] border-l-4 border-l-transparent hover:border-l-primary/50 transition-all">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      {statusBadge(req.status)}
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{req.internalCode}</span>
                    </div>
                    <span className="text-xs text-muted-foreground flex items-center"><Clock className="h-3 w-3 mr-1" /> {fmt(req.createdAt)}</span>
                  </div>
                  <div className="space-y-1">
                    {req.items.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <Truck className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="font-medium">{it.name}</span>
                        <span className="text-muted-foreground">×{it.quantity}</span>
                        <Badge variant="secondary" className="text-[10px]">{rentalCategoryLabel(it.category)}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span><b>Período:</b> {fmt(req.startDate)} → {fmt(req.endDate)}</span>
                    <span><b>Modalidad:</b> {CYCLE_LABELS[req.billingCycleEstimate]}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <b>Contrato:</b> {req.contractName || contractMap.get(req.contractId || "")?.name || "—"}
                    {req.area ? ` · ${req.area}` : ""}
                  </div>
                  {req.status === "rejected" && req.rejectionReason && (
                    <div className="text-xs text-destructive"><b>Motivo rechazo:</b> {req.rejectionReason}</div>
                  )}
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="text-center py-12 bg-muted/20 rounded-[1.5rem] border-2 border-dashed">
              <KeyRound className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-muted-foreground">Aún no has solicitado arriendos.</p>
            </div>
          )}
        </div>
      </div>

      {/* Diálogo: crear categoría de arriendo */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva categoría de arriendo</DialogTitle>
            <DialogDescription>
              Ej: Contenedores, Andamios, Generadores. Quedará disponible para todo el equipo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="newcat">Nombre de la categoría</Label>
            <Input id="newcat" autoFocus value={newCatName} placeholder="Ej: Contenedores"
              onChange={(e) => setNewCatName(e.target.value)} disabled={creatingCat}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateCategory(); } }} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCatDialogOpen(false)} disabled={creatingCat}>Cancelar</Button>
            <Button type="button" onClick={handleCreateCategory} disabled={creatingCat || !newCatName.trim()}>
              {creatingCat ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</> : <><Plus className="mr-2 h-4 w-4" /> Crear</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
