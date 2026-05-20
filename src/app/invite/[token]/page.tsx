
"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    ShieldCheck,
    User,
    Lock,
    ArrowRight,
    Loader2,
    AlertCircle,
    Building2,
    Mail,
    Eye,
    EyeOff
} from "lucide-react";
import { useToast } from "@/modules/core/hooks/use-toast";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { Invitation, Tenant } from "@/modules/core/lib/data";

export default function InvitePage() {
    const { token } = useParams();
    const router = useRouter();
    const { toast } = useToast();
    const { login } = useAuth();

    const [invitation, setInvitation] = useState<Invitation | null>(null);
    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitPhase, setSubmitPhase] = useState<'creating' | 'logging_in'>('creating');

    useEffect(() => {
        validateToken();
    }, [token]);

    const validateToken = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/invite/accept/${token}`);
            const json = await res.json();

            if (!res.ok) {
                setError(json.error || "El link de invitación no es válido, ya fue utilizado o ha expirado.");
                return;
            }

            const { invitation: inv, tenant: ten } = json;

            setInvitation({
                id: inv.id,
                email: inv.email,
                role: inv.role,
                tenantId: inv.tenant_id,
                token: inv.token,
                status: inv.status,
                expiresAt: inv.expires_at as any,
                invitedBy: inv.invited_by,
                createdAt: inv.created_at as any,
            });

            if (ten) {
                setTenant({
                    id: ten.id,
                    name: ten.name,
                    tenantId: ten.tenant_id,
                    createdAt: ten.created_at as any,
                    plan: ten.plan,
                });
            }

        } catch (err) {
            console.error("Token validation error:", err);
            setError("Error al validar la invitación.");
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!invitation || !name.trim() || password.length < 6) {
            toast({
                variant: "destructive",
                title: "Campos Inválidos",
                description: "Por favor completa tu nombre y una contraseña de al menos 6 caracteres.",
            });
            return;
        }

        setIsSubmitting(true);
        setSubmitPhase('creating');
        try {
            const { isPasswordLeaked } = await import('@/lib/password-security');
            if (await isPasswordLeaked(password)) {
                toast({
                    variant: "destructive",
                    title: "Contraseña Comprometida",
                    description: "Esta contraseña fue expuesta en filtraciones conocidas. Elige una diferente.",
                });
                return;
            }

            const res = await fetch(`/api/invite/accept/${invitation.token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password }),
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'No se pudo completar el registro.');

            // Usar login de AuthProvider (establece authLoading=true antes del signIn)
            // Esto evita el conflicto de lock con el onAuthStateChange del AuthProvider
            setSubmitPhase('logging_in');
            await login(invitation.email, password);

            toast({
                title: "Registro Completado",
                description: "Tu cuenta ha sido creada exitosamente. Bienvenido a Pagnol.",
            });

            router.replace("/dashboard");

        } catch (err: any) {
            toast({
                variant: "destructive",
                title: "Error en el Registro",
                description: err.message || "Ocurrió un error inesperado.",
            });
        } finally {
            setIsSubmitting(false);
            setSubmitPhase('creating');
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="animate-spin text-pagnol-orange" size={40} />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Validando invitación...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex bg-white">
                <div className="hidden lg:flex flex-col justify-between w-[45%] bg-[#0F172A] p-12 relative overflow-hidden text-white">
                    <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-pagnol-orange/10 rounded-full blur-[100px] translate-y-1/4 -translate-x-1/4 pointer-events-none" />
                    <div className="relative z-10">
                        <div className="bg-white p-3 rounded-2xl inline-block">
                            <img src="/logo.png" alt="Pagnol" className="h-8 w-auto" />
                        </div>
                    </div>
                    <div className="relative z-10 space-y-4">
                        <h1 className="text-5xl font-black tracking-tighter leading-none">
                            Infraestructura<br />
                            <span className="text-pagnol-orange">Digital</span> Segura.
                        </h1>
                        <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md">
                            Acceso basado en invitación con token único verificado.
                        </p>
                    </div>
                    <div className="relative z-10 pt-12 border-t border-white/10">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-white/5 rounded-xl text-pagnol-orange">
                                <ShieldCheck size={24} />
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Datos protegidos</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-20">
                    <div className="w-full max-w-md space-y-8 animate-in slide-in-from-right-8 duration-700">
                        <div className="flex flex-col items-center text-center space-y-6">
                            <div className="p-4 bg-red-50 rounded-full text-red-500">
                                <AlertCircle size={40} />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-black uppercase text-slate-800">Invitación Inválida</h2>
                                <p className="text-sm text-slate-500 font-medium leading-relaxed">{error}</p>
                            </div>
                            <Button
                                className="w-full h-12 rounded-xl bg-pagnol-orange hover:bg-orange-600 text-white font-black uppercase tracking-widest text-xs"
                                onClick={() => router.push("/login")}
                            >
                                Ir al Login
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex bg-white">
            {/* Left Panel */}
            <div className="hidden lg:flex flex-col justify-between w-[45%] bg-[#0F172A] p-12 relative overflow-hidden text-white">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-pagnol-orange/10 rounded-full blur-[100px] translate-y-1/4 -translate-x-1/4 pointer-events-none" />

                <div className="relative z-10">
                    <div className="bg-white p-3 rounded-2xl inline-block">
                        <img src="/logo.png" alt="Pagnol" className="h-8 w-auto" />
                    </div>
                </div>

                <div className="relative z-10 space-y-6">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-6">
                        <ShieldCheck size={32} className="text-[#0F172A]" />
                    </div>
                    <h1 className="text-5xl font-black tracking-tighter leading-none">
                        Bienvenido al<br />
                        <span className="text-pagnol-orange">Equipo.</span>
                    </h1>
                    <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md">
                        Has sido invitado a unirte como{' '}
                        <span className="text-white font-bold uppercase">{invitation?.role}</span>{' '}
                        en <span className="text-white font-bold">{tenant?.name || 'la organización'}</span>.
                        Completa tu registro para acceder.
                    </p>
                </div>

                <div className="relative z-10 pt-12 border-t border-white/10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/5 rounded-xl text-pagnol-orange">
                            <ShieldCheck size={24} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Token Único Verificado</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Panel - Form */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-20 relative">
                <div className="w-full max-w-md space-y-8 animate-in slide-in-from-right-8 duration-700">

                    <div className="space-y-2">
                        <h2 className="text-3xl font-black tracking-tight text-[#204A57]">Completa tu Registro</h2>
                        <p className="text-slate-500 text-sm font-medium">Tu correo y rol han sido pre-configurados por tu organización.</p>
                    </div>

                    {/* Info de solo lectura */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                        <div className="flex items-center gap-3">
                            <Mail size={16} className="text-slate-300" />
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black uppercase text-slate-400">Email (Sólo lectura)</span>
                                <span className="text-xs font-black text-slate-600">{invitation?.email}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 pt-3 border-t border-slate-200/50">
                            <Building2 size={16} className="text-slate-300" />
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black uppercase text-slate-400">Organización</span>
                                <span className="text-xs font-black text-slate-600 uppercase">{tenant?.name}</span>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleRegister} className="space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tu Nombre Completo</Label>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                    <Input
                                        placeholder="Ej: Juan Pérez"
                                        className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-pagnol-orange/20 font-medium text-slate-900 placeholder:text-slate-400"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Crea tu Contraseña</Label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                    <Input
                                        type={showPassword ? "text" : "password"}
                                        placeholder="Mínimo 6 caracteres"
                                        className="pl-12 pr-12 h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-pagnol-orange/20 font-medium text-slate-900 placeholder:text-slate-400"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <Button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full h-12 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-100 transition-all active:scale-95"
                        >
                            {isSubmitting ? (
                                <div className="flex items-center gap-2">
                                    <Loader2 className="animate-spin" size={18} />
                                    <span>{submitPhase === 'logging_in' ? 'Iniciando sesión...' : 'Creando cuenta...'}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <span>Activar Mi Cuenta</span>
                                    <ArrowRight size={16} />
                                </div>
                            )}
                        </Button>
                    </form>

                    <p className="text-center text-[10px] uppercase font-bold text-slate-300 tracking-widest">
                        Soporte Técnico Enterprise &bull; support@pagnol.app
                    </p>
                </div>
            </div>
        </div>
    );
}
