"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Briefcase, Plus, Users, UserCheck, MapPin, ChevronRight, Pencil, Trash2, Building2 } from "lucide-react";
import type { Contract } from "@/modules/core/lib/data";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const STATUS_CONFIG = {
  active:    { label: "Activo",    cls: "bg-green-500/10 text-green-700 border-green-200" },
  suspended: { label: "Suspendido", cls: "bg-amber-500/10 text-amber-700 border-amber-200" },
  closed:    { label: "Cerrado",   cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

const contractSchema = z.object({
  name: z.string().min(1, "Nombre requerido"),
  code: z.string().optional(),
  clientName: z.string().optional(),
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

export default function ContractsPage() {
  const router = useRouter();
  const { contracts, contractWorkers, attendanceLogs, addContract, updateContract, deleteContract, can } = useAppState();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canManage = can('contracts:manage') || can('attendance:edit');
  const today = format(new Date(), "yyyy-MM-dd");

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<ContractFormData>({
    resolver: zodResolver(contractSchema),
    defaultValues: { status: "active", startDate: today },
  });

  const watchedStatus = watch("status");

  // Stats per contract
  const contractStats = useMemo(() => {
    return contracts.map(c => {
      const workerIds = contractWorkers.filter(cw => cw.contractId === c.id && !cw.endDate).map(cw => cw.userId);
      const todayLogs = attendanceLogs.filter(l => l.date === today && workerIds.includes(l.userId));
      const presentIds = new Set<string>();
      workerIds.forEach(uid => {
        const logs = todayLogs.filter(l => l.userId === uid).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        if (logs.length > 0 && logs[logs.length - 1].type === 'in') presentIds.add(uid);
      });
      return { contractId: c.id, totalWorkers: workerIds.length, presentToday: presentIds.size };
    });
  }, [contracts, contractWorkers, attendanceLogs, today]);

  const openCreate = () => {
    setEditingContract(null);
    reset({ status: "active", startDate: today });
    setDialogOpen(true);
  };

  const openEdit = (c: Contract) => {
    setEditingContract(c);
    reset({
      name: c.name, code: c.code ?? "", clientName: c.clientName ?? "",
      location: c.location ?? "", status: c.status,
      startDate: typeof c.startDate === 'string' ? c.startDate.substring(0, 10) : format(new Date(c.startDate), "yyyy-MM-dd"),
      endDate: c.endDate ? (typeof c.endDate === 'string' ? c.endDate.substring(0, 10) : format(new Date(c.endDate), "yyyy-MM-dd")) : "",
      description: c.description ?? "",
      isSubcontractor: c.isSubcontractor ?? false,
      parentContractId: c.parentContractId ?? "",
      subcontractorCompany: c.subcontractorCompany ?? "",
      subcontractorRut: c.subcontractorRut ?? "",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data: ContractFormData) => {
    try {
      const payload = {
        name: data.name, code: data.code, clientName: data.clientName,
        location: data.location, status: data.status,
        startDate: data.startDate, endDate: data.endDate || null,
        description: data.description,
        isSubcontractor: data.isSubcontractor,
        parentContractId: data.parentContractId || null,
        subcontractorCompany: data.subcontractorCompany || null,
        subcontractorRut: data.subcontractorRut || null,
      };
      if (editingContract) {
        await updateContract(editingContract.id, payload);
        toast({ title: "Contrato actualizado" });
      } else {
        await addContract(payload);
        toast({ title: "Contrato creado" });
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteContract(id);
      toast({ title: "Contrato eliminado" });
      setDeletingId(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Contratos" description="Gestiona los contratos de la empresa y su dotación de personal." />
        {canManage && (
          <Button onClick={openCreate} className="shrink-0 bg-pagnol-orange hover:bg-orange-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl px-6 gap-2">
            <Plus size={16} /> Nuevo Contrato
          </Button>
        )}
      </div>

      {contracts.length === 0 ? (
        <Card>
          <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
            <Briefcase size={40} className="opacity-30" />
            <p className="font-semibold text-lg">Sin contratos registrados</p>
            <p className="text-sm max-w-xs">Crea los contratos de la empresa para organizar la dotación y asistencia por faena.</p>
            {canManage && <Button onClick={openCreate} variant="outline" className="mt-2">Crear primer contrato</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {contracts.map(c => {
            const stats = contractStats.find(s => s.contractId === c.id) ?? { totalWorkers: 0, presentToday: 0 };
            const sc = STATUS_CONFIG[c.status];
            return (
              <Card key={c.id} className="group hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer" onClick={() => router.push(`/dashboard/attendance/contracts/${c.id}`)}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <CardTitle className="text-base truncate">{c.name}</CardTitle>
                        {c.isSubcontractor && (
                          <Badge variant="outline" className="text-[8px] font-black border-amber-400 text-amber-600 shrink-0">Subcont.</Badge>
                        )}
                      </div>
                      {c.code && <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">{c.code}</p>}
                      {c.subcontractorCompany && <p className="text-[10px] text-muted-foreground truncate">{c.subcontractorCompany}</p>}
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-[9px] font-black uppercase tracking-widest ${sc.cls}`}>
                      {sc.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {c.clientName && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Building2 size={13} className="shrink-0" />
                      <span className="truncate">{c.clientName}</span>
                    </div>
                  )}
                  {c.location && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin size={13} className="shrink-0" />
                      <span className="truncate">{c.location}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="bg-slate-50 rounded-xl p-3 text-center">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Dotación</p>
                      <div className="flex items-center justify-center gap-1 mt-1">
                        <Users size={13} className="text-slate-500" />
                        <p className="text-2xl font-black tracking-tighter">{stats.totalWorkers}</p>
                      </div>
                    </div>
                    <div className="bg-green-50 rounded-xl p-3 text-center">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Hoy</p>
                      <div className="flex items-center justify-center gap-1 mt-1">
                        <UserCheck size={13} className="text-green-600" />
                        <p className="text-2xl font-black tracking-tighter text-green-700">{stats.presentToday}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[10px] text-muted-foreground">
                      Desde {typeof c.startDate === 'string' ? c.startDate.substring(0, 10) : format(new Date(c.startDate), "dd MMM yyyy", { locale: es })}
                    </p>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                            <Pencil size={13} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeletingId(c.id)}>
                            <Trash2 size={13} />
                          </Button>
                        </>
                      )}
                      <ChevronRight size={14} className="text-muted-foreground ml-1" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingContract ? "Editar contrato" : "Nuevo contrato"}</DialogTitle>
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
                <Label>Empresa mandante</Label>
                <Input placeholder="Nombre del cliente" {...register("clientName")} />
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
                      value={watch("parentContractId") ?? ""}
                      onValueChange={v => setValue("parentContractId", v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Sin contrato padre" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Sin contrato padre</SelectItem>
                        {contracts
                          .filter(c => !c.isSubcontractor && c.status === 'active')
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
                {editingContract ? "Guardar cambios" : "Crear contrato"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>¿Eliminar contrato?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Se eliminarán también las asignaciones de trabajadores. Los registros de asistencia no se verán afectados.</p>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button variant="destructive" onClick={() => deletingId && handleDelete(deletingId)}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
