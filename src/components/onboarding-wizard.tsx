
"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/modules/auth/useAuth';
import { supabase } from '@/modules/core/lib/supabase';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    CheckCircle2,
    Users,
    UserPlus,
    ShieldCheck,
    ArrowRight,
    Construction,
    Building2,
    LayoutDashboard,
    AlertTriangle,
    Mail,
    ChevronRight,
    ChevronLeft
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export function OnboardingWizard() {
    const { user, currentTenantId } = useAuth();
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [step, setStep] = useState(1);
    const [stats, setStats] = useState({ admins: 0, supervisors: 0 });
    const [loading, setLoading] = useState(true);
    const [tenantName, setTenantName] = useState('');

    useEffect(() => {
        const tenantId = user?.tenantId || currentTenantId;
        if (!tenantId) return;
        supabase
            .from('tenants')
            .select('name')
            .eq('id', tenantId)
            .maybeSingle()
            .then(({ data }) => { if (data?.name) setTenantName(data.name); });
    }, [user?.tenantId, currentTenantId]);

    // Only show for admins who haven't completed onboarding
    useEffect(() => {
        if (user && user.role === 'administrador' && !user.onboardingCompleted) {
            setIsOpen(true);
            checkRoles();
        }
    }, [user]);

    const checkRoles = async () => {
        if (!currentTenantId) return;
        const { data: users, error } = await supabase
            .from('profiles')
            .select('role, id')
            .eq('tenant_id', currentTenantId);

        if (error) {
            console.error("Error checking roles for onboarding wizard:", error);
            return;
        }

        const admins = users.filter(u => u.role === 'administrador' && u.id !== user?.id).length;
        const supervisors = users.filter(u => u.role === 'supervisor').length;

        setStats({ admins, supervisors });
        setLoading(false);
    };

    const completeOnboarding = async () => {
        if (!user?.id) return;
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ onboarding_completed: true })
                .eq('id', user.id);

            if (error) throw error;
            setIsOpen(false);
        } catch (error) {
            console.error("Error completing onboarding:", error);
        }
    };

    const nextStep = () => setStep(prev => prev + 1);
    const prevStep = () => setStep(prev => prev - 1);

    if (user?.role !== 'administrador' || user.onboardingCompleted) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="max-w-2xl rounded-[3rem] border-none shadow-2xl p-0 overflow-hidden bg-slate-50">
                <DialogTitle className="sr-only">Onboarding {tenantName}</DialogTitle>
                <div className="flex flex-col h-[600px]">
                    {/* Header with progress */}
                    <div className="p-8 bg-white border-b flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-pagnol-orange/10 text-pagnol-orange rounded-2xl">
                                <ShieldCheck size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-black uppercase font-outfit text-slate-800 tracking-tight">Onboarding {tenantName}</h2>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Configuración</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            {[1, 2, 3].map(i => (
                                <div key={i} className={`h-1.5 rounded-full transition-all ${step >= i ? 'w-8 bg-pagnol-orange' : 'w-2 bg-slate-100'}`} />
                            ))}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-10 overflow-hidden">
                        <AnimatePresence mode="wait">
                            {step === 1 && (
                                <motion.div
                                    key="step1"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="space-y-8 h-full flex flex-col justify-center"
                                >
                                    <div className="space-y-4 text-center md:text-left">
                                        <h3 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">
                                            ¡Hola, {user?.name?.split(' ')[0] || 'Usuario'}! <br />
                                            <span className="text-pagnol-orange">Bienvenido a Pagnol APP</span>
                                        </h3>
                                        <p className="text-slate-500 font-medium leading-relaxed">
                                            Como Administrador de Aplicación, tienes el control total. Antes de empezar, necesitamos asegurar que tu estructura de mando esté configurada correctamente para delegar responsabilidades.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm space-y-3">
                                            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl w-fit"><ShieldCheck size={20} /></div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tu Rol actual</p>
                                            <p className="text-sm font-black text-slate-800 uppercase tracking-tight">Application Admin</p>
                                        </div>
                                        <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm space-y-3">
                                            <div className="p-3 bg-orange-50 text-pagnol-orange rounded-2xl w-fit"><Building2 size={20} /></div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Organización</p>
                                            <p className="text-sm font-black text-slate-800 uppercase tracking-tight truncate">{tenantName}</p>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {step === 2 && (
                                <motion.div
                                    key="step2"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="space-y-6 h-full flex flex-col justify-center"
                                >
                                    <div className="space-y-2">
                                        <h3 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Delegar es la Clave</h3>
                                        <p className="text-sm text-slate-500 font-medium">Recomendamos que no gestiones todo solo. El sistema Pagnol funciona mejor con roles clave definidos.</p>
                                    </div>

                                    <div className="space-y-3">
                                        <div className={`p-5 rounded-3xl border-2 transition-all flex items-center justify-between ${stats.admins > 0 ? 'border-green-100 bg-green-50/30' : 'border-slate-100 bg-white'}`}>
                                            <div className="flex items-center gap-4">
                                                <div className={`p-4 rounded-2xl ${stats.admins > 0 ? 'bg-green-100 text-green-600' : 'bg-slate-50 text-slate-400'}`}>
                                                    <Users size={24} />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black uppercase text-slate-700">Administradores</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Apoyo en gestión de usuarios y activos</p>
                                                </div>
                                            </div>
                                            {stats.admins > 0 ? <CheckCircle2 className="text-green-500" size={24} /> : <AlertTriangle className="text-amber-500" size={24} />}
                                        </div>

                                        <div className={`p-5 rounded-3xl border-2 transition-all flex items-center justify-between ${stats.supervisors > 0 ? 'border-green-100 bg-green-50/30' : 'border-slate-100 bg-white'}`}>
                                            <div className="flex items-center gap-4">
                                                <div className={`p-4 rounded-2xl ${stats.supervisors > 0 ? 'bg-green-100 text-green-600' : 'bg-slate-50 text-slate-400'}`}>
                                                    <Construction size={24} />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black uppercase text-slate-700">Supervisores en Faena</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Encargados de solicitar materiales y herramientas</p>
                                                </div>
                                            </div>
                                            {stats.supervisors > 0 ? <CheckCircle2 className="text-green-500" size={24} /> : <AlertTriangle className="text-amber-500" size={24} />}
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {step === 3 && (
                                <motion.div
                                    key="step3"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="space-y-8 h-full flex flex-col justify-center"
                                >
                                    <div className="text-center space-y-4">
                                        <div className="h-20 w-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                            <CheckCircle2 size={40} />
                                        </div>
                                        <h3 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">¡Todo Listo!</h3>
                                        <p className="text-slate-500 font-medium max-w-sm mx-auto">
                                            Recuerda que si faltan roles clave, verás un recordatorio en tu Panel Central. ¡Crezcamos juntos!
                                        </p>
                                    </div>

                                    <Button
                                        onClick={async () => {
                                            await completeOnboarding();
                                            router.push('/dashboard/pagnol/invitaciones');
                                        }}
                                        variant="outline"
                                        className="w-full h-14 rounded-2xl border-2 border-slate-100 hover:border-pagnol-orange hover:bg-orange-50 font-black text-[10px] uppercase tracking-[0.2em] group transition-all"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Mail size={18} className="text-slate-400 group-hover:text-pagnol-orange transition-colors" />
                                            <span>Ir a Invitar Equipo Ahora</span>
                                            <ChevronRight size={16} />
                                        </div>
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Footer Actions */}
                    <div className="p-8 bg-white border-t flex items-center justify-between">
                        {step > 1 ? (
                            <Button variant="ghost" onClick={prevStep} className="font-black text-[10px] uppercase tracking-widest gap-2 h-12 px-6 rounded-2xl">
                                <ChevronLeft size={16} /> Atrás
                            </Button>
                        ) : <div />}

                        {step < 3 ? (
                            <Button
                                onClick={nextStep}
                                className="bg-slate-900 hover:bg-black text-white font-black text-[10px] uppercase tracking-widest gap-2 h-12 px-8 rounded-2xl shadow-xl transition-all"
                            >
                                Siguiente <ChevronRight size={16} />
                            </Button>
                        ) : (
                            <Button
                                onClick={completeOnboarding}
                                className="bg-pagnol-orange hover:bg-orange-600 text-white font-black text-[10px] uppercase tracking-widest gap-2 h-12 px-10 rounded-2xl shadow-xl shadow-orange-100 transition-all"
                            >
                                Finalizar <ArrowRight size={16} />
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
