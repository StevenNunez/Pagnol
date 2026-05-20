
"use client";

import React, { useState, useCallback, memo, useMemo } from "react";
import { useLots } from "@/hooks/use-lots";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Inbox, 
  PackageMinus, 
  FolderPlus, 
  CheckCircle, 
  Loader2, 
  ArrowRightCircle,
  AlertCircle,
  ChevronsUpDown,
  Check
} from "lucide-react";
import { useToast } from "@/modules/core/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CreateLotForm } from "@/components/operations/create-lot-form";
import type { PurchaseRequest } from "@/modules/core/lib/data";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";


// Definición local de Lot para props
interface Lot {
    lotId: string;
    category: string;
    requests: PurchaseRequest[];
    totalQuantity: number;
}

// --- Sub-Componentes Optimizados ---

const EmptyState = memo(({ message, description, icon: Icon }: { message: string; description: string, icon?: React.ElementType }) => (
  <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg bg-muted/10 h-full">
    {Icon ? <Icon className="h-12 w-12 mb-3 opacity-50" /> : <Inbox className="h-12 w-12 mb-3 opacity-50" />}
    <h3 className="text-lg font-medium text-foreground">{message}</h3>
    <p className="mt-1 text-sm max-w-xs mx-auto">{description}</p>
  </div>
));
EmptyState.displayName = "EmptyState";

const CreateLotCard = memo(() => (
  <Card className="shadow-sm border-l-4 border-l-primary/40">
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base">
        <FolderPlus className="h-5 w-5 text-primary" /> Nuevo Lote
      </CardTitle>
      <CardDescription>Crea un contenedor para agrupar solicitudes.</CardDescription>
    </CardHeader>
    <CardContent>
      <CreateLotForm />
    </CardContent>
  </Card>
));
CreateLotCard.displayName = "CreateLotCard";

const AssignToLotCombobox = ({
  lots,
  onSelect,
  disabled
}: {
  lots: Lot[];
  onSelect: (lotId: string) => void;
  disabled: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const sortedLots = useMemo(() => [...lots].sort((a,b) => a.category.localeCompare(b.category)), [lots]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-8 text-xs bg-muted/50 border-dashed"
          disabled={disabled}
        >
          <span className="truncate">
            {value ? sortedLots.find(lot => lot.lotId === value)?.category : "Asignar a Lote..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Buscar lote..." />
          <CommandList>
            <CommandEmpty>No se encontraron lotes.</CommandEmpty>
            <CommandGroup>
              {sortedLots.map((lot) => (
                <CommandItem
                  key={lot.lotId}
                  value={lot.category}
                  onSelect={() => {
                    setValue(lot.lotId);
                    setOpen(false);
                    onSelect(lot.lotId);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === lot.lotId ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {lot.category}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const ApprovedRequestsCard = memo(
  ({
    approvedRequests,
    batchedLots,
    handleAddBack,
    isLoadingId
  }: {
    approvedRequests: PurchaseRequest[];
    batchedLots: Lot[];
    handleAddBack: (requestId: string, lotId: string) => Promise<void>;
    isLoadingId: string | null;
  }) => (
    <Card className="flex flex-col h-full shadow-sm">
      <CardHeader className="pb-3 bg-muted/20">
        <div className="flex justify-between items-center">
            <div>
                <CardTitle className="text-base flex items-center gap-2">
                    <Inbox className="h-4 w-4" /> Pendientes de Agrupar
                </CardTitle>
                <CardDescription>
                Solicitudes aprobadas sin lote asignado.
                </CardDescription>
            </div>
            <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-full">
                {approvedRequests.length}
            </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {approvedRequests.length > 0 ? (
          <ScrollArea className="h-[400px] lg:h-[calc(100vh-24rem)]">
            <div className="p-4 space-y-3">
              {approvedRequests.map((req: PurchaseRequest) => (
                <div
                  key={req.id}
                  className="p-3 border rounded-lg bg-card hover:shadow-md transition-shadow duration-200 group"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                        <p className="font-semibold text-sm text-foreground">
                        {req.materialName}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {req.quantity} {req.unit} • {req.area}
                        </p>
                    </div>
                    {isLoadingId === req.id && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                  </div>
                  
                  <div className="mt-2">
                     <AssignToLotCombobox 
                        lots={batchedLots}
                        onSelect={(lotId) => handleAddBack(req.id, lotId)}
                        disabled={batchedLots.length === 0 || isLoadingId === req.id}
                     />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="p-6 h-full">
              <EmptyState
                message="Todo limpio"
                description="No hay solicitudes pendientes por agrupar."
                icon={CheckCircle}
              />
          </div>
        )}
      </CardContent>
    </Card>
  )
);
ApprovedRequestsCard.displayName = "ApprovedRequestsCard";

const ActiveLotsCard = memo(
  ({
    batchedLots,
    handleRemove,
    handleArchiveRequest,
    isLoadingId
  }: {
    batchedLots: Lot[];
    handleRemove: (requestId: string) => Promise<void>;
    handleArchiveRequest: (requestId: string) => Promise<void>;
    isLoadingId: string | null;
  }) => (
    <Card className="h-full shadow-sm border-none bg-transparent">
      <div className="mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
            <ArrowRightCircle className="h-5 w-5 text-primary" /> Lotes Activos
        </h2>
        <p className="text-sm text-muted-foreground">
            Estos lotes están listos para convertirse en órdenes de compra.
        </p>
      </div>

      <div className="space-y-4">
          {batchedLots.length > 0 ? (
            batchedLots.map((lot) => (
              <Card key={lot.lotId} className="overflow-hidden border border-muted-foreground/20">
                 <CardHeader className="py-3 px-4 bg-muted/30 border-b flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-base capitalize text-foreground">{lot.category}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                            ID: {lot.lotId.substring(0, 8)}...
                        </CardDescription>
                    </div>
                    <div className="text-right">
                         <span className="text-sm font-medium">{lot.requests.length} ítems</span>
                         <p className="text-xs text-muted-foreground">Total: {new Intl.NumberFormat('es-CL').format(lot.totalQuantity)} un.</p>
                    </div>
                 </CardHeader>
                 <CardContent className="p-0">
                    {lot.requests.length > 0 ? (
                      <div className="divide-y">
                        {lot.requests.map((req: PurchaseRequest) => (
                          <div
                            key={req.id}
                            className="flex items-center justify-between p-3 hover:bg-muted/5 transition-colors text-sm"
                          >
                            <div className="grid gap-0.5">
                              <p className="font-medium text-foreground">
                                {req.materialName} <span className="text-muted-foreground font-normal">({req.quantity} {req.unit})</span>
                              </p>
                              <p className="text-xs text-muted-foreground">Solicitado por: {req.requesterName || 'Usuario'} • {req.area}</p>
                            </div>
                            <div className="flex items-center gap-1">
                                {isLoadingId === req.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-2" />
                                ) : (
                                    <>
                                        <Button 
                                            size="icon" 
                                            variant="ghost" 
                                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50" 
                                            onClick={() => handleArchiveRequest(req.id)}
                                            title="Finalizar/Archivar esta solicitud individualmente"
                                        >
                                            <CheckCircle className="h-4 w-4" />
                                        </Button>
                                        <Button 
                                            size="icon" 
                                            variant="ghost" 
                                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" 
                                            onClick={() => handleRemove(req.id)} 
                                            title="Sacar del lote (volver a pendientes)"
                                        >
                                            <PackageMinus className="h-4 w-4" />
                                        </Button>
                                    </>
                                )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-6 text-center text-sm text-muted-foreground bg-muted/10 italic">
                        Lote vacío. Elimínalo o agrégale solicitudes.
                      </div>
                    )}
                 </CardContent>
              </Card>
            ))
          ) : (
            <Card>
                <CardContent className="pt-6">
                    <EmptyState
                        message="No hay lotes activos"
                        description="Usa el formulario de la izquierda para crear uno nuevo."
                        icon={AlertCircle}
                    />
                </CardContent>
            </Card>
          )}
      </div>
    </Card>
  )
);
ActiveLotsCard.displayName = "ActiveLotsCard";

// --- Componente Principal ---

export default function LotsPage() {
  const { approvedRequests, batchedLots } = useLots();
  const { removeRequestFromLot, addRequestToLot, updatePurchaseRequestStatus } = useAppState();
  const { toast } = useToast();
  const [isLoadingAction, setIsLoadingAction] = useState<string | null>(null);

  const handleRemove = useCallback(
    async (requestId: string) => {
      if (!requestId) return;
      setIsLoadingAction(requestId);
      try {
        await removeRequestFromLot(requestId);
        toast({ title: "Solicitud removida", description: "La solicitud ha vuelto a la lista de pendientes." });
      } catch (e: any) {
        toast({
          variant: "destructive",
          title: "Error",
          description: e?.message || "No se pudo mover la solicitud",
        });
      } finally {
        setIsLoadingAction(null);
      }
    },
    [removeRequestFromLot, toast]
  );

  const handleAddBack = useCallback(
    async (requestId: string, lotId: string) => {
      if (!requestId || !lotId) return;
      setIsLoadingAction(requestId);
      try {
        await addRequestToLot(requestId, lotId);
        toast({ title: "Solicitud asignada", description: "Se ha agregado al lote correctamente." });
      } catch (e: any) {
        toast({
          variant: "destructive",
          title: "Error",
          description: e?.message || "No se pudo asignar la solicitud",
        });
      } finally {
        setIsLoadingAction(null);
      }
    },
    [addRequestToLot, toast]
  );
  
  const handleArchiveRequest = useCallback(async (requestId: string) => {
      setIsLoadingAction(requestId);
      try {
        await updatePurchaseRequestStatus(requestId, "ordered", { notes: "Archivada manualmente desde gestión de lotes." });
        toast({ title: 'Solicitud Archivada', description: 'Marcada como procesada exitosamente.' });
      } catch (error: any) {
        toast({ variant: "destructive", title: "Error", description: error.message });
      } finally {
        setIsLoadingAction(null);
      }
  }, [updatePurchaseRequestStatus, toast]);

  return (
    <div className="flex flex-col gap-8 pb-10 fade-in">
      <PageHeader
        title="Gestión de Lotes de Compra"
        description="Organiza las solicitudes aprobadas en grupos lógicos para optimizar las órdenes de compra."
      />
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Columna Izquierda: Herramientas y Pendientes (1/3 del ancho en escritorio) */}
        <div className="lg:col-span-4 space-y-6 flex flex-col h-full">
          <CreateLotCard />
          <div className="flex-grow">
            <ApprovedRequestsCard
                approvedRequests={approvedRequests}
                batchedLots={batchedLots}
                handleAddBack={handleAddBack}
                isLoadingId={isLoadingAction}
            />
          </div>
        </div>

        {/* Columna Derecha: Lotes Activos (2/3 del ancho en escritorio) */}
        <div className="lg:col-span-8">
          <ActiveLotsCard
            batchedLots={batchedLots}
            handleRemove={handleRemove}
            handleArchiveRequest={handleArchiveRequest}
            isLoadingId={isLoadingAction}
          />
        </div>
      </div>
    </div>
  );
}
