"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  Send, Loader2, Package, Trash2, AlertCircle, Search, ShoppingCart,
  ChevronDown, Clock, PackageCheck, CheckCircle2, X as XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Material, Contract, ContractWorker, User } from "@/modules/core/lib/data";
import { requestItems, CompatibleMaterialRequest } from "@/components/pagnol-requests/request-shared";
import { MaterialCombobox } from "@/components/supervisor-requests/material-combobox";
import { BeneficiaryCombobox } from "@/components/supervisor-requests/beneficiary-combobox";
import { RequestHistoryCard } from "@/components/supervisor-requests/request-history-card";
import {
  resolveSupervisorStage, matchesHistoryFilter, HISTORY_FILTERS, HistoryFilter,
} from "@/components/supervisor-requests/request-pipeline";

type DeliveryMode = 'self' | 'directed' | 'open';

interface CartItem {
  materialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  stock: number;
  category: string;
}

const PAGE_SIZE = 10;

export default function SupervisorRequestPage() {
  const { materials, addMaterialRequest, requests, contracts, contractWorkers, materialStocks, users, can } = useAppState();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [contractId, setContractId] = useState("");
  const [area, setArea] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('self');
  const [beneficiaryId, setBeneficiaryId] = useState<string | null>(null);

  const [currentMaterialId, setCurrentMaterialId] = useState<string | null>(null);
  const [currentQuantity, setCurrentQuantity] = useState<number | string>("");

  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  // --- Memos & Helpers ---

  const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);

  const selectedBeneficiary = useMemo(
    () => (beneficiaryId ? (users || []).find((u: User) => u.id === beneficiaryId) || null : null),
    [beneficiaryId, users]
  );

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
    const myContractIds = new Set(
      ((contractWorkers || []) as ContractWorker[])
        .filter((cw) => cw.userId === authUser.id)
        .map((cw) => cw.contractId)
    );
    return activeContracts.filter((c) => myContractIds.has(c.id));
  }, [contractWorkers, authUser, activeContracts]);

  const selectableContracts = canSelectAnyContract ? activeContracts : myAssignedContracts;
  const isFieldWorkerSingleContract = !canSelectAnyContract && myAssignedContracts.length === 1;

  useEffect(() => {
    if (isFieldWorkerSingleContract && !contractId) {
      setContractId(myAssignedContracts[0].id);
    }
  }, [isFieldWorkerSingleContract, myAssignedContracts, contractId]);

  // Existencias del contrato seleccionado (y del pool central) por material —
  // informativo: el descuento real puede seguir viniendo en cascada desde
  // otros contratos si el propio no alcanza (ver stockLedger.ts).
  const contractAvailability = useMemo(() => {
    const acc = new Map<string, { contract: number; pool: number }>();
    (materialStocks || []).forEach((s) => {
      if (s.qty <= 0) return;
      const entry = acc.get(s.materialId) || { contract: 0, pool: 0 };
      if (contractId && s.contractId === contractId) entry.contract += s.qty;
      else if (s.contractId === null) entry.pool += s.qty;
      acc.set(s.materialId, entry);
    });
    return acc;
  }, [materialStocks, contractId]);

  const groupedMaterials = useMemo(() => {
    const groups: Record<string, Material[]> = {};
    (materials || []).forEach((m) => {
      if (m.archived) return;
      const cat = m.category || "Otros";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    });
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => a.name.localeCompare(b.name));
    });
    return groups;
  }, [materials]);

  const myRequests = useMemo(() =>
    ((requests || []) as CompatibleMaterialRequest[])
      .filter((r) => r.supervisorId === authUser?.id)
      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()),
    [requests, authUser]
  );

  // KPIs sobre el pipeline real (todo el historial, no solo lo filtrado).
  const kpis = useMemo(() => {
    const acc = { inProgress: 0, readyPickup: 0, delivered: 0, rejected: 0 };
    myRequests.forEach(r => {
      const stage = resolveSupervisorStage(r);
      if (stage === 'waiting_adc' || stage === 'queued') acc.inProgress++;
      else if (stage === 'ready_pickup') acc.readyPickup++;
      else if (stage === 'delivered') acc.delivered++;
      else if (stage === 'rejected') acc.rejected++;
    });
    return acc;
  }, [myRequests]);

  const filteredHistory = useMemo(() => {
    let list = myRequests.filter(r => matchesHistoryFilter(resolveSupervisorStage(r), historyFilter));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(r =>
        (r.internalCode || '').toLowerCase().includes(q)
        || (r.area || '').toLowerCase().includes(q)
        || (r.contractName || contractMap.get(r.contractId || '')?.name || '').toLowerCase().includes(q)
        || requestItems(r).some(it => (materialMap.get(it.materialId)?.name || '').toLowerCase().includes(q))
      );
    }
    return list;
  }, [myRequests, historyFilter, search, materialMap, contractMap]);

  const setHistoryFilterReset = (f: HistoryFilter) => { setHistoryFilter(f); setVisible(PAGE_SIZE); };

  // --- Handlers ---

  const handleSelectMaterial = useCallback((material: Material) => {
    setCurrentMaterialId(material.id);
  }, []);

  const handleAddItemToCart = useCallback(() => {
    if (!currentMaterialId || !currentQuantity) {
      toast({ variant: "destructive", title: "Datos incompletos", description: "Selecciona un material y una cantidad." });
      return;
    }
    const material = materialMap.get(currentMaterialId);
    if (!material) return;

    const quantity = Number(currentQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      toast({ variant: "destructive", title: "Error", description: "La cantidad debe ser mayor a 0." });
      return;
    }
    if (quantity > material.stock) {
      toast({ variant: "destructive", title: "Stock insuficiente", description: `Solo hay ${material.stock} unidades disponibles.` });
      return;
    }

    setCart(prev => {
      const exists = prev.find(item => item.materialId === currentMaterialId);
      if (exists) {
        toast({ title: "Actualizado", description: "Se actualizó la cantidad del material en la lista." });
        return prev.map(item => item.materialId === currentMaterialId ? { ...item, quantity } : item);
      }
      return [...prev, {
        materialId: material.id,
        materialName: material.name,
        quantity,
        unit: material.unit,
        stock: material.stock,
        category: material.category || "General"
      }];
    });

    setCurrentMaterialId(null);
    setCurrentQuantity("");
  }, [currentMaterialId, currentQuantity, materialMap, toast]);

  const handleRemoveItemFromCart = (materialId: string) => {
    setCart(cart.filter(item => item.materialId !== materialId));
  };

  const handleUpdateCartQuantity = (materialId: string, newQty: string) => {
    const qty = Number(newQty);
    if (isNaN(qty) || qty < 0) return;
    setCart(prev => prev.map(item => {
      if (item.materialId === materialId) {
        if (qty > item.stock) {
          toast({ variant: "destructive", title: "Stock límite", description: `Máximo ${item.stock} unidades.` });
          return { ...item, quantity: item.stock };
        }
        return { ...item, quantity: qty };
      }
      return item;
    }));
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0 || !contractId || !authUser) {
      toast({ variant: "destructive", title: "Error", description: "Añade materiales y selecciona el contrato/obra." });
      return;
    }
    if (cart.some(item => item.quantity <= 0)) {
      toast({ variant: "destructive", title: "Cantidad inválida", description: "Todos los ítems deben tener cantidad mayor a 0." });
      return;
    }
    if (deliveryMode === 'directed' && !beneficiaryId) {
      toast({ variant: "destructive", title: "Falta el destinatario", description: "Selecciona al trabajador que retirará el pedido." });
      return;
    }

    setIsSubmitting(true);
    try {
      const contract = contractMap.get(contractId);
      await addMaterialRequest({
        items: cart.map(({ materialId, quantity }) => ({ materialId, quantity })),
        area: area.trim(),
        contractId,
        contractName: contract?.name || null,
        supervisorId: authUser.id,
        deliveryMode,
        beneficiaryId: deliveryMode === 'directed' ? beneficiaryId : null,
        beneficiaryName: deliveryMode === 'directed' ? (selectedBeneficiary?.name || null) : null,
      });
      toast({ title: "Solicitud enviada", description: "Sigue su avance en el historial de esta página." });
      setCart([]);
      setContractId(isFieldWorkerSingleContract ? myAssignedContracts[0].id : "");
      setArea("");
      setDeliveryMode('self');
      setBeneficiaryId(null);
    } catch (error: any) {
      // Mostrar el mensaje real de la mutación (stock insuficiente, destinatario
      // faltante, etc.) en vez de un genérico que oculta qué corregir.
      toast({ variant: "destructive", title: "No se pudo enviar la solicitud", description: error?.message || "Error inesperado." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentSelectedMaterial = currentMaterialId ? materialMap.get(currentMaterialId) : null;
  const currentAvailability = currentMaterialId ? contractAvailability.get(currentMaterialId) : undefined;
  const noStockInContract = !!contractId && !!currentSelectedMaterial && (currentAvailability?.contract || 0) === 0 && currentSelectedMaterial.stock > 0;

  const KPI_ITEMS = [
    { key: 'in_progress' as HistoryFilter, label: 'En trámite', value: kpis.inProgress, icon: Clock, iconCls: 'bg-info-subtle text-info' },
    { key: 'ready_pickup' as HistoryFilter, label: 'Listas para retiro', value: kpis.readyPickup, icon: PackageCheck, iconCls: kpis.readyPickup > 0 ? 'bg-success-subtle text-success-subtle-foreground' : 'bg-muted text-muted-foreground' },
    { key: 'delivered' as HistoryFilter, label: 'Entregadas', value: kpis.delivered, icon: CheckCircle2, iconCls: 'bg-muted text-muted-foreground' },
    { key: 'rejected' as HistoryFilter, label: 'Rechazadas', value: kpis.rejected, icon: XIcon, iconCls: kpis.rejected > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground' },
  ];

  return (
    <PageShell
      title="Solicitud de Materiales"
      description="Genera pedidos de material al pañol central para tu faena."
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        {/* COLUMNA IZQUIERDA: FORMULARIO */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-card rounded-[2rem] border shadow-sm p-8 space-y-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-primary/10 text-primary shrink-0">
                <ShoppingCart size={20} />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight">Nueva Solicitud</h3>
                <p className="text-xs text-muted-foreground font-medium">Agrega los ítems que necesitas.</p>
              </div>
            </div>

            <form onSubmit={handleRequestSubmit} className="space-y-6">

              <div className="space-y-4 p-5 border rounded-2xl bg-muted/30">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">1. Seleccionar material</Label>
                  <MaterialCombobox
                    groupedMaterials={groupedMaterials}
                    selectedId={currentMaterialId}
                    onSelect={handleSelectMaterial}
                    availability={contractAvailability}
                    hasContractSelected={!!contractId}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="flex gap-3 items-end">
                  <div className="space-y-2 flex-grow">
                    <Label htmlFor="quantity" className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">2. Cantidad</Label>
                    <div className="relative">
                      <Input
                        id="quantity"
                        type="number"
                        placeholder="0"
                        value={currentQuantity}
                        onChange={e => setCurrentQuantity(e.target.value)}
                        disabled={!currentMaterialId || isSubmitting}
                        className="pr-12 h-12 rounded-xl"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleAddItemToCart(); }
                        }}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground uppercase">
                        {currentSelectedMaterial?.unit || 'ud'}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={handleAddItemToCart}
                    disabled={!currentMaterialId || !currentQuantity || isSubmitting}
                    className="h-12 rounded-xl px-5 gap-1.5"
                    variant="secondary"
                  >
                    <Package className="h-4 w-4" /> Agregar
                  </Button>
                </div>

                {currentSelectedMaterial && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground font-medium">Disponible:</span>
                      <span className={cn("font-bold", currentSelectedMaterial.stock < 10 ? "text-destructive" : "text-success")}>
                        {currentSelectedMaterial.stock} {currentSelectedMaterial.unit}
                      </span>
                      {Number(currentQuantity) > currentSelectedMaterial.stock && (
                        <span className="text-destructive font-black ml-auto flex items-center gap-1 text-[10px] uppercase tracking-widest">
                          <AlertCircle className="h-3 w-3" /> Excede stock
                        </span>
                      )}
                    </div>
                    {noStockInContract && (
                      <p className="text-[10px] font-bold text-warning uppercase tracking-wide flex items-center gap-1.5">
                        <AlertCircle className="h-3 w-3 shrink-0" /> Sin stock propio en este contrato — saldrá del pool central u otro contrato.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Carrito */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Resumen del pedido</Label>
                  <span className="text-xs text-muted-foreground font-bold">{cart.length} ítems</span>
                </div>

                <div className="h-[200px] w-full rounded-2xl border bg-card p-2 overflow-y-auto">
                  {cart.length > 0 ? (
                    <div className="space-y-1">
                      {cart.map(item => (
                        <div key={item.materialId} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 group transition-colors border border-transparent hover:border-border">
                          <div className="flex-1 min-w-0 mr-3">
                            <p className="text-sm font-bold truncate">{item.materialName}</p>
                            <p className="text-[10px] text-muted-foreground font-medium truncate uppercase tracking-wide">{item.category}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => handleUpdateCartQuantity(item.materialId, e.target.value)}
                              className="h-8 w-16 text-right text-xs px-2 rounded-lg"
                            />
                            <span className="text-xs text-muted-foreground w-6 font-bold">{item.unit}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-lg"
                              onClick={() => handleRemoveItemFromCart(item.materialId)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-2 opacity-50">
                      <Package className="h-8 w-8" />
                      <p className="text-xs font-medium">Tu lista está vacía</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                    Contrato / Faena <span className="text-destructive">*</span>
                  </Label>
                  {isFieldWorkerSingleContract ? (
                    <div className="flex items-center gap-2 h-12 px-4 rounded-xl border bg-muted/40 text-sm">
                      <Package className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-bold truncate">
                        {myAssignedContracts[0].name}{myAssignedContracts[0].code ? ` (${myAssignedContracts[0].code})` : ""}
                      </span>
                      <Badge variant="secondary" className="ml-auto text-[9px] shrink-0 font-black uppercase tracking-widest">Tu contrato</Badge>
                    </div>
                  ) : selectableContracts.length === 0 ? (
                    <div className="flex items-start gap-2 p-4 rounded-xl border border-warning/30 bg-warning-subtle text-warning-subtle-foreground text-xs font-medium">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        {canSelectAnyContract
                          ? "No hay contratos activos. Crea uno en el módulo de contratos antes de solicitar materiales."
                          : "No tienes un contrato asignado. Contacta a tu administrador para que te vincule a una obra antes de solicitar materiales."}
                      </span>
                    </div>
                  ) : (
                    <Select value={contractId} onValueChange={setContractId} disabled={isSubmitting}>
                      <SelectTrigger className="h-12 rounded-xl">
                        <SelectValue placeholder="Selecciona el contrato…" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableContracts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {canSelectAnyContract && (
                    <p className="text-[10px] text-muted-foreground font-medium">
                      Como perfil administrativo puedes solicitar para cualquier contrato activo.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                    ¿Quién retira? <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex items-center gap-1 bg-muted/50 border rounded-xl p-1">
                    {([
                      { value: 'self', label: 'Yo mismo' },
                      { value: 'directed', label: 'Otro trabajador' },
                      { value: 'open', label: 'Retiro abierto' },
                    ] as { value: DeliveryMode; label: string }[]).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          setDeliveryMode(opt.value);
                          if (opt.value !== 'directed') setBeneficiaryId(null);
                        }}
                        className={cn(
                          "flex-1 px-3 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                          deliveryMode === opt.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {deliveryMode === 'directed' && (
                    <BeneficiaryCombobox
                      users={(users || []) as User[]}
                      excludeUserId={authUser?.id}
                      selectedId={beneficiaryId}
                      onSelect={(u) => setBeneficiaryId(u.id)}
                      disabled={isSubmitting}
                    />
                  )}
                  <p className="text-[10px] text-muted-foreground font-medium">
                    {deliveryMode === 'self' && "Retirarás el pedido tú mismo en el pañol (verificación biométrica)."}
                    {deliveryMode === 'directed' && "El pedido quedará dirigido: solo ese trabajador podrá retirarlo, verificado por biometría."}
                    {deliveryMode === 'open' && "Cualquier trabajador podrá retirarlo; quien retire quedará registrado al momento de la entrega."}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="area" className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                    Detalle / Ubicación <span className="text-muted-foreground font-normal normal-case tracking-normal">(opcional)</span>
                  </Label>
                  <Input
                    id="area"
                    placeholder="Ej: Torre A, Piso 3"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    disabled={isSubmitting}
                    className="h-12 rounded-xl"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 rounded-xl text-sm font-black uppercase tracking-widest shadow-lg shadow-primary/10 gap-2"
                  disabled={isSubmitting || cart.length === 0 || !contractId}
                >
                  {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : <><Send className="h-4 w-4" /> Enviar solicitud</>}
                </Button>
              </div>
            </form>
          </div>
        </div>

        {/* COLUMNA DERECHA: HISTORIAL */}
        <div className="lg:col-span-7 space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {KPI_ITEMS.map((k) => (
              <button key={k.key} onClick={() => setHistoryFilterReset(k.key)} className="text-left">
                <Card className="p-5 rounded-[1.5rem] border-none shadow-sm hover:shadow-lg transition-all h-full">
                  <div className={cn("p-2.5 rounded-xl w-fit shadow-sm mb-4", k.iconCls)}>
                    <k.icon size={16} />
                  </div>
                  <p className="text-2xl font-black font-outfit text-foreground">{k.value}</p>
                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mt-1">{k.label}</p>
                </Card>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1 bg-muted/50 border rounded-xl p-1 w-fit max-w-full">
              {HISTORY_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setHistoryFilterReset(key)}
                  className={cn(
                    "px-3.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                    historyFilter === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
              <Input
                value={search}
                onChange={e => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
                placeholder="Buscar código o material…"
                className="h-10 rounded-xl pl-10 text-xs bg-card"
              />
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <EmptyState
              icon={<Search size={24} />}
              title={search ? 'Sin resultados' : 'No se encontraron solicitudes'}
              description={search ? `No se encontró "${search}".` : 'Tus solicitudes aparecerán aquí una vez enviadas.'}
            />
          ) : (
            <>
              <div className="space-y-4">
                {filteredHistory.slice(0, visible).map((req) => (
                  <RequestHistoryCard
                    key={req.id}
                    req={req}
                    materialMap={materialMap}
                    contractName={req.contractName || contractMap.get(req.contractId || '')?.name}
                  />
                ))}
              </div>
              {filteredHistory.length > visible && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" onClick={() => setVisible(v => v + PAGE_SIZE)} className="rounded-[1.5rem] px-8 h-11 text-xs font-black uppercase tracking-widest gap-2">
                    Mostrar más ({filteredHistory.length - visible}) <ChevronDown size={16} />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
