"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/modules/core/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
    ArrowLeft, Lock, ShieldCheck, Eye, EyeOff,
    Loader2, CheckCircle, AlertTriangle,
} from "lucide-react";
import { z } from "zod";

const schema = z.object({
    password: z.string().min(8, "Mínimo 8 caracteres."),
    confirm: z.string(),
}).refine(d => d.password === d.confirm, {
    message: "Las contraseñas no coinciden.",
    path: ["confirm"],
});

type PageState = 'loading' | 'ready' | 'invalid' | 'done';

function UpdatePasswordInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();

    const [pageState, setPageState] = useState<PageState>('loading');
    const [invalidReason, setInvalidReason] = useState<string>('');
    const [isGoogleUser, setIsGoogleUser] = useState(false);
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        const init = async () => {
            // 1. Check for error in hash (e.g. #error=access_denied&error_code=otp_expired)
            //    This happens when Supabase falls back to site URL after a failed verification.
            const hash = typeof window !== 'undefined' ? window.location.hash : '';
            if (hash.includes('error=')) {
                const params = new URLSearchParams(hash.replace(/^#/, ''));
                const desc = params.get('error_description') ?? params.get('error') ?? 'Enlace inválido';
                const code = params.get('error_code') ?? '';
                const isExpired = code === 'otp_expired' || desc.toLowerCase().includes('expired');
                setInvalidReason(
                    isExpired
                        ? 'El enlace de recuperación expiró. Los enlaces son válidos por 1 hora.'
                        : decodeURIComponent(desc.replace(/\+/g, ' '))
                );
                setPageState('invalid');
                // Clean the hash so refreshing doesn't loop
                window.history.replaceState(null, '', window.location.pathname);
                return;
            }

            // 2. PKCE flow: Supabase appended ?code= to this URL
            const code = searchParams.get('code');
            if (code) {
                const { error } = await supabase.auth.exchangeCodeForSession(code);
                // Clean the code from the URL
                window.history.replaceState(null, '', '/update-password');
                if (error) {
                    setInvalidReason('El enlace de recuperación expiró o ya fue utilizado.');
                    setPageState('invalid');
                } else {
                    setPageState('ready');
                }
                return;
            }

            // 3. Implicit flow: PASSWORD_RECOVERY event or existing recovery session
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setPageState('ready');
                return;
            }

            const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
                if (event === 'PASSWORD_RECOVERY' && session?.user) {
                    setPageState('ready');
                    subscription.unsubscribe();
                }
            });

            // 4. No token found — give a brief window then show invalid
            const timeout = setTimeout(() => {
                setInvalidReason('No se encontró un enlace de recuperación válido. Solicita uno nuevo.');
                setPageState('invalid');
                subscription.unsubscribe();
            }, 2500);

            return () => { clearTimeout(timeout); subscription.unsubscribe(); };
        };

        init();
    }, [searchParams]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrors({});

        const result = schema.safeParse({ password, confirm });
        if (!result.success) {
            const fieldErrors: Record<string, string> = {};
            result.error.errors.forEach(err => {
                if (err.path[0]) fieldErrors[String(err.path[0])] = err.message;
            });
            setErrors(fieldErrors);
            return;
        }

        setLoading(true);
        try {
            const { isPasswordLeaked } = await import("@/lib/password-security");
            if (await isPasswordLeaked(password)) {
                toast({
                    variant: "destructive",
                    title: "Contraseña Comprometida",
                    description: "Esta contraseña fue expuesta en filtraciones conocidas. Elige una diferente.",
                });
                return;
            }

            const { error, data } = await supabase.auth.updateUser({ password });
            if (error) throw error;

            // Detect if this was a Google OAuth user setting a password for the first time
            const providers = (data?.user?.app_metadata?.providers as string[] | undefined) ?? [];
            setIsGoogleUser(providers.includes('google') && providers.length > 1);

            setPageState('done');
            await supabase.auth.signOut();
            setTimeout(() => router.push("/login"), 4000);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error al actualizar",
                description: error.message || "No se pudo actualizar la contraseña.",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex bg-white">
            {/* Left panel */}
            <div className="hidden lg:flex flex-col justify-between w-[45%] bg-[#0F172A] p-12 relative overflow-hidden text-white">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-pagnol-orange/10 rounded-full blur-[100px] translate-y-1/4 -translate-x-1/4 pointer-events-none" />
                <div className="relative z-10">
                    <Link href="/login" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
                        <ArrowLeft size={14} /> Volver al Login
                    </Link>
                </div>
                <div className="relative z-10 space-y-6">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-6">
                        <ShieldCheck size={32} className="text-[#0F172A]" />
                    </div>
                    <h1 className="text-5xl font-black tracking-tighter leading-none">
                        Nueva<br /><span className="text-pagnol-orange">Contraseña</span> Segura.
                    </h1>
                    <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md">
                        Establece una contraseña fuerte para proteger el acceso a tu operación.
                    </p>
                </div>
                <div className="relative z-10 pt-12 border-t border-white/10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/5 rounded-xl text-pagnol-orange"><ShieldCheck size={24} /></div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Datos protegidos</p>
                    </div>
                </div>
            </div>

            {/* Right panel */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-20">
                <div className="w-full max-w-md space-y-8 animate-in slide-in-from-right-8 duration-700">

                    {pageState === 'loading' && (
                        <div className="text-center space-y-4">
                            <Loader2 size={40} className="animate-spin mx-auto text-pagnol-orange" />
                            <p className="text-slate-500 text-sm font-medium">Verificando enlace...</p>
                        </div>
                    )}

                    {pageState === 'invalid' && (
                        <div className="text-center space-y-4">
                            <div className="flex justify-center">
                                <AlertTriangle size={56} className="text-amber-500" />
                            </div>
                            <h2 className="text-3xl font-black tracking-tight text-[#204A57]">Enlace Inválido</h2>
                            <p className="text-slate-500 text-sm font-medium max-w-sm mx-auto">
                                {invalidReason || 'El enlace de recuperación expiró o ya fue utilizado.'}
                            </p>
                            <div className="pt-2 space-y-3">
                                <Link href="/reset-password">
                                    <Button className="w-full h-11 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs">
                                        Solicitar nuevo enlace
                                    </Button>
                                </Link>
                                <Link href="/login" className="block text-center text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest">
                                    Volver al Login
                                </Link>
                            </div>
                        </div>
                    )}

                    {pageState === 'done' && (
                        <div className="text-center space-y-4">
                            <CheckCircle size={56} className="text-green-500 mx-auto" />
                            <h2 className="text-3xl font-black tracking-tight text-[#204A57]">¡Contraseña Actualizada!</h2>

                            {isGoogleUser ? (
                                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-left text-sm space-y-1">
                                    <p className="font-bold text-blue-800 text-[10px] uppercase tracking-widest">Cuenta Google detectada</p>
                                    <p className="text-blue-700">Ahora puedes ingresar tanto con <strong>Google</strong> como con tu <strong>correo + nueva contraseña</strong>.</p>
                                </div>
                            ) : (
                                <p className="text-slate-500 text-sm font-medium">Redirigiendo al login en unos segundos...</p>
                            )}

                            <Link href="/login" className="text-pagnol-orange text-sm font-bold hover:underline">
                                Ir al login ahora
                            </Link>
                        </div>
                    )}

                    {pageState === 'ready' && (
                        <>
                            <div className="space-y-2">
                                <h2 className="text-3xl font-black tracking-tight text-[#204A57]">Restablecer Contraseña</h2>
                                <p className="text-slate-500 text-sm font-medium">Ingresa tu nueva contraseña de acceso.</p>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nueva Contraseña</Label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                            <Input
                                                type={showPassword ? "text" : "password"}
                                                placeholder="••••••••"
                                                className="pl-12 pr-12 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                                                value={password}
                                                onChange={e => setPassword(e.target.value)}
                                                required
                                            />
                                            <button type="button" onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                        {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confirmar Contraseña</Label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                            <Input
                                                type={showConfirm ? "text" : "password"}
                                                placeholder="••••••••"
                                                className="pl-12 pr-12 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                                                value={confirm}
                                                onChange={e => setConfirm(e.target.value)}
                                                required
                                            />
                                            <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                                                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                        {errors.confirm && <p className="text-xs text-destructive">{errors.confirm}</p>}
                                    </div>
                                </div>

                                <Button
                                    type="submit"
                                    className="w-full h-12 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-100 transition-all active:scale-95"
                                    disabled={loading}
                                >
                                    {loading ? <Loader2 className="animate-spin" size={18} /> : "Actualizar Contraseña"}
                                </Button>
                            </form>

                            <p className="text-center text-[10px] uppercase font-bold text-slate-300 tracking-widest">
                                Soporte Técnico &bull; hola@teolabs.app
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function UpdatePasswordPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 size={40} className="animate-spin text-pagnol-orange" />
            </div>
        }>
            <UpdatePasswordInner />
        </Suspense>
    );
}
