"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Contract } from "@/modules/core/lib/data";
import { format } from "date-fns";

/**
 * Diálogo compartido de crear/editar contrato (con creación de cliente al vuelo).
 * Fuente única del formulario: lo usan Asistencia → Contratos y
 * Configuración → Clientes y Contratos.
 */
const contractSchema = z.object({
  name: z.string().min(1, "Nombre requerido"),
  code: z.string().optional(),
  clientId: z.string().optional(), // FK a Client (fuente de verdad)
  location: z.string().optional(),
  status: z.enum(["active", "suspended", "closed"]),
  startDate: z.string().min(1, "Fecha de inicio requerida"),
  endDate: z.string().optional(),
  description: z.string().optional(),
  isSubcontractor: z.boolean().default(false),
  parentContractId: z.string().optional(),
  subcontractorCompany: z.string().optional(),
  subcontractorRut: z.string().optional(),
});
type ContractFormData = z.infer<typeof contractSchema>;

const toDateStr = (d: Date | string | null | undefined) => {
  if (!d) return "";
  return typeof d === "string" ? d.substring(0, 10) : format(new Date(d), "yyyy-MM-dd");
};

interface ContractFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contrato a editar; null/undefined = crear. */
  contract?: Contract | null;
  /** Cliente preseleccionado al crear (p.ej. "+ Contrato" desde la ficha del cliente). */
  defaultClientId?: string | null;
}

export function ContractFormDialog({ open, onOpenChange, contract, defaultClientId }: ContractFormDialogProps) {
  const { clients, contracts, addClient, addContract, updateContract } = useAppState();
  const { toast } = useToast();
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");

  const activeClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients]
  );
  const today = format(new Date(), "yyyy-MM-dd");

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<ContractFormData>({
    resolver: zodResolver(contractSchema),
    defaultValues: { status: "active", startDate: today },
  });

  // Repuebla el form cada vez que se abre (crear limpio o editar con datos).
  useEffect(() => {
    if (!open) return;
    setCreatingClient(false);
    setNewClientName("");
    if (contract) {
      reset({
        name: contract.name, code: contract.code ?? "", clientId: contract.clientId ?? "",
        location: contract.location ?? "", status: contract.status,
        startDate: toDateStr(contract.startDate),
        endDate: toDateStr(contract.endDate),
        description: contract.description ?? "",
        isSubcontractor: contract.isSubcontractor ?? false,
        parentContractId: contract.parentContractId ?? "",
        subcontractorCompany: contract.subcontractorCompany ?? "",
        subcontractorRut: contract.subcontractorRut ?? "",
      });
    } else {
      reset({ status: "active", startDate: today, clientId: defaultClientId ?? "" });
    }
  }, [open, contract, defaultClientId, reset, today]);

  const watchedStatus = watch("status");

  // Crear un cliente al vuelo desde el formulario de contrato y seleccionarlo.
  const handleCreateClient = async () => {
    const name = newClientName.trim();
    if (!name) return;
    try {
      const created = await addClient({ name, status: "active" });
      setValue("clientId", created.id);
      setNewClientName("");
      setCreatingClient(false);
      toast({ title: "Cliente creado", description: name });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error al crear cliente", description: e.message });
    }
  };

  const onSubmit = async (data: ContractFormData) => {
    try {
      const clientName = data.clientId ? (clients.find(c => c.id === data.clientId)?.name ?? undefined) : undefined;
      const payload = {
        name: data.name, code: data.code, clientId: data.clientId || null, clientName,
        location: data.location, status: data.status,
        startDate: data.startDate, endDate: data.endDate || null,
        description: data.description,
        isSubcontractor: data.isSubcontractor,
        parentContractId: data.parentContractId || null,
        subcontractorCompany: data.subcontractorCompany || null,
        subcontractorRut: data.subcontractorRut || null,
      };
      if (contract) {
        await updateContract(contract.id, payload);
        toast({ title: "Contrato actualizado" });
      } else {
        await addContract(payload);
        toast({ title: "Contrato creado" });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{contract ? "Editar contrato" : "Nuevo contrato"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2 sm:col-span-1">
              <Label>Nombre del contrato *</Label>
              <Input placeholder="Ej: Mina El Volcán — Fase 2" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Código</Label>
              <Input placeholder="Ej: CT-2025-001" {...register("code")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cliente (empresa mandante)</Label>
              {creatingClient ? (
                <div className="flex gap-2">
                  <Input autoFocus placeholder="Nombre del nuevo cliente" value={newClientName} onChange={e => setNewClientName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateClient(); } }} />
                  <Button type="button" size="sm" onClick={handleCreateClient} disabled={!newClientName.trim()}>Crear</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setCreatingClient(false); setNewClientName(""); }}>Cancelar</Button>
                </div>
              ) : (
                <Select
                  value={watch("clientId") || "none"}
                  onValueChange={v => { if (v === "__new__") { setCreatingClient(true); } else { setValue("clientId", v === "none" ? "" : v); } }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecciona un cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cliente</SelectItem>
                    {activeClients.map(cl => <SelectItem key={cl.id} value={cl.id}>{cl.name}</SelectItem>)}
                    <SelectItem value="__new__" className="text-primary font-bold">+ Nuevo cliente…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label>Faena / Ubicación</Label>
              <Input placeholder="Ej: Sierra Gorda, II Región" {...register("location")} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Estado</Label>
              <Select value={watchedStatus} onValueChange={v => setValue("status", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="suspended">Suspendido</SelectItem>
                  <SelectItem value="closed">Cerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Inicio *</Label>
              <Input type="date" {...register("startDate")} />
              {errors.startDate && <p className="text-xs text-destructive">{errors.startDate.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Término</Label>
              <Input type="date" {...register("endDate")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Descripción</Label>
            <Input placeholder="Alcance del contrato, observaciones..." {...register("description")} />
          </div>

          {/* Subcontratista */}
          <div className="border-t border-border pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isSubcontractor"
                className="rounded border-border"
                {...register("isSubcontractor")}
              />
              <Label htmlFor="isSubcontractor" className="cursor-pointer">Es subcontratista / empresa externa</Label>
            </div>
            {watch("isSubcontractor") && (
              <div className="grid grid-cols-2 gap-3 pl-5">
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label>Empresa subcontratista</Label>
                  <Input placeholder="Razón social" {...register("subcontractorCompany")} />
                </div>
                <div className="space-y-1">
                  <Label>RUT empresa</Label>
                  <Input placeholder="12.345.678-9" {...register("subcontractorRut")} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Contrato padre (opcional)</Label>
                  <Select
                    value={watch("parentContractId") || "none"}
                    onValueChange={v => setValue("parentContractId", v === "none" ? "" : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Sin contrato padre" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin contrato padre</SelectItem>
                      {contracts
                        .filter(c => !c.isSubcontractor && c.status === 'active' && c.id !== contract?.id)
                        .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {contract ? "Guardar cambios" : "Crear contrato"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
