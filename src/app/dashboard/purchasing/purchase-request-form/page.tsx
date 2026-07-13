"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { PageShell } from "@/components/page-shell";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { EmptyState } from "@/components/empty-state";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  Send, Loader2, Plus, Trash2, ShoppingCart, ChevronsUpDown, Search, AlertCircle, Package,
  ChevronDown, Clock, CheckCircle2, Truck, PackageCheck, X as XIcon, Building2, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Material, Contract, ContractWorker, PurchaseRequest, Client } from "@/modules/core/lib/data";
import { supabase } from "@/modules/core/lib/supabase";
import { generateClientSupplyPDF } from "@/lib/pdf-generator";
import { PurchaseMaterialCombobox } from "@/components/supervisor-purchases/purchase-material-combobox";
import { PurchaseHistoryCard } from "@/components/supervisor-purchases/purchase-history-card";
import {
  resolvePurchaseStage, matchesHistoryFilter, HISTORY_FILTERS, HistoryFilter, groupKey,
} from "@/components/supervisor-purchases/purchase-pipeline";

const PURCHASE_UNITS = ["unidad", "caja", "m2", "m3", "litro", "kg", "tonelada", "metro", "paquete", "global"];
const PAGE_SIZE = 10;

interface CartItem {
  tempId: string;
  materialId?: string;
  materialName: string;
  category: string;
  quantity: number;
  unit: string;
}

export default function PurchaseRequestFormPage() {
  const { purchaseRequests, materials, addPurchaseRequest, markClientRequestsSent, materialCategories, contracts, contractWorkers, clients, currentTenant, can } = useAppState();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [contractId, setContractId] = useState("");
  const [commonArea, setCommonArea] = useState("");
  const [commonJustification, setCommonJustification] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Destino de la solicitud: compra a proveedor (histórico) o suministro del
  // cliente del contrato (el cliente proporciona el material — caso Novandino).
  const [target, setTarget] = useState<'supplier' | 'client'>('supplier');

  const activeContracts = useMemo(
    () => ((contracts || []) as Contract[]).filter((c) => c.status === "active").sort((a, b) => a.name.localeCompare(b.name)),
    [contracts]
  );
  const contractMap = useMemo(() => new Map(((contracts || []) as Contract[]).map((c) => [c.id, c])), [contracts]);
  const canSelectAnyContract = can("material_requests:select_any_contract");
  const myAssignedContracts = useMemo(() => {
    if (!authUser) return [] as Contract[];
    const myContractIds = new Set(
      ((contractWorkers || []) as ContractWorker[]).filter((cw) => cw.userId === authUser.id).map((cw) => cw.contractId)
    );
    return activeContracts.filter((c) => myContractIds.has(c.id));
  }, [contractWorkers, authUser, activeContracts]);
  const selectableContracts = canSelectAnyContract ? activeContracts : myAssignedContracts;
  const isFieldWorkerSingleContract = !canSelectAnyContract && myAssignedContracts.length === 1;

  useEffect(() => {
    if (isFieldWorkerSingleContract && !contractId) setContractId(myAssignedContracts[0].id);
  }, [isFieldWorkerSingleContract, myAssignedContracts, contractId]);

  // Cliente del contrato seleccionado (para solicitudes de suministro).
  const clientMap = useMemo(() => new Map(((clients || []) as Client[]).map((c) => [c.id, c])), [clients]);
  const selectedContract = contractId ? contractMap.get(contractId) : undefined;
  const contractClient = selectedContract?.clientId ? clientMap.get(selectedContract.clientId) : undefined;

  // --- Ítem en edición ---
  const [currentMaterialId, setCurrentMaterialId] = useState<string | null>(null);
  const [currentName, setCurrentName] = useState("");
  const [currentCategory, setCurrentCategory] = useState("");
  const [currentQuantity, setCurrentQuantity] = useState("");
  const [currentUnit, setCurrentUnit] = useState("");
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);

  // Prefill vía ?materialId= (botón "Reponer" del Centro de Reportes).
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    const mid = new URLSearchParams(window.location.search).get("materialId");
    if (!mid) { prefilledRef.current = true; return; }
    const material = (materials || []).find((m) => m.id === mid);
    if (!material) return;
    prefilledRef.current = true;
    setCurrentMaterialId(material.id);
    setCurrentName(material.name);
    setCurrentCategory(material.category || "");
    setCurrentUnit(material.unit || "");
  }, [materials]);

  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const groupedMaterials = useMemo(() => {
    const groups: Record<string, Material[]> = {};
    (materials || []).forEach((m) => {
      const cat = m.category || "Otros";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    });
    Object.keys(groups).forEach(key => groups[key].sort((a, b) => a.name.localeCompare(b.name)));
    return groups;
  }, [materials]);

  const myRequests = useMemo(() => {
    if (!purchaseRequests || !authUser) return [];
    return [...purchaseRequests]
      .filter(r => r.supervisorId === authUser.id)
      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());
  }, [purchaseRequests, authUser]);

  // KPIs a nivel de ítem (fila) — honesto y simple, coherente con supervisor/request.
  const kpis = useMemo(() => {
    const acc = { inProgress: 0, approved: 0, ordered: 0, received: 0, rejected: 0 };
    myRequests.forEach(r => {
      const stage = resolvePurchaseStage(r);
      // 'to_send' (suministro autorizado, por enviar al cliente) cuenta como en trámite.
      if (stage === 'waiting_adc' || stage === 'in_review' || stage === 'to_send') acc.inProgress++;
      else acc[stage]++;
    });
    return acc;
  }, [myRequests]);

  // Agrupa por batch (mismo carrito) para mostrar un pedido de N ítems como una tarjeta.
  const groupedHistory = useMemo(() => {
    const map = new Map<string, typeof myRequests>();
    myRequests.forEach(r => {
      const key = groupKey(r);
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    });
    // Cada grupo se ordena por la fecha del ítem más reciente que contiene.
    return Array.from(map.values()).sort(
      (a, b) => Math.max(...b.map(r => new Date(r.createdAt as any).getTime())) - Math.max(...a.map(r => new Date(r.createdAt as any).getTime()))
    );
  }, [myRequests]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupedHistory.filter(group => {
      const matchesFilter = group.some(r => matchesHistoryFilter(resolvePurchaseStage(r), historyFilter));
      if (!matchesFilter) return false;
      if (!q) return true;
      return group.some(r =>
        (r.internalCode || '').toLowerCase().includes(q)
        || r.materialName.toLowerCase().includes(q)
        || (r.contractName || '').toLowerCase().includes(q)
        || (r.category || '').toLowerCase().includes(q)
      );
    });
  }, [groupedHistory, historyFilter, search]);

  const setHistoryFilterReset = (f: HistoryFilter) => { setHistoryFilter(f); setVisible(PAGE_SIZE); };

  const handleSelectMaterial = (material: Material) => {
    setCurrentMaterialId(material.id);
    setCurrentName(material.name);
    setCurrentCategory(material.category || "");
    setCurrentUnit(material.unit || "");
  };

  const handleAddItem = () => {
    if (!currentName.trim()) {
      toast({ variant: "destructive", title: "Falta nombre", description: "Debes seleccionar o escribir un nombre de material." });
      return;
    }
    if (!currentQuantity || Number(currentQuantity) <= 0) {
      toast({ variant: "destructive", title: "Cantidad inválida", description: "Ingresa una cantidad positiva." });
      return;
    }
    if (!currentUnit) {
      toast({ variant: "destructive", title: "Falta unidad", description: "Selecciona una unidad de medida." });
      return;
    }

    setCart(prev => [...prev, {
      tempId: Math.random().toString(36).substr(2, 9),
      materialId: currentMaterialId || undefined,
      materialName: currentName,
      category: currentCategory || "General",
      quantity: Number(currentQuantity),
      unit: currentUnit,
    }]);

    setCurrentMaterialId(null);
    setCurrentName("");
    setCurrentQuantity("");
  };

  const handleRemoveItem = (id: string) => setCart(cart.filter(i => i.tempId !== id));

  const handleSubmitAll = async () => {
    if (!authUser) return;
    if (cart.length === 0) {
      toast({ variant: "destructive", title: "Carrito vacío", description: "Agrega al menos un ítem a la lista." });
      return;
    }
    if (!contractId || !commonJustification.trim()) {
      toast({ variant: "destructive", title: "Faltan datos generales", description: "Debes seleccionar el contrato y la justificación." });
      return;
    }
    if (target === 'client' && !contractClient) {
      toast({ variant: "destructive", title: "El contrato no tiene cliente", description: "Asocia un cliente al contrato en Configuración → Clientes antes de solicitar un suministro." });
      return;
    }

    setIsSubmitting(true);
    // Un solo batchId para todo el carrito → el historial las agrupa como un pedido.
    const batchId = cart.length > 1 ? nanoid() : null;
    const contract = contractMap.get(contractId);

    try {
      const results = await Promise.allSettled(cart.map(item => addPurchaseRequest({
        materialName: item.materialName,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        area: commonArea.trim(),
        contractId,
        contractName: contract?.name || null,
        justification: commonJustification,
        supervisorId: authUser.id,
        batchId,
        ...(target === 'client' ? {
          requestTarget: 'client' as const,
          clientId: contractClient!.id,
          clientName: contractClient!.name,
        } : {}),
      })));

      const failedIdx = new Set(results.map((r, i) => r.status === 'rejected' ? i : -1).filter(i => i >= 0));
      const succeeded = cart.length - failedIdx.size;

      if (failedIdx.size === 0) {
        toast({
          title: "Solicitud enviada",
          description: target === 'client'
            ? `${succeeded} ítem(s) enviados a autorización del ADC. Tras la autorización podrás enviarla por correo a ${contractClient?.name}.`
            : `${succeeded} ítem(s) enviados a revisión.`,
        });
        setCart([]);
        setContractId(isFieldWorkerSingleContract ? myAssignedContracts[0].id : "");
        setCommonArea("");
        setCommonJustification("");
      } else {
        // Envío parcial: los ítems que SÍ entraron ya están en la base — nunca
        // reintentar el carrito completo o se duplican. Solo dejamos en la
        // lista los que fallaron, para reintentar exclusivamente esos.
        const firstError = (results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason;
        setCart(prev => prev.filter((_, i) => failedIdx.has(i)));
        toast({
          variant: "destructive",
          title: succeeded > 0 ? `Se enviaron ${succeeded} de ${cart.length} ítems` : "No se pudo enviar la solicitud",
          description: `${failedIdx.size} ítem(s) fallaron${firstError?.message ? `: ${firstError.message}` : ''}. ${succeeded > 0 ? 'Se mantuvieron en la lista solo los que fallaron.' : ''}`,
        });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "No se pudo enviar la solicitud", description: error?.message || "Error inesperado." });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Envío del suministro al cliente (post-autorización ADC) ────────────────
  const [sendingItems, setSendingItems] = useState<PurchaseRequest[] | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const openSendToClient = (items: PurchaseRequest[]) => {
    const client = items[0]?.clientId ? clientMap.get(items[0].clientId) : undefined;
    // Si ya se había enviado antes, precarga el destinatario usado la última
    // vez (así se puede corregir un typo) en vez del correo genérico del cliente.
    setSendTo(items[0]?.sentToClientEmail || client?.contactEmail || '');
    setSendMessage('');
    setSendingItems(items);
  };

  const handleSendToClient = async () => {
    if (!sendingItems?.length) return;
    const anchor = sendingItems[0];
    const client = anchor.clientId ? clientMap.get(anchor.clientId) : undefined;
    if (!client) { toast({ variant: 'destructive', title: 'Cliente no encontrado', description: 'La solicitud no tiene un cliente válido asociado.' }); return; }
    if (!sendTo.trim()) { toast({ variant: 'destructive', title: 'Falta el correo', description: 'Indica al menos un destinatario.' }); return; }

    setIsSendingEmail(true);
    try {
      const { blob, filename } = await generateClientSupplyPDF(
        sendingItems,
        client,
        { name: currentTenant?.name, rut: currentTenant?.rut, address: currentTenant?.address, logoUrl: currentTenant?.logoUrl },
        authUser?.name,
      );
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Sesión no disponible. Vuelve a iniciar sesión.');
      const code = anchor.internalCode || anchor.id.slice(0, 8).toUpperCase();
      const res = await fetch('/api/purchasing/send-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: sendTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
          subject: `Solicitud de suministro ${code} · ${currentTenant?.name || ''}`.trim(),
          message: sendMessage.trim() || undefined,
          pdfBase64,
          filename,
          orderCode: code,
          docLabel: 'Solicitud de suministro',
          companyName: currentTenant?.name,
          companyLogoUrl: currentTenant?.logoUrl,
          senderName: authUser?.name,
          senderEmail: authUser?.email,
          senderPhone: authUser?.phone,
          senderRole: authUser?.cargo,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      // Correo afuera → recién ahora se marcan como enviadas (ordered).
      await markClientRequestsSent(sendingItems.map((r) => r.id), sendTo.trim());
      toast({ title: 'Solicitud enviada al cliente', description: `Se envió a ${sendTo}. Quedó en espera de la entrega de ${client.name}.` });
      setSendingItems(null);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo enviar', description: e?.message || 'Error desconocido.' });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const KPI_ITEMS = [
    { key: 'in_progress' as HistoryFilter, label: 'En trámite', value: kpis.inProgress, icon: Clock, iconCls: 'bg-info-subtle text-info' },
    { key: 'approved' as HistoryFilter, label: 'Aprobadas', value: kpis.approved, icon: CheckCircle2, iconCls: kpis.approved > 0 ? 'bg-success-subtle text-success-subtle-foreground' : 'bg-muted text-muted-foreground' },
    { key: 'ordered' as HistoryFilter, label: 'Ordenadas', value: kpis.ordered, icon: Truck, iconCls: 'bg-info-subtle text-info' },
    { key: 'received' as HistoryFilter, label: 'Recibidas', value: kpis.received, icon: PackageCheck, iconCls: 'bg-muted text-muted-foreground' },
  ];

  return (
    <PageShell
      title="Solicitud de Compra"
      description="Gestiona la adquisición de materiales externos o sin stock en el pañol."
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">

        {/* COLUMNA IZQUIERDA: FORMULARIO */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-card rounded-[2rem] border shadow-sm p-8 space-y-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-primary/10 text-primary shrink-0">
                {target === 'client' ? <Building2 size={20} /> : <ShoppingCart size={20} />}
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight">{target === 'client' ? 'Suministro del Cliente' : 'Nueva Compra'}</h3>
                <p className="text-xs text-muted-foreground font-medium">
                  {target === 'client'
                    ? 'El cliente del contrato proporciona los materiales. Ingresan como activos del cliente.'
                    : 'Agrega múltiples ítems y envíalos en un solo pedido.'}
                </p>
              </div>
            </div>

            {/* Destino de la solicitud */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted/50 border">
              {([['supplier', 'Comprar a proveedor', ShoppingCart], ['client', 'Solicitar al cliente', Building2]] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setTarget(value)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all',
                    target === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            {target === 'client' && contractId && (
              contractClient ? (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-info/30 bg-info-subtle text-info-subtle-foreground text-xs font-medium">
                  <Building2 className="h-4 w-4 shrink-0" />
                  <span>Se solicitará a <b>{contractClient.name}</b>{contractClient.contactEmail ? ` (${contractClient.contactEmail})` : ' — sin correo de contacto registrado'}.</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-xl border border-warning/30 bg-warning-subtle text-warning-subtle-foreground text-xs font-medium">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>El contrato seleccionado no tiene un cliente asociado. Asócialo en Configuración → Clientes para poder solicitar suministros.</span>
                </div>
              )
            )}

            <div className="space-y-4 p-5 border rounded-2xl bg-muted/30">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">1. Detalle del ítem</Label>
                  <button
                    type="button"
                    onClick={() => { setCurrentName(""); setCurrentMaterialId(null); }}
                    className="text-[10px] font-bold text-primary hover:underline"
                  >
                    Limpiar
                  </button>
                </div>
                <PurchaseMaterialCombobox
                  groupedMaterials={groupedMaterials}
                  currentName={currentName}
                  selectedId={currentMaterialId}
                  onSelectMaterial={handleSelectMaterial}
                  onFreeText={(text) => { setCurrentName(text); setCurrentMaterialId(null); }}
                  disabled={isSubmitting}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Cantidad</Label>
                  <Input
                    type="number"
                    className="h-11 rounded-xl"
                    placeholder="Ej: 10"
                    value={currentQuantity}
                    onChange={e => setCurrentQuantity(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddItem()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Unidad</Label>
                  <Select value={currentUnit} onValueChange={setCurrentUnit}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Ud." /></SelectTrigger>
                    <SelectContent>
                      {PURCHASE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Categoría (opcional)</Label>
                <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between h-11 rounded-xl font-normal">
                      <span className="truncate">{currentCategory || "Seleccionar categoría…"}</span>
                      <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl">
                    <Command>
                      <CommandInput placeholder="Categoría…" />
                      <CommandList>
                        <CommandEmpty>No encontrada.</CommandEmpty>
                        <CommandGroup>
                          {(materialCategories || []).map(cat => (
                            <CommandItem key={cat.id} value={`${cat.name} ${cat.id}`} onSelect={() => { setCurrentCategory(cat.name); setCategoryPopoverOpen(false); }}>
                              {cat.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <Button className="w-full h-11 rounded-xl gap-2" variant="secondary" onClick={handleAddItem} disabled={!currentName || isSubmitting}>
                <Plus className="h-4 w-4" /> Agregar a la lista
              </Button>
            </div>

            {/* Carrito */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">2. Lista de pedido ({cart.length})</Label>
                {cart.length > 0 && (
                  <button type="button" onClick={() => setCart([])} className="text-[10px] font-bold text-destructive hover:underline">
                    Borrar todo
                  </button>
                )}
              </div>
              <div className="h-[200px] rounded-2xl border bg-card p-2 overflow-y-auto">
                {cart.length > 0 ? (
                  <div className="space-y-1">
                    {cart.map((item, idx) => (
                      <div key={item.tempId} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 group transition-colors border border-transparent hover:border-border">
                        <div className="flex items-center gap-3 min-w-0">
                          <Badge variant="outline" className="h-6 w-6 rounded-full flex items-center justify-center p-0 shrink-0 bg-muted text-muted-foreground text-[10px] font-black">
                            {idx + 1}
                          </Badge>
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate">{item.materialName}</p>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{item.category} · <span className="text-foreground font-bold">{item.quantity} {item.unit}</span></p>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0 rounded-lg" onClick={() => handleRemoveItem(item.tempId)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground/50 gap-2">
                    <ShoppingCart className="h-8 w-8" />
                    <p className="text-xs font-medium">La lista está vacía.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Datos generales */}
            <div className="space-y-4 pt-2 border-t">
              <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block pt-2">3. Información general</Label>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold text-muted-foreground">
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
                        ? "No hay contratos activos. Crea uno en el módulo de contratos antes de solicitar."
                        : "No tienes un contrato asignado. Contacta a tu administrador para que te vincule a una obra."}
                    </span>
                  </div>
                ) : (
                  <Select value={contractId} onValueChange={setContractId} disabled={isSubmitting}>
                    <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecciona el contrato…" /></SelectTrigger>
                    <SelectContent>
                      {selectableContracts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold text-muted-foreground">Detalle / Ubicación <span className="font-normal">(opcional)</span></Label>
                <Input
                  placeholder="Ej: Torre A, Obra Gruesa"
                  value={commonArea}
                  onChange={e => setCommonArea(e.target.value)}
                  className="h-11 rounded-xl"
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold text-muted-foreground">Justificación <span className="text-destructive">*</span></Label>
                <Textarea
                  placeholder="Ej: Stock agotado para fase 2"
                  className="resize-none h-20 rounded-xl"
                  value={commonJustification}
                  onChange={e => setCommonJustification(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <Button
                className="w-full h-12 rounded-xl text-sm font-black uppercase tracking-widest shadow-lg shadow-primary/10 gap-2"
                onClick={handleSubmitAll}
                disabled={isSubmitting || cart.length === 0 || !contractId || !commonJustification || (target === 'client' && !contractClient)}
              >
                {isSubmitting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
                  : <><Send className="h-4 w-4" /> {target === 'client' ? 'Enviar solicitud de suministro' : 'Enviar solicitud de compra'}</>}
              </Button>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: HISTORIAL */}
        <div className="xl:col-span-7 space-y-5">
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
                placeholder="Buscar código, material o contrato…"
                className="h-10 rounded-xl pl-10 text-xs bg-card"
              />
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <EmptyState
              icon={<Search size={24} />}
              title={search ? 'Sin resultados' : 'No se encontraron solicitudes'}
              description={search ? `No se encontró "${search}".` : 'Tus solicitudes de compra aparecerán aquí una vez enviadas.'}
            />
          ) : (
            <>
              <div className="space-y-4">
                {filteredHistory.slice(0, visible).map((group) => (
                  <PurchaseHistoryCard key={groupKey(group[0])} items={group} onSendToClient={openSendToClient} />
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

      {/* Diálogo: enviar solicitud de suministro al cliente (PDF + correo) */}
      <Dialog open={!!sendingItems} onOpenChange={(o) => { if (!o && !isSendingEmail) setSendingItems(null); }}>
        <DialogContent className="rounded-[1.5rem] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" /> {sendingItems?.[0]?.sentToClientAt ? 'Reenviar al cliente' : 'Enviar al cliente'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Se enviará la <b>Solicitud de Suministro {sendingItems?.[0]?.internalCode || ''}</b> ({sendingItems?.length || 0} ítem{(sendingItems?.length || 0) > 1 ? 's' : ''}) en PDF a <b>{sendingItems?.[0]?.clientName || 'el cliente'}</b>.
            </p>
            {sendingItems?.[0]?.sentToClientAt && (
              <p className="text-xs text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
                Ya se había enviado el {new Date(sendingItems[0].sentToClientAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} a <b>{sendingItems[0].sentToClientEmail}</b>. Puedes corregir el destinatario y reenviar.
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Destinatario(s) <span className="text-destructive">*</span></Label>
              <Input
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                placeholder="correo@cliente.cl (separa varios con coma)"
                className="h-11 rounded-xl"
                disabled={isSendingEmail}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Mensaje (opcional)</Label>
              <Textarea
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                placeholder="Estimados, adjuntamos solicitud de suministro para la faena…"
                className="resize-none h-20 rounded-xl"
                disabled={isSendingEmail}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" disabled={isSendingEmail} onClick={() => setSendingItems(null)}>Cancelar</Button>
            <Button className="rounded-xl gap-2" disabled={isSendingEmail || !sendTo.trim()} onClick={handleSendToClient}>
              {isSendingEmail ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : <><Send className="h-4 w-4" /> Enviar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
