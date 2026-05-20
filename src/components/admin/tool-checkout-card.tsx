
'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRightLeft, User, ArrowRight, X, ScanLine, ChevronsUpDown, Check } from 'lucide-react';
import type { User as UserType, Tool as ToolType, ToolLog } from '@/modules/core/lib/data';
import { useToast } from '@/modules/core/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { cn } from '@/lib/utils';


type ScanPurpose = 'checkout-worker' | 'checkout-tool' | 'return-tool';

// --- Sanitizador robusto
const sanitizeQrCode = (code: string): string => {
  if (!code) return '';
  // elimina saltos de línea, espacios sobrantes y caracteres invisibles
  return code.replace(/\uFEFF/g, '').replace(/\r?\n|\r/g, '').trim();
};

export function ToolCheckoutCard() {
  const { users, tools, checkoutTool, returnTool, findActiveLogForTool, toolLogs } = useAppState();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  const [checkoutState, setCheckoutState] = useState<{ worker?: UserType; tools: ToolType[] }>({ tools: [] });
  const [returnMode, setReturnMode] = useState(false);
  const [manualWorkerId, setManualWorkerId] = useState('');
  const [workerPopoverOpen, setWorkerPopoverOpen] = useState(false);
  const [manualToolId, setManualToolId] = useState('');
  const [toolPopoverOpen, setToolPopoverOpen] = useState(false);
  const [pistolInput, setPistolInput] = useState('');
  const [isDamaged, setIsDamaged] = useState(false);
  const [returnNotes, setReturnNotes] = useState('');

  const checkoutStateRef = useRef(checkoutState);
  useEffect(() => {
    checkoutStateRef.current = checkoutState;
  }, [checkoutState]);

  const { workers, checkedOutTools, availableTools } = useMemo(() => {
    const activeWorkers = (users || []).filter((u: UserType) => u.role !== 'guardia').sort((a,b) => a.name.localeCompare(b.name));
    const checkedOutToolIds = new Set<string>(
      (toolLogs || []).filter((log: ToolLog) => log.returnDate === null).map((log: ToolLog) => log.toolId)
    );
    return {
      workers: activeWorkers,
      checkedOutTools: (tools || []).filter((tool: ToolType) => checkedOutToolIds.has(tool.id)).sort((a,b) => a.name.localeCompare(b.name)),
      availableTools: (tools || []).filter((tool: ToolType) => !checkedOutToolIds.has(tool.id)).sort((a,b) => a.name.localeCompare(b.name)),
    };
  }, [users, tools, toolLogs]);

  const handleCancel = useCallback(() => {
    setCheckoutState({ tools: [] });
    setManualWorkerId('');
    setManualToolId('');
    setIsDamaged(false);
    setReturnNotes('');
  }, []);

  const handleToolToCheckout = useCallback((tool: ToolType) => {
    // Check if the tool is already checked out in general
    if (!availableTools.some((t: ToolType) => t.id === tool.id)) {
        toast({ variant: 'destructive', title: 'Herramienta no Disponible', description: `"${tool.name}" ya está en uso.` });
        return;
    }
    // Check if the tool is already in the current checkout cart
    if (checkoutStateRef.current.tools.some((t: ToolType) => t.id === tool.id)) {
      toast({ variant: 'destructive', title: 'Error', description: `"${tool.name}" ya está en la lista de entrega.` });
      return;
    }
    setCheckoutState(prev => ({ ...prev, tools: [...prev.tools, tool] }));
  }, [toast, availableTools]);

  const handleReturn = useCallback(async (tool: ToolType) => {
    const isToolCheckedOut = checkedOutTools.some((t: ToolType) => t.id === tool.id);
    if (!isToolCheckedOut) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: `La herramienta "${tool.name}" no está registrada como prestada en el sistema.`,
      });
      return;
    }

    const activeLog = await findActiveLogForTool(tool.id);
    if (!activeLog) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: `No se encontró un registro activo para "${tool.name}". Verifica que la herramienta esté prestada.`,
      });
      return;
    }

    if (authUser) {
      try {
        await returnTool(activeLog.id, isDamaged ? 'damaged' : 'ok', returnNotes);
        toast({
          title: 'Devolución Registrada',
          description: `Herramienta "${tool.name}" devuelta exitosamente.`,
        });
        handleCancel();
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: `Error al registrar la devolución: ${(error as Error).message}`,
        });
      }
    }
  }, [isDamaged, returnNotes, authUser, returnTool, toast, handleCancel, findActiveLogForTool, checkedOutTools]);

  const findToolFromScanned = useCallback(
    (rawCode: string): ToolType | null => {
      if (!rawCode) return null;

      const code = sanitizeQrCode(rawCode);
      const up = (s?: string) => (s ? s.trim().toUpperCase() : '');

      const byQr = (tools || []).find((t: ToolType) => up(t.qrCode) === up(code));
      if (byQr) return byQr;

      const normalize = (s: string) => up(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, '-');
      const normalizedCode = normalize(code);

      const byNormalizedQr = (tools || []).find((t: ToolType) => normalize(t.qrCode) === normalizedCode);
      if(byNormalizedQr) return byNormalizedQr;

      const byId = (tools || []).find((t: ToolType) => up(t.id) === up(code));
      if (byId) return byId;

      const tokens = code.split(/[^a-zA-Z0-9_-]+/);
      for(const token of tokens) {
          const byTokenId = (tools || []).find((t: ToolType) => up(t.id) === up(token));
          if(byTokenId) return byTokenId;
      }

      return null;
    },
    [tools]
  );


  const findUserFromScanned = useCallback(
    (finalCode: string): UserType | null => {
      if (!finalCode) return null;
      const exact = (users || []).find((u: UserType) => u.qrCode === finalCode || u.id === finalCode);
      if (exact) return exact;

      const parts = finalCode.split("'");
      if (parts.length >= 2) {
        const candidateId = parts[1] || parts[0];
        const byId = (users || []).find((u: UserType) => u.id === candidateId || (u.qrCode && u.qrCode.includes(candidateId)));
        if (byId) return byId;
      }

      const tokens = finalCode.split(/[^A-Za-z0-9_-]+/).filter(Boolean);
      for (const tok of tokens) {
        const byId = (users || []).find((u: UserType) => u.id === tok);
        if (byId) return byId;
      }

      const up = finalCode.toUpperCase();
      const byName = (users || []).find((u: UserType) => u.name && u.name.toUpperCase().includes(up));
      if (byName) return byName;

      return null;
    },
    [users]
  );

  const processScan = useCallback(
    async (scannedCode: string) => {
      const finalCode = sanitizeQrCode(scannedCode);
      if (!finalCode) {
        toast({ variant: 'destructive', title: 'Error', description: 'Entrada vacía.' });
        return;
      }

      // Intenta identificar como herramienta primero
      const tool = findToolFromScanned(finalCode);
      if (tool) {
        if (returnMode) {
          await handleReturn(tool);
        } else {
          if (!checkoutStateRef.current.worker) {
            toast({ variant: 'destructive', title: 'Error', description: 'Escanea primero el QR de un trabajador.' });
          } else {
            handleToolToCheckout(tool);
            toast({ title: 'Herramienta añadida', description: `${tool.name} lista para entregar.` });
          }
        }
        return;
      }

      // Si no es una herramienta, intenta identificar como usuario
      const user = findUserFromScanned(finalCode);
      if (user) {
        if (returnMode) {
          toast({ variant: 'destructive', title: 'Modo Devolución', description: 'Escanea una herramienta, no un usuario.' });
        } else {
          setCheckoutState({ worker: user, tools: [] });
          toast({ title: 'Trabajador Seleccionado', description: `Listo para entregar a: ${user.name}.` });
        }
        return;
      }

      // Si no es ni herramienta ni usuario, es un error
      toast({ variant: 'destructive', title: 'Error', description: 'Código QR no reconocido. Verifica el formato del QR.' });
    },
    [toast, findToolFromScanned, findUserFromScanned, returnMode, handleReturn, handleToolToCheckout]
  );


  const handlePistolScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = pistolInput.trim();
    if (code) processScan(code);
    setPistolInput('');
  };

  const handleManualWorkerSelect = (workerId: string) => {
    const worker = (users || []).find((u: UserType) => u.id === workerId);
    if (worker) {
      setCheckoutState({ worker, tools: [] });
      setManualWorkerId(workerId);
      setWorkerPopoverOpen(false);
    }
  };

  const handleManualToolSelect = () => {
    const toolToAdd = (tools || []).find((t: ToolType) => t.id === manualToolId);
    if (toolToAdd) handleToolToCheckout(toolToAdd);
    setManualToolId('');
  };

  const handleManualReturn = async () => {
    const toolToReturn = (tools || []).find((t: ToolType) => t.id === manualToolId);
    if (toolToReturn) {
      await handleReturn(toolToReturn);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'Herramienta no encontrada.' });
    }
    setManualToolId('');
  };

  const handleConfirmCheckout = async () => {
    if (checkoutState.worker && checkoutState.tools.length > 0 && authUser) {
      try {
        const supervisorId = authUser.id;
        for (const tool of checkoutState.tools) {
          await checkoutTool(tool.id, checkoutState.worker.id, supervisorId);
        }
        toast({
          title: 'Entrega Registrada',
          description: `${checkoutState.tools.length} herramienta(s) entregada(s) a ${checkoutState.worker.name}.`,
        });
        handleCancel();
      } catch {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudo registrar la entrega.' });
      }
    }
  };

  const removeToolFromCart = (toolId: string) =>
    setCheckoutState(prev => ({ ...prev, tools: prev.tools.filter((t: ToolType) => t.id !== toolId) }));

  const openScanner = () => {
    toast({
        variant: 'destructive',
        title: 'Función Deshabilitada',
        description: 'El escaneo de QR está desactivado temporalmente por problemas de instalación.',
    });
  };

  return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft /> Entrega y Devolución Rápida
          </CardTitle>
          <CardDescription>
            Usa los paneles de abajo para registrar movimientos de herramientas de forma manual o con escáner.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Panel manual */}
          <div className="p-4 border rounded-lg space-y-4">
            <h3 className="font-semibold">Panel de Selección Manual</h3>
            {!returnMode ? (
              <>
                <div className="space-y-2">
                  <Label>1. Selecciona Trabajador</Label>
                  <Popover open={workerPopoverOpen} onOpenChange={setWorkerPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between">
                        <span className="truncate">
                          {manualWorkerId
                            ? workers.find((w: UserType) => w.id === manualWorkerId)?.name
                            : "Elige un trabajador..."}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                      <Command>
                        <CommandInput placeholder="Buscar trabajador..." />
                        <CommandList>
                          <CommandEmpty>No se encontró el trabajador.</CommandEmpty>
                          <CommandGroup>
                            {workers.map((w: UserType) => (
                              <CommandItem
                                key={w.id}
                                value={w.name}
                                onSelect={() => handleManualWorkerSelect(w.id)}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    manualWorkerId === w.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {w.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                    <Label>2. Agrega Herramienta</Label>
                    <div className="flex gap-2">
                        <Popover open={toolPopoverOpen} onOpenChange={setToolPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" role="combobox" className="w-full justify-between" disabled={!checkoutState.worker}>
                                    <span className="truncate">
                                    {manualToolId
                                        ? availableTools.find((t: ToolType) => t.id === manualToolId)?.name
                                        : "Elige una herramienta..."}
                                    </span>
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                <Command>
                                    <CommandInput placeholder="Buscar herramienta..." />
                                    <CommandList>
                                    <CommandEmpty>No hay herramientas disponibles.</CommandEmpty>
                                    <CommandGroup>
                                        {availableTools.map((t: ToolType) => (
                                        <CommandItem
                                            key={t.id}
                                            value={t.name}
                                            onSelect={() => {
                                                setManualToolId(t.id);
                                                setToolPopoverOpen(false);
                                            }}
                                        >
                                            <Check
                                                className={cn("mr-2 h-4 w-4", manualToolId === t.id ? "opacity-100" : "opacity-0")}
                                            />
                                            {t.name}
                                        </CommandItem>
                                        ))}
                                    </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                        <Button onClick={handleManualToolSelect} disabled={!manualToolId || !checkoutState.worker}>
                            Añadir
                        </Button>
                    </div>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <Label>Selecciona Herramienta a Devolver</Label>
                <div className="flex gap-2">
                  <Select value={manualToolId} onValueChange={setManualToolId}>
                    <SelectTrigger><SelectValue placeholder="Elige una herramienta..." /></SelectTrigger>
                    <SelectContent>
                      {checkedOutTools.map((t: ToolType) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleManualReturn} disabled={!manualToolId}>
                    Devolver
                  </Button>
                </div>
              </div>
            )}
          </div>
          {/* Panel escáner */}
          <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Panel de Escáner</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReturnMode(!returnMode);
                  handleCancel();
                }}
              >
                Cambiar a modo {returnMode ? 'Entrega' : 'Devolución'}
              </Button>
            </div>
            <form onSubmit={handlePistolScanSubmit}>
              <Label htmlFor="pistol-input">Entrada de Escáner de Pistola</Label>
              <Input
                id="pistol-input"
                placeholder={returnMode ? 'Escanear herramienta a devolver...' : 'Escanear trabajador o herramienta...'}
                value={pistolInput}
                onChange={e => setPistolInput(e.target.value)}
                autoComplete="off"
              />
            </form>
            <Button
              variant="outline"
              className="w-full"
              onClick={openScanner}
            >
              <ScanLine className="mr-2 h-4 w-4" /> Usar Cámara (Desactivado)
            </Button>
          </div>
          {/* Estado actual */}
          <div className="md:col-span-2 space-y-4 p-4 border-2 border-dashed rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-semibold text-lg">
                {returnMode ? 'Proceso de Devolución Actual' : 'Proceso de Entrega Actual'}
              </h4>
            </div>
            {!returnMode && !checkoutState.worker && (
              <div className="text-center py-8 text-muted-foreground">
                <User className="mx-auto h-8 w-8 mb-2" />
                <p>Selecciona o escanea un trabajador para empezar la entrega.</p>
              </div>
            )}
            {!returnMode && checkoutState.worker && (
              <div className="space-y-4">
                <div className="p-3 rounded-md bg-muted flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Entregando a:</p>
                    <p className="font-semibold">{checkoutState.worker.name}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      handleCancel();
                      setManualWorkerId('');
                    }}
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Cancelar Entrega</span>
                  </Button>
                </div>
                {checkoutState.tools.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="font-medium text-sm">Herramientas en Carrito ({checkoutState.tools.length}):</h5>
                    <ScrollArea className="h-32">
                      <ul className="space-y-1 pr-4">
                        {checkoutState.tools.map((tool: ToolType) => (
                          <li
                            key={`cart-${tool.id}`}
                            className="flex items-center justify-between text-sm bg-secondary p-2 rounded-md"
                          >
                            <span>{tool.name}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removeToolFromCart(tool.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}
                <Button
                  className="w-full"
                  onClick={handleConfirmCheckout}
                  disabled={checkoutState.tools.length === 0}
                >
                  <ArrowRight className="mr-2 h-4 w-4" /> Confirmar Entrega ({checkoutState.tools.length})
                </Button>
              </div>
            )}
            {returnMode && (
              <div className="space-y-4">
                <div className="text-center py-4 text-muted-foreground">
                  <p>Selecciona o escanea una herramienta para registrar su devolución.</p>
                </div>
                <div className="flex items-center space-x-2 pt-4 border-t">
                  <Checkbox
                    id="damaged"
                    checked={isDamaged}
                    onCheckedChange={(checked) => setIsDamaged(checked as boolean)}
                  />
                  <Label htmlFor="damaged" className="text-destructive font-medium">
                    Devuelta con daños
                  </Label>
                </div>
                <Textarea
                  placeholder="Describe el daño o problema..."
                  value={returnNotes}
                  onChange={e => setReturnNotes(e.target.value)}
                  disabled={!isDamaged}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
}
