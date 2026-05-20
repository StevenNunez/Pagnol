
"use client";

import React, { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    Mail,
    UserPlus,
    Send,
    Clock,
    ShieldCheck,
    Copy,
    X,
    CheckCircle2,
    AlertCircle,
    Loader2,
    History,
    MoreVertical,
    Trash2
} from "lucide-react";
import { useAuth } from "@/modules/auth/useAuth";
import { supabase } from "@/modules/core/lib/supabase";
import { nanoid } from "nanoid";
import { useToast } from "@/modules/core/hooks/use-toast";
import { UserRole } from "@/modules/core/lib/data";

interface Invitation {
    id: string;
    email: string;
    role: UserRole;
    tenantId: string;
    token: string;
    status: 'pending' | 'used' | 'expired';
    expiresAt: Date;
    invitedBy: string;
    invitedByName?: string;
    createdAt: Date;
}
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

export default function InvitacionesPage() {
    const { user, currentTenantId } = useAuth();
    const { toast } = useToast();
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<UserRole>("supervisor");
    const [isInviting, setIsInviting] = useState(false);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!currentTenantId) return;

        fetchInvitations();

        const channel = supabase
            .channel(`invitations-${currentTenantId}-${Date.now()}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'invitations',
                filter: `tenant_id=eq.${currentTenantId}`,
            }, () => {
                fetchInvitations(false);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [currentTenantId]);

    const fetchInvitations = async (showLoading = true) => {
        if (showLoading) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('invitations')
                .select('*')
                .eq('tenant_id', currentTenantId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const mappedData = data.map(inv => ({
                id: inv.id,
                email: inv.email,
                role: inv.role,
                tenantId: inv.tenant_id,
                token: inv.token,
                status: inv.status,
                expiresAt: new Date(inv.expires_at),
                invitedBy: inv.invited_by,
                invitedByName: inv.invited_by_name,
                createdAt: new Date(inv.created_at)
            })) as Invitation[];

            setInvitations(mappedData);
        } catch (error) {
            console.error("Error fetching invitations:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleInvite = async () => {
        if (!email.trim() || !email.includes("@")) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "Por favor ingresa un correo electrónico válido.",
            });
            return;
        }

        setIsInviting(true);
        const emailToInvite = email.toLowerCase();
        try {
            const token = nanoid(32);
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 48);

            // Fetch tenant name (rápido, solo un campo)
            let tenantName = 'Pagnol Workspace';
            try {
                const { data: tenant } = await supabase
                    .from('tenants')
                    .select('name')
                    .eq('id', currentTenantId)
                    .single();
                if (tenant) tenantName = tenant.name;
            } catch (err) {
                console.error("Error fetching tenant name:", err);
            }

            const { error: invError } = await supabase
                .from('invitations')
                .insert({
                    email: emailToInvite,
                    role,
                    tenant_id: currentTenantId,
                    token,
                    status: 'pending',
                    expires_at: expiresAt.toISOString(),
                    invited_by: user?.id,
                    invited_by_name: user?.name,
                    created_at: new Date().toISOString(),
                });

            if (invError) throw invError;

            // Invitación guardada — desbloquear UI inmediatamente
            const newInvitation: Invitation = {
                id: token, // temporal hasta que fetchInvitations traiga el id real
                email: emailToInvite,
                role,
                tenantId: currentTenantId!,
                token,
                status: 'pending',
                expiresAt,
                invitedBy: user?.id || '',
                invitedByName: user?.name,
                createdAt: new Date(),
            };
            setInvitations(prev => [newInvitation, ...prev]);
            setEmail("");
            setIsInviting(false);

            toast({
                title: "Invitación Generada",
                description: `El enlace para ${emailToInvite} está listo. Enviando correo...`,
            });

            // Enviar email en segundo plano — no bloquea la UI
            fetch('/api/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: emailToInvite,
                    role,
                    token,
                    tenantName,
                    invitedByName: user?.name,
                }),
            })
                .then(async (res) => {
                    if (res.ok) {
                        toast({
                            title: "Correo Enviado",
                            description: `Se ha notificado a ${emailToInvite}.`,
                        });
                    } else {
                        const errorData = await res.json().catch(() => ({}));
                        toast({
                            variant: "warning" as any,
                            title: "Correo no enviado",
                            description: errorData.details || "El enlace fue generado. Puedes copiarlo manualmente.",
                        });
                    }
                    // Refrescar lista en segundo plano para obtener el ID real — sin mostrar spinner
                    fetchInvitations(false);
                })
                .catch(() => {
                    toast({
                        variant: "warning" as any,
                        title: "Correo no enviado",
                        description: "El enlace fue generado. Puedes copiarlo manualmente.",
                    });
                    fetchInvitations(false);
                });

        } catch (error) {
            console.error("Error creating invitation:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo crear la invitación.",
            });
            setIsInviting(false);
        }
    };

    const copyInviteLink = (token: string) => {
        const link = `${window.location.origin}/invite/${token}`;
        navigator.clipboard.writeText(link);
        toast({
            title: "Enlace Copiado",
            description: "El link de invitación está en tu portapapeles.",
        });
    };

    const deleteInvitation = async (id: string) => {
        try {
            const { error } = await supabase
                .from('invitations')
                .delete()
                .eq('id', id);

            if (error) throw error;

            setInvitations(prev => prev.filter(inv => inv.id !== id));
            toast({
                title: "Invitación Anulada",
                description: "El acceso ha sido revocado.",
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo anular la invitación.",
            });
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            <PageHeader
                title="Centro de Invitaciones"
                description="Delegue responsabilidades invitando a Administradores de Obra y Supervisores de forma segura"
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Panel de Creación */}
                <Card className="rounded-[2.5rem] border-none shadow-xl shadow-slate-200/50 bg-slate-100 overflow-hidden lg:col-span-1 border-t-4 border-t-pagnol-orange">
                    <CardHeader className="bg-slate-50/50 p-8">
                        <CardTitle className="text-xl font-black uppercase font-outfit text-slate-800">Nueva Invitación</CardTitle>
                        <CardDescription className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Paso 3 del Onboarding</CardDescription>
                    </CardHeader>
                    <CardContent className="p-8 space-y-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Correo Electrónico</Label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                                <Input
                                    placeholder="invitado@empresa.cl"
                                    className="pl-12 h-12 rounded-2xl border-slate-100 bg-slate-50/50 focus:bg-slate-100 transition-all"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Rol de Acceso</Label>
                            <Select value={role} onValueChange={(val: any) => setRole(val)}>
                                <SelectTrigger className="h-12 rounded-2xl border-slate-100 bg-slate-50/50 focus:bg-slate-100 transition-all text-xs font-black uppercase tracking-widest">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="administrador" className="text-xs font-black uppercase text-slate-700">Administrador (Control Total)</SelectItem>
                                    <SelectItem value="supervisor" className="text-xs font-black uppercase text-slate-700">Supervisor (Operaciones)</SelectItem>
                                    <SelectItem value="panolero" className="text-xs font-black uppercase text-slate-700">Pañolero (Operador Bodega)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="p-4 bg-orange-50 rounded-2xl border border-orange-100 space-y-2">
                            <div className="flex items-center gap-2 text-pagnol-orange">
                                <Clock size={14} />
                                <span className="text-[10px] font-black uppercase">Seguridad Temporal</span>
                            </div>
                            <p className="text-[9px] font-bold text-orange-700/60 uppercase leading-relaxed">
                                El enlace expirará automáticamente en 48 horas. Solo puede ser usado una vez para completar el registro.
                            </p>
                        </div>

                        <Button
                            disabled={isInviting}
                            onClick={handleInvite}
                            className="w-full py-7 rounded-[1.2rem] bg-slate-900 hover:bg-black text-white shadow-xl shadow-slate-200 transition-all group overflow-hidden relative"
                        >
                            {isInviting ? (
                                <Loader2 className="animate-spin" size={18} />
                            ) : (
                                <div className="flex items-center gap-2">
                                    <Send size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                                    <span className="font-black text-[11px] uppercase tracking-widest">Generar Invitación</span>
                                </div>
                            )}
                        </Button>
                    </CardContent>
                </Card>

                {/* Historial / Lista */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="rounded-[2.5rem] border-none shadow-xl shadow-slate-200/50 bg-slate-100 overflow-hidden min-h-[500px]">
                        <CardHeader className="p-8 border-b bg-slate-100 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-xl font-black uppercase font-outfit">Invitaciones Enviadas</CardTitle>
                                <CardDescription className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Control de tokens y accesos pendientes</CardDescription>
                            </div>
                            <History size={20} className="text-slate-200" />
                        </CardHeader>
                        <CardContent className="p-0">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center py-40 opacity-40">
                                    <Loader2 className="animate-spin mb-4" size={32} />
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Sincronizando...</span>
                                </div>
                            ) : invitations.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-40 text-slate-300 opacity-60">
                                    <div className="bg-slate-50 p-6 rounded-full mb-6">
                                        <UserPlus size={40} className="opacity-20" />
                                    </div>
                                    <p className="font-black uppercase text-sm tracking-widest text-muted-foreground">Sin Invitaciones</p>
                                    <p className="text-[10px] font-black uppercase opacity-40 mt-2">Comienza invitando a tu equipo de gestión.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead className="bg-slate-50 border-b">
                                            <tr>
                                                <th className="px-8 py-5 text-[9px] font-black uppercase text-muted-foreground text-left">Invitado / Rol</th>
                                                <th className="px-8 py-5 text-[9px] font-black uppercase text-muted-foreground text-left">Estado / Expira</th>
                                                <th className="px-8 py-5 text-[9px] font-black uppercase text-muted-foreground text-right">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {invitations.map((inv) => (
                                                <tr key={inv.id} className="hover:bg-slate-50/30 transition-colors group">
                                                    <td className="px-8 py-6">
                                                        <div className="flex flex-col gap-1">
                                                            <span className="font-black text-xs text-slate-700 uppercase">{inv.email}</span>
                                                            <Badge variant="outline" className="w-fit text-[8px] font-black px-2 border-slate-200 text-muted-foreground uppercase tracking-widest">
                                                                {inv.role}
                                                            </Badge>
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-6">
                                                        <div className="flex flex-col gap-1.5">
                                                            <div className="flex items-center gap-2">
                                                                {inv.status === 'pending' ? (
                                                                    <div className="flex items-center gap-1.5 font-black text-[9px] text-amber-500 uppercase">
                                                                        <Clock size={10} /> Pendiente
                                                                    </div>
                                                                ) : inv.status === 'used' ? (
                                                                    <div className="flex items-center gap-1.5 font-black text-[9px] text-green-500 uppercase">
                                                                        <CheckCircle2 size={10} /> Utilizado
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-1.5 font-black text-[9px] text-red-500 uppercase">
                                                                        <X size={10} /> Expirado
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">
                                                                Corte: {format(inv.expiresAt, "dd MMM HH:mm", { locale: es })}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-6 text-right">
                                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {inv.status === 'pending' && (
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-10 w-10 rounded-xl hover:bg-pagnol-orange hover:text-white"
                                                                    onClick={() => copyInviteLink(inv.token)}
                                                                >
                                                                    <Copy size={16} />
                                                                </Button>
                                                            )}
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-10 w-10 rounded-xl hover:bg-red-50 text-slate-300 hover:text-red-500"
                                                                onClick={() => deleteInvitation(inv.id)}
                                                            >
                                                                <Trash2 size={16} />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
