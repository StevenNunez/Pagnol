"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { User, UserRole } from "@/modules/core/lib/data";
import { MoreHorizontal, Trash2, Edit, QrCode, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EditUserForm } from "@/components/admin/edit-user-form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import QRCode from "react-qr-code";
import { Input } from "@/components/ui/input";
import { ROLES } from "@/modules/core/lib/permissions";


export default function AdminUsersPage() {
  const { users, deleteUser, can } = useAppState();
  const { user: authUser } = useAuth();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

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
    if (!searchTerm) return users;

    return users.filter((user: User) =>
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (user.rut && user.rut.includes(searchTerm))
    );
  }, [users, searchTerm]);

  return (
    <div className="space-y-8 animate-in fade-in duration-1000">
      <PageHeader
        title="Gestión de Usuarios"
        description="Crea, visualiza y gestiona todos los perfiles registrados en el sistema."
      />

      {editingUser && can('users:edit') && (
        <EditUserForm
          user={editingUser}
          isOpen={!!editingUser}
          onClose={() => setEditingUser(null)}
        />
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 items-start">
        {can('users:create') && (
          <div className="lg:col-span-1 sticky top-8">
            <Card className="rounded-[2.5rem] border-none shadow-2xl bg-card overflow-hidden">
              <CardHeader className="industrial-gradient text-white p-8">
                <CardTitle className="text-xl font-black uppercase tracking-tight">Crear Nuevo Usuario</CardTitle>
                <CardDescription className="text-white/60 text-[10px] uppercase font-black tracking-widest">
                  Añade nuevos miembros con acceso centralizado.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-8">
                <CreateUserForm />
              </CardContent>
            </Card>
          </div>
        )}
        <div className={can('users:create') ? "lg:col-span-2" : "lg:col-span-3"}>
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 bg-card p-6 rounded-[2rem] border shadow-sm">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, correo o RUT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-11 h-12 bg-muted/30 border-none rounded-xl focus-visible:ring-primary/20"
                />
              </div>
              {can('users:print_qr') && (
                <Button asChild className="h-12 px-6 rounded-xl bg-pagnol-orange hover:bg-orange-600 font-black text-[10px] uppercase tracking-widest shadow-lg shadow-orange-500/20">
                  <Link href="/dashboard/users/print-qrs">
                    <QrCode className="mr-2 h-4 w-4" />
                    Imprimir Credenciales
                  </Link>
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6">
              {filteredUsers.map((user: User) => (
                <div key={user.id} className="group bg-card border rounded-[2rem] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6 hover:shadow-2xl hover:border-primary/20 transition-all duration-300">
                  <div className="flex items-center gap-6 flex-grow">
                    <div className="relative">
                      <Avatar className="h-16 w-16 rounded-2xl border-2 border-background shadow-xl ring-2 ring-slate-100 group-hover:ring-primary/10 transition-all">
                        <AvatarFallback className="bg-slate-50 text-muted-foreground font-black text-lg">
                          {getInitials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-2 border-card rounded-full shadow-sm"></div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <h4 className="font-black text-slate-900 uppercase tracking-tight text-base">{user.name}</h4>
                        <Badge variant={getRoleBadgeVariant(user.role)} className="text-[8px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full">
                          {getRoleDisplayName(user.role)}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest flex items-center gap-2">
                        <Search size={10} className="text-slate-300" /> {user.email}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {user.internalId && (
                          <span className="text-[9px] font-black text-pagnol-orange bg-orange-50 px-2 py-0.5 rounded-md border border-orange-100 uppercase">
                            ID: {user.internalId}
                          </span>
                        )}
                        {user.rut && (
                          <span className="text-[9px] font-black text-muted-foreground bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 uppercase">
                            RUT: {user.rut}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 justify-end">
                    {user.qrCode && user.qrCode.trim() !== '' && (
                      <div className="p-2 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 group-hover:border-primary/20 transition-all">
                        <QRCode value={user.qrCode} size={48} fgColor="#1e293b" />
                      </div>
                    )}

                    {can('users:edit') && (
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => setEditingUser(user)} className="h-10 w-10 rounded-xl hover:bg-slate-100">
                          <Edit className="h-4 w-4 text-muted-foreground" />
                        </Button>

                        {can('users:delete') && authUser?.id !== user.id && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-red-50 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[2.5rem] border-none">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-xl font-black uppercase tracking-tight">¿Eliminar Usuario?</AlertDialogTitle>
                                <AlertDialogDescription className="text-muted-foreground font-medium">
                                  Esta acción eliminará permanentemente a <span className="font-bold text-slate-900">{user.name}</span> del sistema Pagnol. Esta operación no se puede deshacer.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter className="gap-3">
                                <AlertDialogCancel className="rounded-xl font-bold uppercase text-[10px] tracking-widest border-slate-200">Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold uppercase text-[10px] tracking-widest"
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
              ))}

              {filteredUsers.length === 0 && (
                <div className="py-24 text-center bg-card rounded-[2.5rem] border-2 border-dashed border-slate-100">
                  <div className="bg-slate-50 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <Search className="text-slate-300" size={32} />
                  </div>
                  <h3 className="text-slate-900 font-black uppercase tracking-tight">Sin coincidencias</h3>
                  <p className="text-muted-foreground text-xs font-medium mt-2">No encontramos usuarios que coincidan con su búsqueda.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
