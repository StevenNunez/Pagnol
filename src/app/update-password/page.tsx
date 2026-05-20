"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/modules/core/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/modules/core/hooks/use-toast";
import { ArrowLeft, Lock, ShieldCheck, Eye, EyeOff, Loader2, CheckCircle } from "lucide-react";
import { z } from "zod";

const schema = z.object({
    password: z.string().min(8, "Mínimo 8 caracteres."),
    confirm: z.string(),
}).refine(d => d.password === d.confirm, {
    message: "Las contraseñas no coinciden.",
    path: ["confirm"],
});

export default function UpdatePasswordPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        // Supabase sets the session from the URL hash automatically on page load
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === "PASSWORD_RECOVERY") {
                // User is in recovery mode — ready to update password
            }
        });
        return () => subscription.unsubscribe();
    }, []);

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

            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;

            setDone(true);
            setTimeout(() => router.push("/login"), 3000);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "No se pudo actualizar la contraseña.",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex bg-white">
            {/* Left Panel */}
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
                        Nueva<br />
                        <span className="text-pagnol-orange">Contraseña</span> Segura.
                    </h1>
                    <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md">
                        Establece una contraseña fuerte para proteger el acceso a los activos de tu operación.
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

            {/* Right Panel */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-20">
                <div className="w-full max-w-md space-y-8 animate-in slide-in-from-right-8 duration-700">

                    {done ? (
                        <div className="text-center space-y-4">
                            <div className="flex justify-center">
                                <CheckCircle size={56} className="text-green-500" />
                            </div>
                            <h2 className="text-3xl font-black tracking-tight text-[#204A57]">¡Contraseña Actualizada!</h2>
                            <p className="text-slate-500 text-sm font-medium">Serás redirigido al inicio de sesión en unos segundos.</p>
                            <Link href="/login" className="text-pagnol-orange text-sm font-bold hover:underline">
                                Ir al login ahora
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <h2 className="text-3xl font-black tracking-tight text-[#204A57]">Restablecer Contraseña</h2>
                                <p className="text-slate-500 text-sm font-medium">Ingresa tu nueva contraseña de acceso.</p>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nueva Contraseña</Label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                            <Input
                                                id="password"
                                                type={showPassword ? "text" : "password"}
                                                placeholder="••••••••"
                                                className="pl-12 pr-12 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                                                value={password}
                                                onChange={e => setPassword(e.target.value)}
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
                                        {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="confirm" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confirmar Contraseña</Label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                            <Input
                                                id="confirm"
                                                type={showConfirm ? "text" : "password"}
                                                placeholder="••••••••"
                                                className="pl-12 pr-12 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                                                value={confirm}
                                                onChange={e => setConfirm(e.target.value)}
                                                required
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowConfirm(!showConfirm)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                                            >
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
                                Soporte Técnico Enterprise &bull; support@pagnol.app
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
