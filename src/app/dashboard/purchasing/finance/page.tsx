"use client";

import * as React from "react";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  Upload,
  FileText,
  ArrowRight,
  X,
  Check,
  RefreshCcw,
  FileCheck,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { PurchaseLot, PurchaseRequest } from "@/modules/core/lib/data";


// --- Tipos internos ---
type ProcessingItem = {
  requestId: string;
  price: number;
  confirmed: boolean; // ¿Viene en la cotización?
  quantity: number;
};

export default function FinanceQuoteProcessor() {
  const { purchaseLots, purchaseRequests, users, createPurchaseOrder, returnToPool } = useAppState();
  const { user, can } = useAuth();
  const { toast } = useToast();

  const [selectedLot, setSelectedLot] = React.useState<PurchaseLot | null>(null);
  const [fileUrl, setFileUrl] = React.useState<string | null>(null);
  const [ocNumber, setOcNumber] = React.useState("");
  const [itemsState, setItemsState] = React.useState<Record<string, ProcessingItem>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Lotes abiertos = esperando que Finanzas los procese la cotización del proveedor
  const pendingLots = React.useMemo(() => {
    return (purchaseLots || []).filter(l => l.status === "open");
  }, [purchaseLots]);

  // Cuando selecciona un lote
  const handleSelectLot = (lot: PurchaseLot) => {
    setSelectedLot(lot);
    setFileUrl(null); // Reset archivo
    setOcNumber("");
    
    // Preparar estado inicial de items
    const requestsInLot = (purchaseRequests || []).filter(r => r.lotId === lot.id);
    const initialItems: Record<string, ProcessingItem> = {};
    
    requestsInLot.forEach(req => {
      initialItems[req.id] = {
        requestId: req.id,
        price: 0, // Inicia en 0 para obligar a verificar
        confirmed: true,
        quantity: req.quantity
      };
    });
    setItemsState(initialItems);
  };

  // Subir PDF
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.includes("pdf") && !file.type.includes("image")) {
      toast({ variant: "destructive", title: "Formato no válido", description: "Solo PDF o imágenes" });
      return;
    }

    const url = URL.createObjectURL(file);
    setFileUrl(url);
    toast({ title: "Documento cargado", description: "Ahora valida los precios y confirma los items." });
  };

  // Toggle item
  const toggleItem = (id: string) => {
    setItemsState((prev) => ({
      ...prev,
      [id]: { ...prev[id], confirmed: !prev[id].confirmed },
    }));
  };

  // Actualizar precio o cantidad
  const updateItem = (id: string, field: 'price' | 'quantity', value: string) => {
    const num = parseFloat(value) || 0;
    setItemsState(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: num }
    }));
  };

  // Calcular total
  const calculateTotal = () => {
    let total = 0;
    Object.values(itemsState).forEach(item => {
      if (item.confirmed) {
        total += item.price * item.quantity;
      }
    });
    return total;
  };

  // GENERAR ORDEN DE COMPRA REAL
  const handleGenerateOrder = async () => {
    if (!selectedLot || !ocNumber.trim()) {
      toast({ variant: "destructive", title: "Faltan datos", description: "Debes ingresar el número de OC." });
      return;
    }

    const confirmedItems = Object.values(itemsState).filter(i => i.confirmed && i.quantity > 0).map(item => {
        const request = purchaseRequests.find(r => r.id === item.requestId);
        return {
            ...item,
            name: request?.materialName || 'Desconocido',
            unit: request?.unit || 'und',
        }
    });
    
    if (confirmedItems.length === 0) {
      toast({ variant: "destructive", title: "Sin items", description: "Confirma al menos un material con cantidad mayor a cero." });
      return;
    }

    setIsSubmitting(true);

    try {
      const rejectedItems = Object.values(itemsState).filter(i => !i.confirmed || i.quantity <= 0);

      // A. Crear la Orden (Items que SÍ llegan) -> Van a Recepción
      await createPurchaseOrder({
        lotId: selectedLot.id,
        ocNumber: ocNumber.trim(),
        items: confirmedItems,
        totalAmount: calculateTotal(),
      });

      // B. Devolver al Pool (Items que NO llegan) -> Vuelven al Admin
      if (rejectedItems.length > 0) {
        await returnToPool(rejectedItems.map(i => i.requestId));
      }

      toast({
        title: "✅ Orden de Compra Generada",
        description: `Se procesaron ${confirmedItems.length} items. ${rejectedItems.length} devueltos a pendientes. El PDF no se descargará.`,
        duration: 10000,
      });
      setSelectedLot(null);

    } catch (error: any) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Error crítico",
        description: error.message || "No se pudo generar la orden.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Permiso
  if (!can("finance:manage_purchase_orders")) {
    return (
      <div className="p-12 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <h2 className="mt-4 text-xl font-semibold">Acceso Denegado</h2>
        <p className="mt-2 text-muted-foreground">No tienes permisos para acceder a esta sección.</p>
      </div>
    );
  }

  // VISTA 1: Bandeja de entrada
  if (!selectedLot) {
    return (
      <>
        <PageHeader
          title="Finanzas – Procesar Cotizaciones"
          description="Valida la cotización del proveedor y genera la Orden de Compra real"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
          {pendingLots.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="py-20 text-center">
                <Check className="h-16 w-16 mx-auto mb-4 text-green-500 opacity-50" />
                <p className="text-xl">¡Todo al día!</p>
                <p className="text-muted-foreground">No hay cotizaciones pendientes de procesar.</p>
              </CardContent>
            </Card>
          ) : (
            pendingLots.map((lot) => {
              const count = (purchaseRequests || []).filter((r) => r.lotId === lot.id).length;
              const creator = users?.find((u) => u.id === lot.creatorId)?.name || "Admin Obra";

              return (
                <Card
                  key={lot.id}
                  className="cursor-pointer hover:shadow-lg transition-all hover:border-primary"
                  onClick={() => handleSelectLot(lot)}
                >
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">{lot.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          {lot.createdAt ? format(new Date(lot.createdAt as any), "dd MMM yyyy", { locale: es }) : ''}
                        </p>
                      </div>
                      <Badge>Nuevo</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span>Items:</span>
                      <span className="font-bold">{count}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Creado por:</span>
                      <span className="font-medium">{creator}</span>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button className="w-full mt-2">
                      Procesar Cotización <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })
          )}
        </div>
      </>
    );
  }

  // VISTA 2: Split View Procesador
  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header fijo */}
      <div className="h-16 border-b flex items-center justify-between px-6 bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setSelectedLot(null)}>
            <X className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">Procesando lote: {selectedLot.name}</h2>
            <p className="text-sm text-muted-foreground">Valida precios y confirma items</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total Orden de Compra</p>
            <p className="text-3xl font-bold text-green-600">
              ${calculateTotal().toLocaleString("es-CL")}
            </p>
          </div>
          <Button
            size="lg"
            onClick={handleGenerateOrder}
            disabled={!ocNumber.trim() || isSubmitting}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generando...
              </>
            ) : (
              <>
                <FileCheck className="mr-2 h-5 w-5" /> Generar OC Real
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* IZQUIERDA: PDF */}
        <div className="w-1/2 border-r bg-muted/30 flex flex-col">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" /> Cotización del Proveedor
            </h3>
            <label htmlFor="quote-upload">
              <Input
                id="quote-upload"
                type="file"
                accept=".pdf,image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button asChild variant="outline" size="sm">
                <span>
                    <Upload className="h-4 w-4 mr-2" />
                    {fileUrl ? "Cambiar" : "Subir documento"}
                </span>
              </Button>
            </label>
          </div>
          <div className="flex-1 overflow-hidden bg-white m-4 rounded-lg shadow-inner">
            {fileUrl ? (
              <iframe src={fileUrl} className="w-full h-full" title="Cotización PDF" />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Upload className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg">Sube el PDF o foto de la cotización</p>
              </div>
            )}
          </div>
        </div>

        {/* DERECHA: Formulario */}
        <div className="w-1/2 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-6">
            <Card>
              <CardContent className="pt-6">
                <Label className="text-base">Número de Orden de Compra o Cotización</Label>
                <Input
                  placeholder="Ej: OC-2025-089 o COT-4451"
                  value={ocNumber}
                  onChange={(e) => setOcNumber(e.target.value)}
                  className="text-lg font-mono mt-2"
                />
              </CardContent>
            </Card>

            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Check className="h-5 w-5 text-green-600" /> Validación de Items
              </h3>
              <div className="p-3 mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>Ajusta las cantidades confirmadas y los precios unitarios según el documento del proveedor. Desmarca los ítems que no serán comprados.</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="w-28 text-right">Cant. Confirmada</TableHead>
                    <TableHead className="w-32 text-right">Precio Unitario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(purchaseRequests || [])
                    .filter((r) => r.lotId === selectedLot.id)
                    .map((req) => {
                      const state = itemsState[req.id];
                      if (!state) return null;

                      return (
                        <TableRow
                          key={req.id}
                          className={!state.confirmed ? "opacity-50" : ""}
                        >
                          <TableCell>
                            <Checkbox
                              checked={state.confirmed}
                              onCheckedChange={() => toggleItem(req.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className={state.confirmed ? "font-medium" : "line-through"}>
                                {req.materialName}
                              </p>
                              <span className="text-xs text-muted-foreground">
                                Solicitado: {req.quantity} {req.unit}
                              </span>
                              {!state.confirmed && (
                                <p className="text-xs text-red-600 flex items-center gap-1">
                                  <RefreshCcw className="h-3 w-3" /> Volverá a pendientes
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              placeholder="0"
                              value={state.quantity || ""}
                              onChange={(e) => updateItem(req.id, 'quantity', e.target.value)}
                              disabled={!state.confirmed}
                              className="text-right font-mono"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              placeholder="0"
                              value={state.price || ""}
                              onChange={(e) => updateItem(req.id, 'price', e.target.value)}
                              disabled={!state.confirmed}
                              className="text-right font-mono"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
