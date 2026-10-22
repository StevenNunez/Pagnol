"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { User, UserRole } from "@/modules/core/lib/data";
import { Trash2, Edit, QrCode, Search, UserMinus, UserPlus, X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserPanel } from "@/components/user-panel";
import { SendAccessDialog } from "@/components/admin/send-access-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import QRCode from "react-qr-code";
import { Input } from "@/components/ui/input";
import { ROLES } from "@/modules/core/lib/permissions";
import { Briefcase, Building2 } from "lucide-react";
import { ClientContractFilter, contractIdsOfClient, CC_ALL, CC_POOL } from "@/components/client-contract-filter";
import type { Contract } from "@/modules/core/lib/data";
import { cleanRut } from "@/lib/rut";

type StatusFilter = "all" | "active" | "terminated";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Vigentes" },
  { value: "terminated", label: "Desvinculados" },
];

// El punto del avatar dice el estado laboral (antes era siempre verde, como si todos estuvieran «en línea»).
const STATUS_DOT: Record<string, { cls: string; label: string }> = {
  active: { cls: "bg-success", label: "Vigente" },
  on_leave: { cls: "bg-warning", label: "Con licencia o vacaciones" },
  terminated: { cls: "bg-destructive", label: "Desvinculado" },
};

export default function AdminUsersPage() {
  const { users, contracts, contractWorkers, deleteUser, can } = useAppState();
  const { user: authUser } = useAuth();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  // Atajo «Desvincular»: abre la ficha ya con el diálogo de desvinculación.
  const [separateOnOpen, setSeparateOnOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedClientId, setSelectedClientId] = useState<string>(CC_ALL);
  const [selectedContractId, setSelectedContractId] = useState<string>(CC_ALL);
  const { toast } = useToast();
  // Mismos roles que acepta /api/users/send-access.
  const canSendAccess = ["administrador", "soporte-pagnol", "super-admin"].includes(authUser?.role ?? "");

  // Asignaciones vigentes (sin fecha de término) por usuario: contratos de cliente
  // y áreas internas por igual — ambos son filas de `contracts`.
  const assignmentsByUser = useMemo(() => {
    const map = new Map<string, Contract[]>();
    for (const cw of contractWorkers) {
      if (cw.endDate) continue;
      const contract = contracts.find(c => c.id === cw.contractId);
      if (!contract) continue;
      const list = map.get(cw.userId) || [];
      list.push(contract);
      map.set(cw.userId, list);
    }
    return map;
  }, [contractWorkers, contracts]);

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  }

  const getRoleDisplayName = (role: UserRole) => {
    return ROLES[role]?.label || role;
  }

  const getRoleBadgeVariant = (role: UserRole): "default" | "secondary" | "destructive" | "outline" => {
    switch (role) {
      case 'super-admin':
      case 'administrador': return 'destructive';
      case 'panolero': return 'secondary';
      case 'supervisor': return 'secondary';
      case 'apr': return 'secondary';
      case 'operador': return 'outline';
      default: return 'outline';
    }
  }

  const handleDeleteUser = async (userId: string, userName: string) => {
    try {
      await deleteUser(userId);
      toast({
        title: "Usuario Eliminado",
        description: `El usuario ${userName} ha sido eliminado correctamente.`
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error al eliminar",
        description: error?.message || "No se pudo eliminar el usuario."
      });
    }
  }

  const filteredUsers = useMemo(() => {
    if (!users) return [];

    const q = searchTerm.trim().toLowerCase();
    // Lo escrito parece un RUT («19.693.178-3», «196931783»): se compara sin puntos ni guion,
    // porque en la ficha puede estar guardado con otro formato.
    const rutQuery = /^[0-9.\-kK\s]+$/.test(q) ? cleanRut(q) : "";

    return users.filter((user: User) => {
      const matchesSearch = !q ||
        user.name.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        (user.internalId || "").toLowerCase().includes(q) ||
        (user.rut || "").toLowerCase().includes(q) ||
        (rutQuery.length >= 3 && cleanRut(user.rut || "").includes(rutQuery));
      if (!matchesSearch) return false;

      if (statusFilter === "terminated" && user.employmentStatus !== "terminated") return false;
      if (statusFilter === "active" && user.employmentStatus === "terminated") return false;

      if (selectedContractId === CC_ALL && selectedClientId === CC_ALL) return true;

      const assigned = assignmentsByUser.get(user.id) || [];
      // POOL = sin contrato NI área interna: dato faltante, no "personal de planta".
      if (selectedContractId === CC_POOL) return assigned.length === 0;

      const allowed = selectedContractId !== CC_ALL
        ? new Set([selectedContractId])
        : contractIdsOfClient(contracts, selectedClientId);
      return assigned.some(c => allowed.has(c.id));
    });
  }, [users, searchTerm, statusFilter, selectedClientId, selectedContractId, assignmentsByUser, contracts]);

  const hasFilters = !!searchTerm || statusFilter !== "all" || selectedClientId !== CC_ALL || selectedContractId !== CC_ALL;
  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setSelectedClientId(CC_ALL);
    setSelectedContractId(CC_ALL);
  };

  return (
    <PageShell
      title="Gestión de Usuarios"
      description="Crea, visualiza y gestiona todos los perfiles registrados en el sistema."
    >
      {editingUser && can('users:edit') && (
        <UserPanel
          key={`${editingUser.id}-${separateOnOpen}`}
          user={editingUser}
          isOpen={!!editingUser}
          onClose={() => { setEditingUser(null); setSeparateOnOpen(false); }}
          defaultTab={separateOnOpen ? 'contrato' : undefined}
          startSeparation={separateOnOpen}
        />
      )}

      {/* Crear usuario en una ventana: antes era una columna fija más alta que la pantalla y no se
          podía bajar hasta el botón. Aquí el formulario tiene su propio scroll. */}
      {can('users:create') && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-[2rem]">
            <DialogHeader>
              <DialogTitle className="text-xl font-black uppercase tracking-tight">Crear Nuevo Usuario</DialogTitle>
              <DialogDescription className="text-[10px] uppercase font-black tracking-widest">
                Añade nuevos miembros con acceso centralizado.
              </DialogDescription>
            </DialogHeader>
            <CreateUserForm onCreated={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      )}

      {/* Barra de herramientas: la búsqueda ocupa su propia fila para que nunca quede aplastada
          por los botones, y las acciones pasan de línea en vez de salirse de la pantalla. */}
      <div className="bg-card p-5 rounded-[2rem] border shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Nombre, correo, RUT o ID…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-11 pr-10 h-12 bg-muted/30 border-none rounded-xl focus-visible:ring-primary/20"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                aria-label="Borrar búsqueda"
                className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <ClientContractFilter
            clientId={selectedClientId}
            contractId={selectedContractId}
            onClientChange={setSelectedClientId}
            onContractChange={setSelectedContractId}
            includePool
            poolLabel="Sin asignar"
            triggerClassName="w-full lg:w-52 h-12 rounded-xl bg-muted/30 border-none"
          />
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl" role="group" aria-label="Estado laboral">
              {STATUS_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setStatusFilter(o.value)}
                  className={`px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${statusFilter === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-xs font-bold text-muted-foreground" aria-live="polite">
              {filteredUsers.length === (users || []).length
                ? `${filteredUsers.length} personas`
                : `${filteredUsers.length} de ${(users || []).length} personas`}
            </p>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest gap-1.5">
                <X className="h-3 w-3" /> Limpiar filtros
              </Button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 [&>*]:w-full sm:[&>*]:w-auto">
            {canSendAccess && <SendAccessDialog users={users || []} selfId={authUser?.id} />}
            {can('users:print_qr') && (
              <Button asChild variant="outline" className="h-11 px-5 rounded-xl font-black text-[10px] uppercase tracking-widest">
                <Link href="/dashboard/users/print-qrs">
                  <QrCode className="mr-2 h-4 w-4" />
                  Imprimir Credenciales
                </Link>
              </Button>
            )}
            {can('users:create') && (
              <Button onClick={() => setCreateOpen(true)} className="h-11 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-primary/10">
                <UserPlus className="mr-2 h-4 w-4" />
                Nuevo Usuario
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {filteredUsers.map((user: User) => {
          const dot = STATUS_DOT[user.employmentStatus || "active"] ?? STATUS_DOT.active;
          return (
            <div key={user.id} className="group bg-card border rounded-[2rem] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6 hover:shadow-2xl hover:border-primary/20 transition-all duration-300">
              <div className="flex items-center gap-6 flex-grow min-w-0">
                <div className="relative shrink-0">
                  <Avatar className="h-16 w-16 rounded-2xl border-2 border-background shadow-xl ring-2 ring-border group-hover:ring-primary/10 transition-all">
                    <AvatarFallback className="bg-muted text-muted-foreground font-black text-lg">
                      {getInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`absolute -bottom-1 -right-1 w-5 h-5 ${dot.cls} border-2 border-card rounded-full shadow-sm`} title={dot.label}></div>
                </div>

                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-black text-foreground uppercase tracking-tight text-base">{user.name}</h4>
                    <Badge variant={getRoleBadgeVariant(user.role)} className="text-[8px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full">
                      {getRoleDisplayName(user.role)}
                    </Badge>
                    {user.employmentStatus === 'terminated' && (
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-[8px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full">
                        Desvinculado
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest flex items-center gap-2 break-all">
                    {user.email}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {user.internalId && (
                      <span className="text-[9px] font-black text-pagnol-orange bg-orange-50 dark:bg-orange-500/15 px-2 py-0.5 rounded-md border border-orange-100 dark:border-orange-500/30 uppercase">
                        ID: {user.internalId}
                      </span>
                    )}
                    {user.rut && (
                      <span className="text-[9px] font-black text-muted-foreground bg-muted px-2 py-0.5 rounded-md border border-border uppercase">
                        RUT: {user.rut}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-0.5">
                    {(assignmentsByUser.get(user.id) || []).length > 0 ? (
                      (assignmentsByUser.get(user.id) || []).map(c => c.kind === 'internal' ? (
                        <span key={c.id} className="badge-warning text-[9px] font-black px-2 py-0.5 rounded-md uppercase flex items-center gap-1" title="Área interna">
                          <Building2 size={10} /> {c.name}
                        </span>
                      ) : (
                        <span key={c.id} className="badge-info text-[9px] font-black px-2 py-0.5 rounded-md uppercase flex items-center gap-1" title="Contrato de cliente">
                          <Briefcase size={10} /> {c.name}
                        </span>
                      ))
                    ) : (
                      // Ni contrato ni área: dato faltante, no "planta".
                      <span className="text-[9px] font-black text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md border border-dashed border-border uppercase flex items-center gap-1">
                        <Briefcase size={10} /> Sin asignar
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0 justify-end">
                {user.qrCode && user.qrCode.trim() !== '' && (
                  <div className="p-2 bg-muted rounded-xl border-2 border-dashed border-border group-hover:border-primary/20 transition-all">
                    <QRCode value={user.qrCode} size={48} fgColor="#1e293b" />
                  </div>
                )}

                {can('users:edit') && (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" title="Editar ficha" onClick={() => setEditingUser(user)} className="h-10 w-10 rounded-xl hover:bg-muted">
                      <Edit className="h-4 w-4 text-muted-foreground" />
                    </Button>

                    {user.employmentStatus !== 'terminated' && authUser?.id !== user.id && user.role !== 'super-admin' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Desvincular: la saca de la empresa y conserva su historial"
                        onClick={() => { setSeparateOnOpen(true); setEditingUser(user); }}
                        className="h-10 w-10 rounded-xl hover:bg-warning-subtle hover:text-warning-subtle-foreground"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}

                    {can('users:delete') && authUser?.id !== user.id && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" title="Eliminar definitivamente" className="h-10 w-10 rounded-xl hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-[2.5rem] border-none">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-xl font-black uppercase tracking-tight">¿Eliminar Usuario?</AlertDialogTitle>
                            <AlertDialogDescription className="text-muted-foreground font-medium">
                              Esta acción eliminará permanentemente a <span className="font-bold text-foreground">{user.name}</span> del sistema Pagnol: desaparece de todas las listas y de la nómina. Esta operación no se puede deshacer desde la aplicación.
                              {user.employmentStatus !== 'terminated' && (
                                <span className="block mt-3 text-foreground">Si sólo dejó la empresa, usa <b>Desvincular</b>: la saca de la nómina, le cierra el acceso y deja su historial de entregas, firmas y solicitudes a la vista.</span>
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter className="gap-3 sm:flex-wrap sm:justify-end">
                            <AlertDialogCancel className="rounded-xl font-bold uppercase text-[10px] tracking-widest border-border">Cancelar</AlertDialogCancel>
                            {user.employmentStatus !== 'terminated' && user.role !== 'super-admin' && (
                              <AlertDialogAction
                                className="rounded-xl font-bold uppercase text-[10px] tracking-widest"
                                onClick={() => { setSeparateOnOpen(true); setEditingUser(user); }}>
                                Mejor desvincular
                              </AlertDialogAction>
                            )}
                            <AlertDialogAction
                              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl font-bold uppercase text-[10px] tracking-widest"
                              onClick={() => handleDeleteUser(user.id, user.name)}>
                              Borrar Definitivamente
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredUsers.length === 0 && (
          <EmptyState
            className="rounded-[2.5rem] py-24"
            icon={<Users size={28} />}
            title={hasFilters ? "Sin coincidencias" : "Aún no hay usuarios"}
            description={hasFilters ? "No encontramos usuarios que coincidan con la búsqueda o los filtros." : "Crea el primero con «Nuevo Usuario»."}
            action={hasFilters ? <Button variant="outline" className="rounded-xl" onClick={clearFilters}>Limpiar filtros</Button> : undefined}
          />
        )}
      </div>
    </PageShell>
  );
}
