"use client";

// Herramientas unificadas con Activos: esta página opera sobre `materials` con
// usage_type 'Herramienta Menor' (los `tools` legacy fueron migrados por la
// migración 20260702130000_tools_to_materials.sql; sus QR impresos siguen
// funcionando porque viven en materials.serial_number). Los préstamos y
// devoluciones se registran en pagnol/movimientos con verificación biométrica.

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { PageShell } from "@/components/page-shell";
import { useAppState } from "@/modules/core/contexts/app-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import QRCode from "react-qr-code";
import { QrCode, Plus, Loader2, Edit, Trash2, ArrowLeftRight, History, ChevronDown, ChevronUp, MoreHorizontal, AlertCircle } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Material, MaterialRequest, ReturnRequest, ToolLog, User } from "@/modules/core/lib/data";

type CompatibleMaterialRequest = MaterialRequest & {
  materialId?: string;
  quantity?: number;
};

const ITEMS_PER_PAGE = 10;

export default function HerramientasPage() {
  const {
    materials, requests, returnRequests, users, toolLogs,
    addMaterial, updateMaterial, deleteMaterial, isLoading, can,
  } = useAppState();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Disponible" | "En Uso" | "En Mantenimiento">("all");
  const [page, setPage] = useState(1);
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<Material | null>(null);
  const [showLegacy, setShowLegacy] = useState(false);

  const canCreate = can("materials:create");
  const canEdit = can("materials:edit");
  const canDelete = can("materials:delete");

  const usersMap = useMemo(() => new Map((users || []).map((u: User) => [u.id, u])), [users]);

  // Universo: materiales tipo Herramienta Menor no archivados.
  const toolMaterials = useMemo(
    () => (materials || []).filter((m: Material) => m.usageType === "Herramienta Menor" && !m.archived),
    [materials]
  );

  // Quién tiene cada herramienta: se reconstruye desde el historial de
  // solicitudes entregadas y devoluciones completadas (mismo modelo que usa
  // pagnol/movimientos para la posesión por trabajador).
  const holderMap = useMemo(() => {
    type Ev = { time: number; kind: "out" | "in"; assetIds: string[]; holderId: string; holderName?: string };
    const evs: Ev[] = [];

    ((requests || []) as CompatibleMaterialRequest[]).forEach((r) => {
      if (r.status !== "approved") return;
      const items = r.items && Array.isArray(r.items)
        ? r.items
        : r.materialId ? [{ materialId: r.materialId, quantity: r.quantity || 1 }] : [];
      const holderId = r.receivedByUserId
        || (r.deliveryMode === "directed" ? r.beneficiaryId : null)
        || r.supervisorId;
      const holderName = r.receivedByUserName || r.beneficiaryName || r.userName;
      evs.push({
        time: new Date((r.approvalDate || r.createdAt) as any).getTime(),
        kind: "out",
        assetIds: items.map((i) => i.materialId),
        holderId: holderId || r.supervisorId,
        holderName: holderName || undefined,
      });
    });

    ((returnRequests || []) as ReturnRequest[]).forEach((r) => {
      if (r.status !== "completed") return;
      evs.push({
        time: new Date((r.completionDate || r.createdAt) as any).getTime(),
        kind: "in",
        assetIds: [r.materialId],
        holderId: r.supervisorId,
      });
    });

    evs.sort((a, b) => a.time - b.time);
    const map = new Map<string, { id: string; name: string }>();
    evs.forEach((ev) => ev.assetIds.forEach((id) => {
      if (ev.kind === "out") {
        map.set(id, { id: ev.holderId, name: ev.holderName || usersMap.get(ev.holderId)?.name || "Desconocido" });
      } else {
        map.delete(id);
      }
    }));
    return map;
  }, [requests, returnRequests, usersMap]);

  const getStatus = (m: Material): "Disponible" | "En Uso" | "En Mantenimiento" => {
    if (m.status === "En Mantenimiento") return "En Mantenimiento";
    if ((m.inUse || 0) > 0 || m.status === "En Uso") return "En Uso";
    return "Disponible";
  };

  const filteredTools = useMemo(() => {
    return toolMaterials.filter((m) => {
      const matchesSearch = searchTerm
        ? m.name.toLowerCase().includes(searchTerm.toLowerCase())
          || (m.serialNumber || "").toLowerCase().includes(searchTerm.toLowerCase())
          || (holderMap.get(m.id)?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
        : true;
      const matchesStatus = statusFilter === "all" || getStatus(m) === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [toolMaterials, searchTerm, statusFilter, holderMap]);

  const totalPages = Math.max(1, Math.ceil(filteredTools.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginatedTools = filteredTools.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const handleCreate = async () => {
    const name = newName.trim();
    if (name.length < 3) {
      toast({ variant: "destructive", title: "Nombre muy corto", description: "Ingresa al menos 3 caracteres." });
      return;
    }
    setIsCreating(true);
    try {
      await addMaterial({
        name,
        stock: 1,
        unit: "unidad",
        category: "Herramientas",
        class: "C",
        usageType: "Herramienta Menor",
        serialNumber: `TOOL-${nanoid(10).toUpperCase()}`,
        justification: "Alta de herramienta",
      });
      toast({ title: "Herramienta creada", description: `${name} quedó disponible con su QR listo para imprimir.` });
      setNewName("");
    } catch (err) {
      toast({ variant: "destructive", title: "Error al crear", description: err instanceof Error ? err.message : "No se pudo crear la herramienta." });
    } finally {
      setIsCreating(false);
    }
  };

  const handleRename = async () => {
    if (!editing) return;
    const name = editName.trim();
    if (name.length < 3) {
      toast({ variant: "destructive", title: "Nombre muy corto", description: "Ingresa al menos 3 caracteres." });
      return;
    }
    try {
      await updateMaterial(editing.id, { name });
      toast({ title: "Herramienta actualizada", description: `Nuevo nombre: ${name}.` });
      setEditing(null);
    } catch (err) {
      toast({ variant: "destructive", title: "Error al actualizar", description: err instanceof Error ? err.message : "No se pudo actualizar." });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMaterial(deleting.id);
      toast({ title: "Herramienta eliminada", description: `${deleting.name} fue eliminada.` });
      setDeleting(null);
    } catch (err) {
      toast({ variant: "destructive", title: "Error al eliminar", description: err instanceof Error ? err.message : "No se pudo eliminar." });
    }
  };

  // Historial legado (tabla tool_logs del módulo antiguo, solo lectura).
  const legacyLogs = useMemo(
    () => [...((toolLogs || []) as ToolLog[])].sort(
      (a, b) => new Date(b.checkoutDate as any).getTime() - new Date(a.checkoutDate as any).getTime()
    ),
    [toolLogs]
  );

  const legacyColumns: DataTableColumn<ToolLog>[] = [
    { key: "tool", header: "Herramienta", className: "font-medium", cell: (l) => l.toolName },
    { key: "worker", header: "Trabajador", cell: (l) => l.userName },
    { key: "out", header: "Entregada", className: "text-xs text-muted-foreground", cell: (l) => new Date(l.checkoutDate as any).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) },
    { key: "in", header: "Devuelta", className: "text-xs text-muted-foreground", cell: (l) => l.returnDate ? new Date(l.returnDate as any).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
    {
      key: "state", header: "Estado", cell: (l) => l.returnDate
        ? (l.returnStatus === "damaged"
          ? <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">Con daños</Badge>
          : <Badge variant="outline" className="border-success/30 bg-success-subtle text-success-subtle-foreground">Devuelta</Badge>)
        : <Badge variant="outline" className="border-warning/30 bg-warning-subtle text-warning-subtle-foreground">Migrada a Activos</Badge>,
    },
  ];

  return (
    <PageShell
      title="Gestión de Herramientas"
      description="Las herramientas son activos (Herramienta Menor, Clase C). Los préstamos y devoluciones se registran en Transacciones con verificación biométrica."
    >
      {/* CTA al flujo real de préstamo/devolución */}
      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 text-primary rounded-2xl">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-sm">¿Entregar o recibir una herramienta?</p>
              <p className="text-xs text-muted-foreground">
                Identifica al trabajador (biometría o QR) y escanea la herramienta — Clase C se entrega al instante, con acta y trazabilidad completa.
              </p>
            </div>
          </div>
          <Button asChild className="shrink-0">
            <Link href="/dashboard/pagnol/movimientos">
              Ir a Transacciones <ArrowLeftRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Alta rápida */}
      {canCreate && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nueva Herramienta</CardTitle>
            <CardDescription>Se crea como activo Clase C con QR propio, lista para prestar.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-grow space-y-1">
                <Label htmlFor="new-tool" className="sr-only">Nombre</Label>
                <Input
                  id="new-tool"
                  placeholder="Ej: Taladro percutor Bosch GSB 13 RE"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={isCreating}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
                />
              </div>
              <Button onClick={handleCreate} disabled={isCreating || newName.trim().length < 3}>
                {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Crear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventario */}
      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Inventario de Herramientas</CardTitle>
              <CardDescription>
                {toolMaterials.length} herramienta{toolMaterials.length !== 1 ? "s" : ""} en total
                {filteredTools.length !== toolMaterials.length && ` · ${filteredTools.length} filtradas`}
              </CardDescription>
            </div>
            <Button asChild variant="outline">
              <Link href="/dashboard/pagnol/herramientas/print-qrs">
                <QrCode className="mr-2 h-4 w-4" />
                Imprimir Códigos QR
              </Link>
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Input
              placeholder="Buscar por nombre, QR o trabajador..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              className="sm:max-w-sm"
            />
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="Disponible">Disponibles</SelectItem>
                <SelectItem value="En Uso">Prestadas</SelectItem>
                <SelectItem value="En Mantenimiento">En Mantenimiento</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-semibold">Nombre</th>
                  <th className="px-6 py-3 font-semibold text-center w-24">QR</th>
                  <th className="px-6 py-3 font-semibold">Estado</th>
                  <th className="px-6 py-3 font-semibold">En posesión de</th>
                  <th className="px-6 py-3 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="h-32 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    </td>
                  </tr>
                ) : paginatedTools.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="h-32 text-center text-muted-foreground">
                      {searchTerm || statusFilter !== "all"
                        ? "No se encontraron herramientas con los filtros aplicados."
                        : "Aún no hay herramientas registradas."}
                    </td>
                  </tr>
                ) : (
                  paginatedTools.map((m) => {
                    const status = getStatus(m);
                    const holder = holderMap.get(m.id);
                    const isOut = status === "En Uso";
                    return (
                      <tr key={m.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-medium">{m.name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{m.serialNumber || m.internalCode || m.id}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="p-2 bg-white rounded border shadow-sm mx-auto w-fit">
                            <QRCode value={m.serialNumber || m.id} size={48} />
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-medium gap-1",
                              status === "Disponible" && "border-success/30 bg-success-subtle text-success-subtle-foreground",
                              status === "En Uso" && "border-warning/30 bg-warning-subtle text-warning-subtle-foreground",
                              status === "En Mantenimiento" && "border-destructive/30 bg-destructive/10 text-destructive",
                            )}
                          >
                            {status === "En Uso" ? "Prestada" : status}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {isOut ? (holder?.name ?? "—") : "—"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Acciones para {m.name}</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canEdit && (
                                <DropdownMenuItem onSelect={() => { setEditing(m); setEditName(m.name); }}>
                                  <Edit className="mr-2 h-4 w-4" /> Editar nombre
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem asChild>
                                <Link href="/dashboard/pagnol/activos">
                                  <QrCode className="mr-2 h-4 w-4" /> Ver ficha completa en Activos
                                </Link>
                              </DropdownMenuItem>
                              {canDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  {isOut ? (
                                    <DropdownMenuItem disabled className="text-muted-foreground">
                                      <AlertCircle className="mr-2 h-4 w-4" /> Prestada — no se puede eliminar
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onSelect={() => setDeleting(m)}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" /> Eliminar herramienta
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t">
              <div className="text-sm text-muted-foreground">
                Mostrando {(safePage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(safePage * ITEMS_PER_PAGE, filteredTools.length)} de {filteredTools.length}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historial del módulo antiguo (solo lectura) */}
      {legacyLogs.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setShowLegacy((v) => !v)}
          >
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4 text-muted-foreground" /> Historial de préstamos (módulo antiguo)
                </CardTitle>
                <CardDescription>
                  {legacyLogs.length} registro{legacyLogs.length !== 1 ? "s" : ""} de solo lectura. Los préstamos nuevos quedan en el kardex y en Transacciones.
                </CardDescription>
              </div>
              {showLegacy ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
          {showLegacy && (
            <CardContent>
              <DataTable
                columns={legacyColumns}
                data={legacyLogs}
                rowKey={(l) => l.id}
                maxHeight="400px"
                minWidth="700px"
                empty={{ title: "Sin registros" }}
              />
            </CardContent>
          )}
        </Card>
      )}

      {/* Dialogo: renombrar */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Herramienta</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="edit-tool-name">Nombre</Label>
            <Input
              id="edit-tool-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleRename(); } }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={handleRename} disabled={editName.trim().length < 3}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogo: eliminar */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la herramienta "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción es permanente y no se puede deshacer. También desaparecerá del inventario de Activos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleDelete}>
              Sí, eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
