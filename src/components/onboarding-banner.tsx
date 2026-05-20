
"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/modules/auth/useAuth';
import { supabase } from '@/modules/core/lib/supabase';
import { AlertCircle, UserPlus, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';

export function OnboardingBanner() {
    const { user, currentTenantId } = useAuth();
    const [missingRoles, setMissingRoles] = useState<string[]>([]);
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        if (!user || user.role !== 'administrador' || !currentTenantId) return;

        const controller = new AbortController();

        const fetchData = async () => {
            const { data: profiles, error } = await supabase
                .from('profiles')
                .select('role, id')
                .eq('tenant_id', currentTenantId)
                .abortSignal(controller.signal);

            if (error) {
                if (error.message?.includes('aborted')) return;
                console.error("Error fetching profiles for onboarding banner:", error.message, error.details, error.hint);
                return;
            }

            const administradors = profiles.filter(u => u.role === 'administrador' && u.id !== user.id).length;
            const supervisors = profiles.filter(u => u.role === 'supervisor').length;

            const missing = [];
            if (administradors === 0) missing.push("Administrador");
            if (supervisors === 0) missing.push("Supervisor");
            setMissingRoles(missing);
        };

        fetchData();

        const channel = supabase
            .channel(`onboarding-banner-${currentTenantId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'profiles',
                filter: `tenant_id=eq.${currentTenantId}`
            }, () => fetchData())
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR') {
                    console.warn("Realtime channel subscription failed for onboarding banner. Retrying...");
                }
            });

        return () => {
            controller.abort();
            supabase.removeChannel(channel);
        };
    }, [user, currentTenantId]);

    if (!user || user.role !== 'administrador' || missingRoles.length === 0 || !isVisible) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-slate-900 border-b border-white/10 relative overflow-hidden"
            >
                <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-pagnol-orange/10 rounded-full blur-[80px] pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                <div className="max-w-[1600px] mx-auto px-10 py-4 flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-pagnol-orange/20 text-pagnol-orange rounded-2xl animate-pulse">
                            <AlertCircle size={20} />
                        </div>
                        <div className="space-y-0.5">
                            <p className="text-[11px] font-black uppercase tracking-[0.1em] text-white">Configuración Recomendada Pendiente</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                                Falta crear roles críticos: <span className="text-pagnol-orange">{missingRoles.join(" y ")}</span>. Se recomienda delegar para un control eficiente.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            asChild
                            variant="outline"
                            className="bg-transparent border-white/10 text-white hover:bg-white/5 hover:border-white/20 rounded-xl h-10 px-6 font-black text-[9px] uppercase tracking-widest gap-2"
                        >
                            <Link href="/dashboard/pagnol/invitaciones">
                                <UserPlus size={14} className="text-pagnol-orange" />
                                Invitar Ahora
                            </Link>
                        </Button>
                        <button
                            onClick={() => setIsVisible(false)}
                            className="p-2 text-slate-500 hover:text-white transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
