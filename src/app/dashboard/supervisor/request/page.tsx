
"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  Send,
  Loader2,
  ChevronsUpDown,
  Check,
  Clock,
  Package,
  X,
  Plus,
  Trash2,
  AlertCircle,
  ShoppingCart,
  Search
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Material, MaterialRequest, Contract, ContractWorker, User } from "@/modules/core/lib/data";

type DeliveryMode = 'self' | 'directed' | 'open';

interface CartItem {
  materialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  stock: number;
  category: string;
}

// Extend the MaterialRequest type to include old format for compatibility
type CompatibleMaterialRequest = MaterialRequest & {
  materialId?: string;
  quantity?: number;
  items?: { materialId: string; quantity: number }[];
};

export default function SupervisorRequestPage() {
  const { materials, addMaterialRequest, requests, contracts, contractWorkers, materialStocks, users, can } = useAppState();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  // State for the new multi-item request form
  const [cart, setCart] = useState<CartItem[]>([]);
  const [contractId, setContractId] = useState("");
  const [area, setArea] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ¿Quién retira? 'self' = yo mismo | 'directed' = un trabajador específico | 'open' = retiro abierto
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('self');
  const [beneficiaryId, setBeneficiaryId] = useState<string | null>(null);
  const [beneficiaryPopoverOpen, setBeneficiaryPopoverOpen] = useState(false);

  // State for the temporary item being added
  const [currentMaterialId, setCurrentMaterialId] = useState<string | null>(null);
  const [currentQuantity, setCurrentQuantity] = useState<number | string>("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [page, setPage] = useState(1);
  const itemsPerPage = 5;

  // --- Memos & Helpers ---

  const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);

  // Trabajadores elegibles como destinatario de la solicitud (todos menos el propio solicitante).
  const beneficiaryOptions = useMemo(
    () => ((users || []) as User[])
      .filter((u) => u.id !== authUser?.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users, authUser?.id]
  );
  const selectedBeneficiary = useMemo(
    () => (beneficiaryId ? beneficiaryOptions.find((u) => u.id === beneficiaryId) || null : null),
    [beneficiaryId, beneficiaryOptions]
  );

  // Solo contratos activos para asociar la solicitud a una obra/contrato específico.
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

  // Oficina/altos mandos eligen cualquier contrato; personal de terreno solo el suyo asignado.
  const canSelectAnyContract = can("material_requests:select_any_contract");

  // Contratos (activos) a los que el usuario está asignado vía contract_workers.
  const myAssignedContracts = useMemo(() => {
    if (!authUser) return [] as Contract[];
    const myContractIds = new Set(
      ((contractWorkers || []) as ContractWorker[])
        .filter((cw) => cw.userId === authUser.id)
        .map((cw) => cw.contractId)
    );
    return activeContracts.filter((c) => myContractIds.has(c.id));
  }, [contractWorkers, authUser, activeContracts]);

  // Lista efectiva que puede elegir el usuario actual.
  const selectableContracts = canSelectAnyContract ? activeContracts : myAssignedContracts;

  // Personal de terreno con un único contrato → autocarga, sin selector.
  const isFieldWorkerSingleContract = !canSelectAnyContract && myAssignedContracts.length === 1;

  // Autoselecciona el contrato cuando el trabajador de terreno tiene solo uno.
  useEffect(() => {
    if (isFieldWorkerSingleContract && !contractId) {
      setContractId(myAssignedContracts[0].id);
    }
  }, [isFieldWorkerSingleContract, myAssignedContracts, contractId]);

  // Existencias del contrato seleccionado (y del pool central) por material,
  // para mostrar de dónde saldría el stock al solicitar.
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

  // Group materials by category for better UX in the Command component
  const groupedMaterials = useMemo(() => {
    const groups: Record<string, Material[]> = {};
    (materials || []).forEach((m) => {
      if (m.archived) return;
      const cat = m.category || "Otros";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    });
    // Sort items within groups
    Object.keys(groups).forEach(key => {
        groups[key].sort((a, b) => a.name.localeCompare(b.name));
    });
    return groups;
  }, [materials]);

  const myRequests = useMemo(() => 
    ((requests || []) as CompatibleMaterialRequest[])
      .filter((r) => r.supervisorId === authUser?.id)
      .sort((a, b) => {
         const dateA = new Date(a.createdAt || 0).getTime();
         const dateB = new Date(b.createdAt || 0).getTime();
         return dateB - dateA;
      }), 
  [requests, authUser]);

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return myRequests;
    return myRequests.filter((r) => r.status === statusFilter);
  }, [myRequests, statusFilter]);

  const paginatedRequests = filteredRequests.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage
  );
  const totalPages = Math.ceil(filteredRequests.length / itemsPerPage);

  const formatDate = (date: Date | string | null | undefined): string => {
    if (!date) return "N/A";
    const jsDate = new Date(date as any);
    return jsDate.toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200"><Clock className="mr-1 h-3 w-3" /> Pendiente</Badge>;
      case "approved":
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100"><Check className="mr-1 h-3 w-3" /> Aprobado</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100"><X className="mr-1 h-3 w-3" /> Rechazado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // --- Handlers ---

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

    // Check if exists to update or add
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

    // Reset fields
    setCurrentMaterialId(null);
    setCurrentQuantity("");
    setPopoverOpen(false);
  }, [currentMaterialId, currentQuantity, materialMap, toast]);

  const handleRemoveItemFromCart = (materialId: string) => {
    setCart(cart.filter(item => item.materialId !== materialId));
  };

  const handleUpdateCartQuantity = (materialId: string, newQty: string) => {
      const qty = Number(newQty);
      if (isNaN(qty) || qty < 0) return;
      
      setCart(prev => prev.map(item => {
          if (item.materialId === materialId) {
              // Validar stock inline
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
      toast({ title: "Solicitud Enviada", description: "El administrador revisará tu pedido." });
      setCart([]);
      setContractId("");
      setArea("");
      setDeliveryMode('self');
      setBeneficiaryId(null);
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "No se pudo procesar la solicitud." });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper para el material seleccionado actual
  const currentSelectedMaterial = currentMaterialId ? materialMap.get(currentMaterialId) : null;
  const hasMaterials = Object.keys(groupedMaterials).length > 0;

  return (
    <div className="flex flex-col gap-8 pb-10 fade-in">
      <PageHeader
        title="Solicitud de Materiales"
        description="Genera pedidos de material a la bodega central para tus obras."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* COLUMNA IZQUIERDA: FORMULARIO (5/12) */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-l-4 border-l-primary shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShoppingCart className="h-5 w-5 text-primary" /> Nueva Solicitud
              </CardTitle>
              <CardDescription>Agrega los ítems que necesitas.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRequestSubmit} className="space-y-6">
                
                {/* Selector de Materiales */}
                <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">1. Seleccionar Material</Label>
                    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between h-10" disabled={isSubmitting}>
                          <span className="truncate">
                            {currentSelectedMaterial ? currentSelectedMaterial.name : "Buscar material..."}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[320px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar por nombre..." />
                          <CommandList>
                            <CommandEmpty>
                              {!hasMaterials
                                ? "Sin materiales en bodega. Contacta al administrador."
                                : "Material no encontrado."}
                            </CommandEmpty>
                            {Object.entries(groupedMaterials).map(([category, items]) => (
                                <CommandGroup key={category} heading={category}>
                                    {items.map(m => (
                                        <CommandItem
                                            key={m.id}
                                            value={m.name}
                                            disabled={m.stock <= 0}
                                            onSelect={() => {
                                                setCurrentMaterialId(m.id);
                                                setPopoverOpen(false);
                                                // Auto-focus quantity logic could go here
                                            }}
                                        >
                                            <div className="flex justify-between w-full items-center">
                                                <span className={cn(m.stock <= 0 && "text-muted-foreground line-through")}>{m.name}</span>
                                                <div className="flex items-center gap-2">
                                                    {contractId && (() => {
                                                        const avail = contractAvailability.get(m.id);
                                                        const inContract = avail?.contract || 0;
                                                        const inPool = avail?.pool || 0;
                                                        return (
                                                            <Badge variant="outline" className={cn("text-[9px] font-bold", inContract > 0 ? "text-primary border-primary/30" : "text-muted-foreground")}>
                                                                {inContract} contrato{inPool > 0 ? ` · ${inPool} pool` : ''}
                                                            </Badge>
                                                        );
                                                    })()}
                                                    <span className={cn("text-xs", m.stock < 10 ? "text-red-500 font-bold" : "text-muted-foreground")}>
                                                        {m.stock} {m.unit}
                                                    </span>
                                                    {currentMaterialId === m.id && <Check className="h-4 w-4 text-primary" />}
                                                </div>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="flex gap-3 items-end">
                    <div className="space-y-2 flex-grow">
                      <Label htmlFor="quantity" className="text-xs font-semibold uppercase text-muted-foreground">2. Cantidad</Label>
                      <div className="relative">
                        <Input 
                            id="quantity" 
                            type="number" 
                            placeholder="0" 
                            value={currentQuantity} 
                            onChange={e => setCurrentQuantity(e.target.value)} 
                            disabled={!currentMaterialId || isSubmitting}
                            className="pr-10"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddItemToCart();
                                }
                            }}
                        />
                        <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">
                            {currentSelectedMaterial?.unit || 'ud'}
                        </span>
                      </div>
                    </div>
                    <Button 
                        type="button" 
                        onClick={handleAddItemToCart}
                        disabled={!currentMaterialId || !currentQuantity || isSubmitting}
                        className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    >
                        <Plus className="h-4 w-4 mr-1" /> Agregar
                    </Button>
                  </div>
                  
                  {/* Stock Helper Text */}
                  {currentSelectedMaterial && (
                      <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Disponible:</span>
                          <span className={cn("font-medium", currentSelectedMaterial.stock < 10 ? "text-red-600" : "text-emerald-600")}>
                              {currentSelectedMaterial.stock} {currentSelectedMaterial.unit}
                          </span>
                          {Number(currentQuantity) > currentSelectedMaterial.stock && (
                              <span className="text-red-500 font-bold ml-auto flex items-center gap-1">
                                  <AlertCircle className="h-3 w-3" /> Excede stock
                              </span>
                          )}
                      </div>
                  )}
                </div>

                {/* Lista del Carrito */}
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <Label>Resumen del Pedido</Label>
                        <span className="text-xs text-muted-foreground">{cart.length} ítems</span>
                    </div>
                    
                    <ScrollArea className="h-[200px] w-full rounded-md border bg-card p-1">
                        {cart.length > 0 ? (
                            <div className="space-y-1">
                                {cart.map(item => (
                                    <div key={item.materialId} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 group transition-colors border border-transparent hover:border-muted">
                                        <div className="flex-1 min-w-0 mr-3">
                                            <p className="text-sm font-medium truncate">{item.materialName}</p>
                                            <p className="text-[10px] text-muted-foreground truncate">{item.category}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Input 
                                                type="number" 
                                                value={item.quantity} 
                                                onChange={(e) => handleUpdateCartQuantity(item.materialId, e.target.value)}
                                                className="h-7 w-16 text-right text-xs px-1"
                                            />
                                            <span className="text-xs text-muted-foreground w-6">{item.unit}</span>
                                            <Button 
                                                type="button" 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-7 w-7 text-muted-foreground hover:text-destructive" 
                                                onClick={() => handleRemoveItemFromCart(item.materialId)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5"/>
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-2 opacity-50">
                                <Package className="h-8 w-8" />
                                <p className="text-xs">Tu lista está vacía</p>
                            </div>
                        )}
                    </ScrollArea>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="contract">Contrato / Obra <span className="text-destructive">*</span></Label>
                    {isFieldWorkerSingleContract ? (
                      // Personal de terreno: su contrato viene fijado, no se elige.
                      <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/40 text-sm">
                        <Package className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium truncate">
                          {myAssignedContracts[0].name}
                          {myAssignedContracts[0].code ? ` (${myAssignedContracts[0].code})` : ""}
                        </span>
                        <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">Tu contrato</Badge>
                      </div>
                    ) : selectableContracts.length === 0 ? (
                      // Sin contratos disponibles: no puede continuar.
                      <div className="flex items-start gap-2 p-3 rounded-md border border-warning/30 bg-warning-subtle text-warning-subtle-foreground text-xs">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          {canSelectAnyContract
                            ? "No hay contratos activos. Crea uno en el módulo de contratos antes de solicitar materiales."
                            : "No tienes un contrato asignado. Contacta a tu administrador para que te vincule a una obra antes de solicitar materiales."}
                        </span>
                      </div>
                    ) : (
                      <Select value={contractId} onValueChange={setContractId} disabled={isSubmitting}>
                        <SelectTrigger id="contract">
                          <SelectValue placeholder="Selecciona el contrato..." />
                        </SelectTrigger>
                        <SelectContent>
                          {selectableContracts.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}{c.code ? ` (${c.code})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {canSelectAnyContract && (
                      <p className="text-[10px] text-muted-foreground">
                        Como perfil administrativo puedes solicitar para cualquier contrato activo.
                      </p>
                    )}
                  </div>
                  {/* ¿Quién retira? — separa solicitante de receptor (caso APR → EPPs) */}
                  <div className="space-y-2">
                    <Label>¿Quién retira? <span className="text-destructive">*</span></Label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: 'self', label: 'Yo mismo' },
                        { value: 'directed', label: 'Otro trabajador' },
                        { value: 'open', label: 'Retiro abierto' },
                      ] as { value: DeliveryMode; label: string }[]).map((opt) => (
                        <Button
                          key={opt.value}
                          type="button"
                          variant={deliveryMode === opt.value ? 'default' : 'outline'}
                          size="sm"
                          className="text-xs"
                          disabled={isSubmitting}
                          onClick={() => {
                            setDeliveryMode(opt.value);
                            if (opt.value !== 'directed') setBeneficiaryId(null);
                          }}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                    {deliveryMode === 'directed' && (
                      <Popover open={beneficiaryPopoverOpen} onOpenChange={setBeneficiaryPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="w-full justify-between h-10" disabled={isSubmitting}>
                            <span className="truncate">
                              {selectedBeneficiary ? selectedBeneficiary.name : "Selecciona al trabajador que retira..."}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Buscar trabajador..." />
                            <CommandList>
                              <CommandEmpty>No se encontró el trabajador.</CommandEmpty>
                              <CommandGroup>
                                {beneficiaryOptions.map((u) => (
                                  <CommandItem
                                    key={u.id}
                                    value={u.name}
                                    onSelect={() => {
                                      setBeneficiaryId(u.id);
                                      setBeneficiaryPopoverOpen(false);
                                    }}
                                  >
                                    <Check className={cn("mr-2 h-4 w-4", beneficiaryId === u.id ? "opacity-100" : "opacity-0")} />
                                    {u.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {deliveryMode === 'self' && "Retirarás el pedido tú mismo en el pañol (verificación biométrica)."}
                      {deliveryMode === 'directed' && "El pedido quedará dirigido: solo ese trabajador podrá retirarlo, verificado por biometría."}
                      {deliveryMode === 'open' && "Cualquier trabajador podrá retirarlo; quien retire quedará registrado al momento de la entrega."}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="area">Detalle / Ubicación <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                    <Input
                      id="area"
                      placeholder="Ej: Torre A, Piso 3"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                  <Button type="submit" className="w-full h-11 text-base shadow-md" disabled={isSubmitting || cart.length === 0 || !contractId}>
                    {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando...</> : <><Send className="mr-2 h-4 w-4" /> Enviar Solicitud</>}
                  </Button>
                </div>

              </form>
            </CardContent>
          </Card>
        </div>

        {/* COLUMNA DERECHA: HISTORIAL (7/12) */}
        <div className="lg:col-span-7">
          <Card className="h-full border-none shadow-none bg-transparent">
            <CardHeader className="px-0 pt-0">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle>Historial</CardTitle>
                    <CardDescription>Tus solicitudes recientes.</CardDescription>
                  </div>
                  <Select 
                    value={statusFilter} 
                    onValueChange={(v) => { setStatusFilter(v as any); setPage(1); }}
                  >
                    <SelectTrigger className="w-[160px] bg-background">
                      <SelectValue placeholder="Filtrar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="pending">Pendientes</SelectItem>
                      <SelectItem value="approved">Aprobadas</SelectItem>
                      <SelectItem value="rejected">Rechazadas</SelectItem>
                    </SelectContent>
                  </Select>
              </div>
            </CardHeader>
            <CardContent className="px-0">
                <div className="space-y-4">
                    {paginatedRequests.length > 0 ? (
                        paginatedRequests.map((req) => (
                            <Card key={req.id} className="overflow-hidden border-l-4 border-l-transparent hover:border-l-primary/50 transition-all">
                                <div className="p-4 flex flex-col sm:flex-row gap-4">
                                    {/* Info Principal */}
                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-center gap-2">
                                            {getStatusBadge(req.status)}
                                            <span className="text-xs text-muted-foreground flex items-center">
                                                <Clock className="h-3 w-3 mr-1" /> {formatDate(req.createdAt)}
                                            </span>
                                        </div>
                                        <div className="text-sm space-y-0.5">
                                            <div>
                                                <span className="font-semibold text-muted-foreground">Contrato:</span> {req.contractName || contractMap.get(req.contractId || "")?.name || "—"}
                                            </div>
                                            {req.deliveryMode === 'directed' && req.beneficiaryName && (
                                                <div className="text-xs text-muted-foreground">
                                                    <span className="font-semibold">Retira:</span> {req.beneficiaryName}
                                                </div>
                                            )}
                                            {req.deliveryMode === 'open' && (
                                                <div className="text-xs text-muted-foreground">
                                                    <span className="font-semibold">Retiro:</span> Abierto (cualquier trabajador)
                                                </div>
                                            )}
                                            {req.area && (
                                                <div className="text-xs text-muted-foreground">
                                                    <span className="font-semibold">Detalle:</span> {req.area}
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Lista de Ítems */}
                                        <div className="mt-3 bg-muted/30 rounded-md p-2 text-sm space-y-1">
                                            {req.items && req.items.length > 0 ? (
                                                req.items.map((item, idx) => {
                                                    const mat = materialMap.get(item.materialId);
                                                    return (
                                                        <div key={idx} className="flex justify-between items-center border-b border-muted/50 last:border-0 pb-1 last:pb-0">
                                                            <span>{mat?.name || "Material desconocido"}</span>
                                                            <span className="font-mono font-medium text-xs">{item.quantity} {mat?.unit || 'u'}</span>
                                                        </div>
                                                    )
                                                })
                                            ) : (
                                                <div className="flex justify-between items-center">
                                                    <span>{materialMap.get(req.materialId || '')?.name}</span>
                                                    <span className="font-mono font-medium">{req.quantity}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        ))
                    ) : (
                        <div className="text-center py-12 bg-muted/20 rounded-lg border-2 border-dashed">
                            <Search className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                            <p className="text-muted-foreground">No se encontraron solicitudes.</p>
                        </div>
                    )}

                    {/* Paginación */}
                    {totalPages > 1 && (
                        <div className="flex justify-center gap-2 mt-4">
                            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Anterior</Button>
                            <span className="text-sm flex items-center px-2 text-muted-foreground">Página {page} de {totalPages}</span>
                            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Siguiente</Button>
                        </div>
                    )}
                </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
