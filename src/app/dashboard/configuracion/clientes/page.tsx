"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { ContractFormDialog } from "@/components/contract-form-dialog";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Building2, Briefcase, ChevronRight, Lock, Mail, Pencil, Phone, Plus, Search, Trash2, User as UserIcon, Users,
} from "lucide-react";
import type { Client, Contract } from "@/modules/core/lib/data";
import { format } from "date-fns";

const MICRO_LABEL = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";

const CONTRACT_STATUS: Record<Contract["status"], { label: string; cls: string }> = {
  active:    { label: "Activo",     cls: "badge-success" },
  suspended: { label: "Suspendido", cls: "badge-warning" },
  closed:    { label: "Cerrado",    cls: "bg-muted text-muted-foreground px-2 py-0.5 rounded-lg text-[10px] font-bold" },
};

const clientSchema = z.object({
  name: z.string().min(2, "El nombre es requerido."),
  rut: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email("Correo no válido").optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["active", "inactive"]),
});
type ClientFormData = z.infer<typeof clientSchema>;

const toDateStr = (d: Date | string | null | undefined) => {
  if (!d) return "";
  return typeof d === "string" ? d.substring(0, 10) : format(new Date(d), "yyyy-MM-dd");
};

export default function ClientesPage() {
  const router = useRouter();
  const { clients, contracts, contractWorkers, addClient, updateClient, deleteClient, can } = useAppState();
  const { toast } = useToast();
  const canManage = can("module_settings:view");

  const [search, setSearch] = useState("");
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [contractClientId, setContractClientId] = useState<string | null>(null);
  const [contractKind, setContractKind] = useState<'client' | 'internal'>('client');

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    defaultValues: { status: "active" },
  });

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...clients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(cl => !q
        || cl.name.toLowerCase().includes(q)
        || (cl.rut || "").toLowerCase().includes(q)
        || (cl.contactName || "").toLowerCase().includes(q));
  }, [clients, search]);

  // Las áreas internas también tienen client_id NULL, pero NO son contratos
  // huérfanos: son estructura propia de la empresa. Se separan antes de agrupar
  // o acabarían listadas como "contratos sin cliente" pidiendo que se les asigne uno.
  const clientContracts = useMemo(() => contracts.filter(c => c.kind !== 'internal'), [contracts]);
  const internalAreas = useMemo(
    () => contracts.filter(c => c.kind === 'internal').sort((a, b) => a.name.localeCompare(b.name)),
    [contracts]
  );

  const contractsByClient = useMemo(() => {
    const map = new Map<string | null, Contract[]>();
    for (const c of clientContracts) {
      const key = c.clientId ?? null;
      map.set(key, [...(map.get(key) || []), c]);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [clientContracts]);

  const orphanContracts = contractsByClient.get(null) || [];

  const workersOfContract = (contractId: string) =>
    contractWorkers.filter(cw => cw.contractId === contractId && !cw.endDate).length;

  const openCreateClient = () => {
    setEditingClient(null);
    reset({ name: "", rut: "", contactName: "", contactEmail: "", contactPhone: "", notes: "", status: "active" });
    setClientDialogOpen(true);
  };

  const openEditClient = (cl: Client) => {
    setEditingClient(cl);
    reset({
      name: cl.name, rut: cl.rut ?? "", contactName: cl.contactName ?? "",
      contactEmail: cl.contactEmail ?? "", contactPhone: cl.contactPhone ?? "",
      notes: cl.notes ?? "", status: cl.status,
    });
    setClientDialogOpen(true);
  };

  const onSubmitClient = async (data: ClientFormData) => {
    try {
      if (editingClient) {
        await updateClient(editingClient.id, { ...data, contactEmail: data.contactEmail || undefined });
        toast({ title: "Cliente actualizado", description: data.name });
      } else {
        await addClient({ ...data, contactEmail: data.contactEmail || undefined });
        toast({ title: "Cliente creado", description: data.name });
      }
      setClientDialogOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error al guardar", description: e.message });
    }
  };

  const handleDeleteClient = async () => {
    if (!deletingClient) return;
    try {
      await deleteClient(deletingClient.id);
      toast({ title: "Cliente eliminado", description: "Sus contratos quedaron sin cliente asignado." });
      setDeletingClient(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const openNewContract = (clientId: string | null) => {
    setEditingContract(null);
    setContractClientId(clientId);
    setContractKind('client');
    setContractDialogOpen(true);
  };

  const openNewInternalArea = () => {
    setEditingContract(null);
    setContractClientId(null);
    setContractKind('internal');
    setContractDialogOpen(true);
  };

  const openEditContract = (c: Contract) => {
    setEditingContract(c);
    setContractClientId(null);
    setContractKind(c.kind ?? 'client');
    setContractDialogOpen(true);
  };

  if (!canManage) {
    return (
      <PageShell title="Clientes y Contratos" description="Administración de la jerarquía Empresa → Cliente → Contrato.">
        <EmptyState
          icon={<Lock size={22} />}
          title="Sin acceso"
          description="Solo un administrador puede gestionar los clientes de la empresa."
        />
      </PageShell>
    );
  }

  const contractRow = (c: Contract, showClientHint = false) => {
    const st = CONTRACT_STATUS[c.status];
    const dotacion = workersOfContract(c.id);
    return (
      <div
        key={c.id}
        className="flex items-center gap-3 p-3 rounded-2xl border bg-muted/40 hover:bg-muted/70 transition-colors cursor-pointer"
        onClick={() => router.push(`/dashboard/attendance/contracts/${c.id}`)}
      >
        {c.kind === 'internal'
          ? <Building2 size={15} className="text-muted-foreground shrink-0" />
          : <Briefcase size={15} className="text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground truncate">
            {c.name}{c.code ? <span className="text-muted-foreground font-medium"> · {c.code}</span> : null}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Desde {toDateStr(c.startDate)}{c.endDate ? ` · hasta ${toDateStr(c.endDate)}` : ""}
            {showClientHint && " · sin cliente asignado"}
          </p>
        </div>
        <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-muted-foreground shrink-0">
          <Users size={12} /> {dotacion}
        </span>
        <span className={`${st.cls} shrink-0`}>{st.label}</span>
        <div onClick={e => e.stopPropagation()} className="flex items-center shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => openEditContract(c)}>
            <Pencil size={13} />
          </Button>
          <ChevronRight size={14} className="text-muted-foreground" />
        </div>
      </div>
    );
  };

  return (
    <PageShell
      title="Clientes y Contratos"
      description="Administra las empresas mandantes y sus contratos: la jerarquía Empresa → Cliente → Contrato."
      toolbar={
        <>
          <div className="relative w-full max-w-[280px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente, RUT o contacto..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 rounded-xl"
            />
          </div>
          <Button
            onClick={openCreateClient}
            className="rounded-[1.5rem] shadow-lg shadow-primary/10 hover:scale-105 active:scale-95 gap-2"
          >
            <Plus size={16} /> Nuevo Cliente
          </Button>
        </>
      }
    >
      {clients.length === 0 ? (
        <EmptyState
          icon={<Building2 size={22} />}
          title="Aún no hay clientes registrados"
          description="Crea el primer cliente (empresa mandante) para colgar sus contratos y filtrar activos, personal y stock por cliente."
          action={<Button onClick={openCreateClient} variant="outline" className="rounded-xl gap-2"><Plus size={14} /> Crear primer cliente</Button>}
        />
      ) : filteredClients.length === 0 ? (
        <EmptyState
          icon={<Search size={22} />}
          title="Sin resultados"
          description={`No se encontró ningún cliente para "${search}".`}
        />
      ) : (
        <div className="space-y-6">
          {filteredClients.map(cl => {
            const clContracts = contractsByClient.get(cl.id) || [];
            const activeCount = clContracts.filter(c => c.status === "active").length;
            return (
              <Card key={cl.id} className="rounded-[1.5rem] shadow-sm overflow-hidden">
                <CardContent className="p-6 space-y-4">
                  {/* Cabecera del cliente */}
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Building2 size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold text-foreground truncate">{cl.name}</h3>
                        {cl.status === "active"
                          ? <span className="badge-success">Activo</span>
                          : <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-lg text-[10px] font-bold">Inactivo</span>}
                      </div>
                      <div className="flex items-center gap-4 flex-wrap mt-1 text-xs text-muted-foreground">
                        {cl.rut && <span className="font-mono">{cl.rut}</span>}
                        {cl.contactName && <span className="flex items-center gap-1"><UserIcon size={11} /> {cl.contactName}</span>}
                        {cl.contactEmail && <span className="flex items-center gap-1"><Mail size={11} /> {cl.contactEmail}</span>}
                        {cl.contactPhone && <span className="flex items-center gap-1"><Phone size={11} /> {cl.contactPhone}</span>}
                      </div>
                      {cl.notes && <p className="text-xs text-muted-foreground mt-1 italic truncate">{cl.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" onClick={() => openNewContract(cl.id)} className="h-9 rounded-xl gap-1.5 text-[10px] font-black uppercase tracking-widest px-3">
                        <Plus size={13} /> Contrato
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => openEditClient(cl)}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-muted-foreground hover:text-destructive" onClick={() => setDeletingClient(cl)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>

                  {/* Contratos del cliente */}
                  <div className="space-y-2">
                    <p className={MICRO_LABEL}>
                      Contratos · {clContracts.length} total{clContracts.length !== 1 ? "es" : ""} · {activeCount} activo{activeCount !== 1 ? "s" : ""}
                    </p>
                    {clContracts.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Sin contratos — usa "+ Contrato" para crear el primero.</p>
                    ) : (
                      <div className="space-y-2">{clContracts.map(c => contractRow(c))}</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Áreas internas — estructura propia de la empresa, sin mandante.
          Su personal y su stock se imputan al área en vez de caer a "sin asignar". */}
      {!search && (
        <Card className="rounded-[1.5rem] shadow-sm">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className={MICRO_LABEL}>Áreas internas</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Estructura propia de la empresa (Administración, Finanzas, Abastecimiento…). No tienen
                  mandante, pero sí personal, pañoles y stock propios.
                </p>
              </div>
              <Button variant="outline" onClick={openNewInternalArea} className="h-9 rounded-xl gap-1.5 text-[10px] font-black uppercase tracking-widest px-3">
                <Plus size={13} /> Área Interna
              </Button>
            </div>
            {internalAreas.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Sin áreas internas — el personal de planta y el stock de oficina quedan hoy como "sin asignar".
              </p>
            ) : (
              <div className="space-y-2">{internalAreas.map(c => contractRow(c))}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Contratos huérfanos (sin cliente) — asignables editándolos */}
      {orphanContracts.length > 0 && !search && (
        <Card className="rounded-[1.5rem] border-warning/40 shadow-sm">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className={MICRO_LABEL}>Contratos sin cliente</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Edítalos y asígnales su empresa mandante para que aparezcan en los filtros por cliente.
                </p>
              </div>
              <Button variant="outline" onClick={() => openNewContract(null)} className="h-9 rounded-xl gap-1.5 text-[10px] font-black uppercase tracking-widest px-3">
                <Plus size={13} /> Contrato
              </Button>
            </div>
            <div className="space-y-2">{orphanContracts.map(c => contractRow(c, true))}</div>
          </CardContent>
        </Card>
      )}

      {/* Diálogo crear/editar cliente */}
      <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingClient ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmitClient)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label>Nombre / Razón social *</Label>
                <Input placeholder="Ej: Minera Los Andes SpA" {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>RUT</Label>
                <Input placeholder="76.123.456-7" {...register("rut")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label>Contacto</Label>
                <Input placeholder="Nombre del contacto" {...register("contactName")} />
              </div>
              <div className="space-y-1">
                <Label>Teléfono</Label>
                <Input placeholder="+56 9 ..." {...register("contactPhone")} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Correo del contacto</Label>
              <Input type="email" placeholder="contacto@cliente.cl" {...register("contactEmail")} />
              {errors.contactEmail && <p className="text-xs text-destructive">{errors.contactEmail.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Notas</Label>
              <Input placeholder="Observaciones internas..." {...register("notes")} />
            </div>
            <div className="space-y-1">
              <Label>Estado</Label>
              <select
                value={watch("status")}
                onChange={e => setValue("status", e.target.value as "active" | "inactive")}
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo (no aparece en filtros ni formularios)</option>
              </select>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {editingClient ? "Guardar cambios" : "Crear cliente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmación de borrado de cliente */}
      <Dialog open={!!deletingClient} onOpenChange={() => setDeletingClient(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>¿Eliminar cliente?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {(contractsByClient.get(deletingClient?.id ?? "")?.length || 0) > 0
              ? `"${deletingClient?.name}" tiene ${contractsByClient.get(deletingClient?.id ?? "")!.length} contrato(s): NO se borran, pero quedarán sin cliente asignado.`
              : `"${deletingClient?.name}" no tiene contratos asociados.`}
            {" "}Si solo quieres sacarlo de los filtros, márcalo como Inactivo en vez de eliminarlo.
          </p>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button variant="destructive" onClick={handleDeleteClient}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo compartido crear/editar contrato o área interna */}
      <ContractFormDialog
        open={contractDialogOpen}
        onOpenChange={setContractDialogOpen}
        contract={editingContract}
        defaultClientId={contractClientId}
        defaultKind={contractKind}
      />
    </PageShell>
  );
}
