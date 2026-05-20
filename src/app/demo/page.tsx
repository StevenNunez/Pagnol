"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/modules/core/lib/supabase';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DemoPage() {
    const router = useRouter();
    const [error, setError] = useState('');

    useEffect(() => {
        const startDemo = async () => {
            try {
                const res = await fetch('/api/demo', { method: 'POST' });
                const data = await res.json();

                if (!res.ok) {
                    setError(data.error || 'No se pudo iniciar el demo.');
                    return;
                }

                const { error: sessionError } = await supabase.auth.setSession({
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                });

                if (sessionError) {
                    setError('Error al establecer la sesión demo.');
                    return;
                }

                router.replace('/dashboard');
            } catch {
                setError('Error de conexión. Intenta nuevamente.');
            }
        };

        startDemo();
    }, [router]);

    return (
        <div className="min-h-screen bg-[#0F172A] flex flex-col items-center justify-center text-white relative overflow-hidden">
            {/* Background glows */}
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center gap-8 text-center px-6">
                {/* Logo */}
                <div className="flex flex-col items-center">
                    <h1 className="text-4xl font-black tracking-tighter">PAGNOL</h1>
                    <p className="text-[10px] font-bold tracking-[0.3em] text-primary mt-1">ASSET MANAGEMENT</p>
                </div>

                {error ? (
                    <div className="space-y-6 max-w-sm">
                        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-6 py-5 space-y-2">
                            <p className="text-sm font-bold text-red-400">No se pudo iniciar el demo</p>
                            <p className="text-xs text-slate-400">{error}</p>
                        </div>
                        <div className="flex flex-col gap-3">
                            <Button
                                onClick={() => { setError(''); window.location.reload(); }}
                                className="rounded-xl bg-primary hover:bg-orange-600 font-black uppercase tracking-widest text-xs"
                            >
                                Reintentar
                            </Button>
                            <Button asChild variant="ghost" className="text-slate-400 hover:text-white text-xs">
                                <Link href="/"><ArrowLeft className="mr-2 h-3 w-3" /> Volver al Inicio</Link>
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6 max-w-sm">
                        <div className="flex flex-col items-center gap-4">
                            <div className="relative">
                                <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
                                    <Loader2 size={28} className="text-primary animate-spin" />
                                </div>
                                <div className="absolute inset-0 rounded-2xl bg-primary/10 animate-ping" />
                            </div>
                            <div className="space-y-1">
                                <p className="font-black text-xl tracking-tight">Preparando tu Demo</p>
                                <p className="text-slate-400 text-sm font-medium">
                                    Cargando entorno de demostración con datos reales de faena...
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 w-full">
                            {['Activos', 'Personal', 'Informes'].map((item, i) => (
                                <div
                                    key={item}
                                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-center animate-pulse"
                                    style={{ animationDelay: `${i * 200}ms` }}
                                >
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item}</p>
                                </div>
                            ))}
                        </div>

                        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">
                            Acceso de solo lectura · Sin datos reales
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
