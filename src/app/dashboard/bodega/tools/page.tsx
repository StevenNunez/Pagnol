"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, MoreHorizontal, Edit, QrCode, AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import QRCode from "react-qr-code";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EditToolForm } from "@/components/admin/edit-tool-form";
import { ToolCheckoutCard } from "@/components/admin/tool-checkout-card";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tool as ToolType, ToolLog, User } from "@/modules/core/lib/data";

const ITEMS_PER_PAGE = 10;

// Hook optimizado: datos de herramientas
function useToolsData() {
  const { users, toolLogs, tools, deleteTool, isLoading, can } = useAppState();
  const { toast } = useToast();
  const canDelete = can("tools:delete");

  const checkedOutMap = useMemo(() => {
    const map = new Map<string, ToolLog>();
    toolLogs
      ?.filter((log): log is ToolLog & { returnDate: null } => log.returnDate === null)
      .forEach((log) => map.set(log.toolId, log));
    return map;
  }, [toolLogs]);

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    users?.forEach((u) => map.set(u.id, u.name));
    return map;
  }, [users]);

  const getCheckoutInfo = useCallback(
    (toolId: string) => {
      const log = checkedOutMap.get(toolId);
      if (!log) return { status: "Disponible" as const, workerName: null };
      const workerName = userNameMap.get(log.userId) ?? log.userName ?? "Desconocido";
      return { status: "Ocupado" as const, workerName };
    },
    [checkedOutMap, userNameMap]
  );

  const handleDelete = useCallback(
    async (toolId: string, toolName: string) => {
      try {
        await deleteTool(toolId);
        toast({
          title: "Herramienta eliminada",
          description: `${toolName} ha sido eliminada correctamente.`,
        });
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Error al eliminar",
          description: err instanceof Error ? err.message : "No se pudo eliminar la herramienta.",
        });
      }
    },
    [deleteTool, toast]
  );

  return { tools: tools || [], isLoading, canDelete, getCheckoutInfo, handleDelete };
}

// Hook de filtrado y paginación
function useToolFilteringAndPagination(tools: ToolType[], getCheckoutInfo: (id: string) => any) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Disponible" | "Ocupado">("all");
  const [page, setPage] = useState(1);

  const filteredTools = useMemo(() => {
    return tools.filter((tool) => {
      const matchesSearch = searchTerm
        ? tool.name.toLowerCase().includes(searchTerm.toLowerCase())
        : true;
      const matchesStatus =
        statusFilter === "all" || getCheckoutInfo(tool.id).status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [tools, searchTerm, statusFilter, getCheckoutInfo]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTools.length / ITEMS_PER_PAGE));
  const paginatedTools = filteredTools.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE
  );

  return {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    page,
    setPage: (p: number) => setPage(Math.max(1, Math.min(p, totalPages))),
    paginatedTools,
    totalPages,
    hasResults: filteredTools.length > 0,
    totalFiltered: filteredTools.length,
  };
}

export default function AdminToolsPage() {
  const [editingTool, setEditingTool] = useState<ToolType | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; name: string } | null>(null);

  const { tools, isLoading, getCheckoutInfo, handleDelete, canDelete } = useToolsData();
  const {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    page,
    setPage,
    paginatedTools,
    totalPages,
    totalFiltered,
  } = useToolFilteringAndPagination(tools, getCheckoutInfo);

  const onEdit = (tool: ToolType) => {
    setEditingTool(tool);
  };

  const onDelete = (tool: ToolType) => {
    const info = getCheckoutInfo(tool.id);
    if (info.status === "Ocupado") return;
    setDeleteCandidate({ id: tool.id, name: tool.name });
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Gestión de Herramientas"
        description="Administra el inventario, préstamos y códigos QR de todas las herramientas."
      />

      {editingTool && (
        <EditToolForm
          tool={editingTool}
          isOpen={!!editingTool}
          onClose={() => setEditingTool(null)}
        />
      )}

      <ToolCheckoutCard />

      <Card className="border-l-4 border-l-purple-500 shadow-sm">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Inventario de Herramientas</CardTitle>
              <CardDescription>
                {tools.length} herramienta{tools.length !== 1 ? "s" : ""} en total
                {totalFiltered !== tools.length && ` · ${totalFiltered} filtradas · ${paginatedTools.length} mostradas`}
              </CardDescription>
            </div>
            <Button asChild>
              <Link href="/dashboard/bodega/tools/print-qrs">
                <QrCode className="mr-2 h-4 w-4" />
                Imprimir Códigos QR
              </Link>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Filtros */}
          <div className="p-6 border-b space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <Input
                placeholder="Buscar por nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="sm:max-w-sm"
              />
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="Disponible">Disponibles</SelectItem>
                  <SelectItem value="Ocupado">Prestadas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tabla */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-24 text-center">QR</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>En posesión de</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto" />
                      <span className="sr-only">Cargando herramientas...</span>
                    </TableCell>
                  </TableRow>
                ) : paginatedTools.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      {searchTerm || statusFilter !== "all"
                        ? "No se encontraron herramientas con los filtros aplicados."
                        : "Aún no hay herramientas registradas."}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedTools.map((tool) => {
                    const info = getCheckoutInfo(tool.id);
                    const isCheckedOut = info.status === "Ocupado";

                    return (
                      <TableRow key={tool.id} className="hover:bg-muted/50">
                        <TableCell className="font-medium">{tool.name}</TableCell>
                        <TableCell>
                          <div className="p-2 bg-white rounded border shadow-sm mx-auto w-fit">
                            <QRCode value={tool.qrCode} size={48} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={info.status === "Disponible" ? "default" : "destructive"}
                            className={cn(
                              "font-medium",
                              info.status === "Disponible"
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                : "bg-orange-600 hover:bg-orange-700 text-white"
                            )}
                          >
                            {info.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {info.workerName ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Acciones para {tool.name}</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => onEdit(tool)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Editar nombre
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {canDelete && (
                                isCheckedOut ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <DropdownMenuItem
                                          className="text-muted-foreground cursor-not-allowed"
                                          disabled
                                          onSelect={(e) => e.preventDefault()}
                                        >
                                          <AlertCircle className="mr-2 h-4 w-4" />
                                          No se puede eliminar
                                        </DropdownMenuItem>
                                      </TooltipTrigger>
                                      <TooltipContent side="left">
                                        Herramienta en uso — devuélvela antes de eliminar
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={(e) => e.preventDefault()}
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Eliminar herramienta
                                      </DropdownMenuItem>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          ¿Eliminar la herramienta "{tool.name}"?
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Esta acción es permanente y no se puede deshacer.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction
                                          className="bg-destructive hover:bg-destructive/90"
                                          onClick={() => onDelete(tool)}
                                        >
                                          Sí, eliminar
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t">
              <div className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, totalFiltered)} de {totalFiltered}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}