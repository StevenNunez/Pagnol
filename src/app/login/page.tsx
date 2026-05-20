'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    ArrowLeft,
    ShieldCheck,
    Lock,
    User,
    ArrowRight,
    Loader2,
    Eye,
    EyeOff
} from 'lucide-react';
import { supabase } from '@/modules/core/lib/supabase';

export default function LoginPage() {
    const { login, user, authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [loginPhase, setLoginPhase] = useState<'credentials' | 'profile'>('credentials');
    const [showPassword, setShowPassword] = useState(false);
    const [oauthLoading, setOauthLoading] = useState(false);

    React.useEffect(() => {
        if (!authLoading && user) router.replace('/dashboard');
    }, [user, authLoading, router]);

    const handleGoogleLogin = async () => {
        setOauthLoading(true);
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
            setOauthLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setLoginPhase('credentials');
        try {
            await login(identifier, password);
            setLoginPhase('profile');
            router.replace('/dashboard');
        } catch (error: any) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Error de acceso",
                description: error.message || "Credenciales inválidas.",
            });
            setLoading(false);
            setLoginPhase('credentials');
        }
    };

    return (
        <div className="min-h-screen flex bg-white">
            {/* Left Panel - Dark & Industrial */}
            <div className="hidden lg:flex flex-col justify-between w-[45%] bg-[#0F172A] p-12 relative overflow-hidden text-white">
                {/* Abstract Backgrounds */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-pagnol-orange/10 rounded-full blur-[100px] translate-y-1/4 -translate-x-1/4 pointer-events-none" />

                {/* Header */}
                <div className="relative z-10">
                    <Link href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
                        <ArrowLeft size={14} /> Volver al Inicio
                    </Link>
                </div>

                {/* Main Content */}
                <div className="relative z-10 space-y-6">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-6">
                        {/* Logo Placeholder or User provided logo */}
                        <ShieldCheck size={32} className="text-[#0F172A]" />
                    </div>

                    <h1 className="text-5xl font-black tracking-tighter leading-none">
                        Infraestructura<br />
                        <span className="text-pagnol-orange">Digital</span> Segura.
                    </h1>

                    <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md">
                        Inicie sesión para acceder al panel de control de activos y gestión de pañol en tiempo real.
                        Todas las operaciones son auditadas.
                    </p>
                </div>

                {/* Footer / Certifications */}
                <div className="relative z-10 pt-12 border-t border-white/10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/5 rounded-xl text-pagnol-orange">
                            <ShieldCheck size={24} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Datos protegidos</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Panel - Login Form */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-20 relative">
                <div className="w-full max-w-md space-y-8 animate-in slide-in-from-right-8 duration-700">

                    <div className="space-y-2">
                        <h2 className="text-3xl font-black tracking-tight text-[#204A57]">Bienvenido</h2>
                        <p className="text-slate-500 text-sm font-medium">Ingrese sus credenciales operativas para continuar.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="identifier" className="text-[10px] font-black uppercase tracking-widest text-slate-400">RUT o Correo Electrónico</Label>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                    <Input
                                        id="identifier"
                                        placeholder="12.345.678-9 o correo@empresa.cl"
                                        className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-pagnol-orange/20 font-medium"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contraseña</Label>
                                    <Link href="/reset-password" className="text-[10px] font-bold text-pagnol-orange hover:underline uppercase tracking-wide">¿Olvidó su clave?</Link>
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                    <Input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="••••••••"
                                        className="pl-12 pr-12 h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-pagnol-orange/20 font-medium"
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
                            className="w-full h-12 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-100 transition-all active:scale-95 space-x-2"
                            disabled={loading}
                        >
                            {loading ? (
                                <div className="flex items-center gap-2">
                                    <Loader2 className="animate-spin" size={18} />
                                    <span>{loginPhase === 'profile' ? 'Cargando perfil...' : 'Verificando...'}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <span>Acceder al Pañol</span>
                                    <ArrowRight size={16} />
                                </div>
                            )}
                        </Button>
                    </form>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-100"></span></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-4 text-slate-300 font-bold tracking-widest">O continuar con</span></div>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleGoogleLogin}
                        disabled={oauthLoading}
                        className="w-full h-12 border-slate-200 rounded-xl font-black uppercase tracking-widest text-xs text-slate-700 hover:bg-slate-50 transition-all active:scale-95 flex items-center justify-center gap-3"
                    >
                        {oauthLoading ? <Loader2 size={18} className="animate-spin" /> : (
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                        )}
                        Continuar con Google
                    </Button>

                    <p className="text-center text-sm text-slate-400">
                        ¿No tienes cuenta?{' '}
                        <Link href="/register" className="font-bold text-pagnol-orange hover:underline">
                            Registrar empresa
                        </Link>
                    </p>

                    <p className="text-center text-[10px] uppercase font-bold text-slate-300 tracking-widest mt-4">
                        Soporte Técnico Enterprise &bull; support@pagnol.app
                    </p>
                </div>
            </div>
        </div>
    );
}
