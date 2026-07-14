"use client";

import React, { useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { Contract, MaterialStock, User, Warehouse, WarehouseContract } from "@/modules/core/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Edit, Loader2, MoreHorizontal, Plus, Search, Trash2, Warehouse as WarehouseIcon } from "lucide-react";

const NO_MANAGER = "__none__";

interface WarehouseFormValues {
    name: string;
    location: string;
    managerId: string; // NO_MANAGER = sin encargado
    notes: string;
    status: "active" | "inactive";
    contractIds: string[];
}

const emptyForm: WarehouseFormValues = {
    name: "",
    location: "",
    managerId: NO_MANAGER,
    notes: "",
    status: "active",
    contractIds: [],
};

export default function WarehousesPage() {
    const {
        warehouses, warehouseContracts, contracts, users, materialStocks,
        addWarehouse, updateWarehouse, deleteWarehouse, can,
    } = useAppState();
    const { toast } = useToast();

    const canManage = can("warehouses:manage");

    const [searchTerm, setSearchTerm] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Warehouse | null>(null);
    const [form, setForm] = useState<WarehouseFormValues>(emptyForm);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deleting, setDeleting] = useState<Warehouse | null>(null);

    const activeContracts = useMemo(
        () => ((contracts || []) as Contract[]).filter((c) => c.status === "active"),
        [contracts],
    );
    const contractNames = useMemo(
        () => new Map(((contracts || []) as Contract[]).map((c) => [c.id, c.name])),
        [contracts],
    );
    const sortedUsers = useMemo(
        () => [...((users || []) as User[])].sort((a, b) => a.name.localeCompare(b.name)),
        [users],
    );

    // Contratos que atiende cada pañol (N:M).
    const contractsByWarehouse = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const wc of (warehouseContracts || []) as WarehouseContract[]) {
            const list = map.get(wc.warehouseId) || [];
            list.push(wc.contractId);
            map.set(wc.warehouseId, list);
        }
        return map;
    }, [warehouseContracts]);

    // Unidades asignadas a cada pañol según el ledger.
    const stockByWarehouse = useMemo(() => {
        const map = new Map<string, number>();
        for (const s of (materialStocks || []) as MaterialStock[]) {
            if (!s.warehouseId) continue;
            map.set(s.warehouseId, (map.get(s.warehouseId) || 0) + Number(s.qty));
        }
        return map;
    }, [materialStocks]);

    const filteredWarehouses = useMemo(() => {
        const list = ((warehouses || []) as Warehouse[]);
        if (!searchTerm) return list;
        const q = searchTerm.toLowerCase();
        return list.filter((w) =>
            w.name.toLowerCase().includes(q) ||
            (w.location || "").toLowerCase().includes(q) ||
            (w.managerName || "").toLowerCase().includes(q),
        );
    }, [warehouses, searchTerm]);

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm);
        setDialogOpen(true);
    };

    const openEdit = (w: Warehouse) => {
        setEditing(w);
        setForm({
            name: w.name,
            location: w.location || "",
            managerId: w.managerId || NO_MANAGER,
            notes: w.notes || "",
            status: w.status,
            contractIds: contractsByWarehouse.get(w.id) || [],
        });
        setDialogOpen(true);
    };

    const toggleContract = (contractId: string) => {
        setForm((f) => ({
            ...f,
            contractIds: f.contractIds.includes(contractId)
                ? f.contractIds.filter((id) => id !== contractId)
                : [...f.contractIds, contractId],
        }));
    };

    const handleSubmit = async () => {
        if (!form.name.trim()) {
            toast({ variant: "destructive", title: "Falta el nombre", description: "El pañol necesita un nombre." });
            return;
        }
        setIsSubmitting(true);
        try {
            const managerId = form.managerId === NO_MANAGER ? null : form.managerId;
            const managerName = managerId
                ? sortedUsers.find((u) => u.id === managerId)?.name || null
                : null;
            const payload = {
                name: form.name.trim(),
                location: form.location.trim() || null,
                managerId,
                managerName,
                notes: form.notes.trim() || null,
                contractIds: form.contractIds,
            };
            if (editing) {
                await updateWarehouse(editing.id, { ...payload, status: form.status });
                toast({ title: "Pañol actualizado", description: `"${form.name.trim()}" guardado correctamente.` });
            } else {
                await addWarehouse(payload);
                toast({ title: "Pañol creado", description: `"${form.name.trim()}" ya está disponible.` });
            }
            setDialogOpen(false);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: editing ? "Error al actualizar" : "Error al crear",
                description: error?.message || "No se pudo guardar el pañol.",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (w: Warehouse) => {
        try {
            await deleteWarehouse(w.id);
            toast({ title: "Pañol eliminado", description: `"${w.name}" fue eliminado.` });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error al eliminar",
                description: error?.message || "No se pudo eliminar el pañol.",
            });
        } finally {
            setDeleting(null);
        }
    };

    const columns: DataTableColumn<Warehouse>[] = [
        {
            key: "name",
            header: "Pañol",
            cell: (w) => (
                <div>
                    <p className="font-semibold">{w.name}</p>
                    {w.location && <p className="text-xs text-muted-foreground">{w.location}</p>}
                </div>
            ),
        },
        {
            key: "manager",
            header: "Encargado",
            cell: (w) => w.managerName
                ? <span className="text-sm">{w.managerName}</span>
                : <span className="text-sm text-muted-foreground">Sin asignar</span>,
        },
        {
            key: "contracts",
            header: "Contratos que atiende",
            cell: (w) => {
                const ids = contractsByWarehouse.get(w.id) || [];
                if (!ids.length) return <span className="text-sm text-muted-foreground">—</span>;
                return (
                    <div className="flex flex-wrap gap-1.5">
                        {ids.map((cid) => (
                            <Badge key={cid} variant="outline" className="rounded-xl text-[10px] font-bold">
                                {contractNames.get(cid) || "Contrato"}
                            </Badge>
                        ))}
                    </div>
                );
            },
        },
        {
            key: "stock",
            header: "Existencias",
            cell: (w) => {
                const qty = stockByWarehouse.get(w.id) || 0;
                return <span className={qty > 0 ? "font-semibold" : "text-muted-foreground"}>{qty}</span>;
            },
        },
        {
            key: "status",
            header: "Estado",
            cell: (w) => w.status === "active"
                ? <span className="badge-success">Activo</span>
                : <Badge variant="secondary" className="rounded-xl">Inactivo</Badge>,
        },
        ...(canManage ? [{
            key: "actions",
            header: "",
            className: "w-12 text-right",
            cell: (w: Warehouse) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                            <span className="sr-only">Abrir menú</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(w)}>
                            <Edit className="mr-2 h-4 w-4" />
                            <span>Editar</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleting(w)}>
                            <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                            <span className="text-destructive">Eliminar</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        }] : []),
    ];

    return (
        <PageShell
            title="Gestión de Pañoles"
            description="Define los pañoles físicos, su encargado y los contratos que atiende cada uno."
            toolbar={
                <>
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por nombre, ubicación o encargado..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 rounded-xl"
                        />
                    </div>
                    {canManage && (
                        <Button onClick={openCreate} className="rounded-[1.5rem] shadow-lg shadow-primary/10 hover:scale-105 active:scale-95">
                            <Plus className="mr-2 h-4 w-4" />
                            Nuevo Pañol
                        </Button>
                    )}
                </>
            }
        >
            <DataTable
                columns={columns}
                data={filteredWarehouses}
                rowKey={(w) => w.id}
                minWidth="760px"
                empty={{
                    icon: <WarehouseIcon size={22} />,
                    title: searchTerm ? "Sin resultados" : "No hay pañoles aún",
                    description: searchTerm
                        ? `No se encontró "${searchTerm}".`
                        : canManage
                            ? "Crea el primer pañol para desglosar las existencias por contrato y ubicación."
                            : undefined,
                }}
            />

            <Dialog open={dialogOpen} onOpenChange={(open) => { if (!isSubmitting) setDialogOpen(open); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing ? `Editar "${editing.name}"` : "Nuevo Pañol"}</DialogTitle>
                        <DialogDescription>
                            {editing
                                ? "Modifica los datos del pañol y los contratos que atiende."
                                : "Un pañol puede atender uno o varios contratos a la vez."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="wh-name">Nombre <span className="text-destructive">*</span></Label>
                                <Input
                                    id="wh-name"
                                    value={form.name}
                                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                    placeholder="Pañol Torres"
                                    className="rounded-xl"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="wh-location">Ubicación</Label>
                                <Input
                                    id="wh-location"
                                    value={form.location}
                                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                                    placeholder="Ej: Faena norte, sector chancado"
                                    className="rounded-xl"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Encargado (panolero)</Label>
                            <Select
                                value={form.managerId}
                                onValueChange={(v) => setForm((f) => ({ ...f, managerId: v }))}
                            >
                                <SelectTrigger className="rounded-xl">
                                    <SelectValue placeholder="Sin asignar" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_MANAGER}>Sin asignar</SelectItem>
                                    {sortedUsers.map((u) => (
                                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                Sus movimientos de pañol quedarán imputados a este pañol
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Contratos y áreas que atiende</Label>
                            {activeContracts.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No hay contratos ni áreas activas.</p>
                            ) : (
                                <ScrollArea className="max-h-44 rounded-xl border">
                                    <div className="p-3 space-y-2">
                                        {/* Un pañol de oficina atiende a un área interna; el pañol central
                                            puede atender a todos los contratos a la vez (N:M). */}
                                        {activeContracts.map((c) => (
                                            <label key={c.id} className="flex items-center gap-2.5 cursor-pointer">
                                                <Checkbox
                                                    checked={form.contractIds.includes(c.id)}
                                                    onCheckedChange={() => toggleContract(c.id)}
                                                />
                                                <span className="text-sm">
                                                    {c.name}{c.code ? ` (${c.code})` : ""}
                                                    {c.kind === 'internal' && (
                                                        <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                                                            Área interna
                                                        </span>
                                                    )}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </ScrollArea>
                            )}
                        </div>

                        {editing && (
                            <div className="space-y-1.5">
                                <Label>Estado</Label>
                                <Select
                                    value={form.status}
                                    onValueChange={(v) => setForm((f) => ({ ...f, status: v as "active" | "inactive" }))}
                                >
                                    <SelectTrigger className="rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">Activo</SelectItem>
                                        <SelectItem value="inactive">Inactivo</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label htmlFor="wh-notes">Notas</Label>
                            <Textarea
                                id="wh-notes"
                                value={form.notes}
                                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                placeholder="Observaciones internas..."
                                className="rounded-xl min-h-[70px]"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSubmit} disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {editing ? "Guardar cambios" : "Crear Pañol"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar "{deleting?.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. Si el pañol tiene existencias asignadas,
                            primero deberás transferirlas a otro pañol o al pool central.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() => deleting && handleDelete(deleting)}
                        >
                            Sí, eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageShell>
    );
}
