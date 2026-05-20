"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/modules/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/modules/core/hooks/use-toast";
import { ArrowLeft, Mail, ShieldCheck, Loader2, CheckCircle } from "lucide-react";

export default function ResetPasswordPage() {
    const [email, setEmail] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sent, setSent] = useState(false);
    const { sendPasswordReset } = useAuth();
    const { toast } = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) {
            toast({
                variant: "destructive",
                title: "Campo requerido",
                description: "Por favor, ingresa tu correo electrónico.",
            });
            return;
        }
        setIsSubmitting(true);
        try {
            await sendPasswordReset(email);
            setSent(true);
        } catch {
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo enviar el correo. Verifica que sea correcto.",
            });
        } finally {
            setIsSubmitting(false);
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
                        Recupera<br />
                        Tu <span className="text-pagnol-orange">Acceso</span>.
                    </h1>
                    <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md">
                        Te enviaremos un enlace seguro para restablecer tu contraseña operativa.
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

                    {sent ? (
                        <div className="text-center space-y-4">
                            <div className="flex justify-center">
                                <CheckCircle size={56} className="text-green-500" />
                            </div>
                            <h2 className="text-3xl font-black tracking-tight text-[#204A57]">Correo Enviado</h2>
                            <p className="text-slate-500 text-sm font-medium max-w-sm mx-auto">
                                Revisa tu bandeja de entrada en <span className="font-bold text-slate-700">{email}</span> y haz clic en el enlace de recuperación.
                            </p>
                            <Link href="/login" className="inline-block mt-4 text-pagnol-orange text-sm font-bold hover:underline">
                                Volver al inicio de sesión
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <h2 className="text-3xl font-black tracking-tight text-[#204A57]">¿Olvidaste tu contraseña?</h2>
                                <p className="text-slate-500 text-sm font-medium">Ingresa tu correo y te enviaremos un enlace de recuperación.</p>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Correo Electrónico</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="usuario@empresa.cl"
                                            className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                            disabled={isSubmitting}
                                            required
                                        />
                                    </div>
                                </div>

                                <Button
                                    type="submit"
                                    className="w-full h-12 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-100 transition-all active:scale-95"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting
                                        ? <Loader2 className="animate-spin" size={18} />
                                        : "Enviar Enlace de Recuperación"
                                    }
                                </Button>
                            </form>

                            <div className="text-center">
                                <Link href="/login" className="inline-flex items-center gap-2 text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors">
                                    <ArrowLeft size={12} /> Volver al Login
                                </Link>
                            </div>

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
