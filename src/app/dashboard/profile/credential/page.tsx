"use client";

import React, { useMemo } from 'react';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Download,
    ArrowLeft,
    ShieldCheck,
    Building2,
    QrCode,
    Camera
} from 'lucide-react';
import QRCode from "react-qr-code";
import Link from 'next/link';

export default function DigitalCredentialPage() {
    const { user } = useAuth();

    const qrValue = useMemo(() => {
        return user?.id || "unknown";
    }, [user]);

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20 p-4">
            {/* Header / Back */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" asChild className="text-muted-foreground hover:text-pagnol-orange transition-colors">
                    <Link href="/dashboard" className="flex items-center gap-2">
                        <ArrowLeft size={16} /> Volver al inicio
                    </Link>
                </Button>
                <div className="text-right">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-none">Identidad Digital</p>
                    <p className="text-sm font-bold text-pagnol-orange">Ecosistema Pagnol</p>
                </div>
            </div>

            <div className="flex flex-col items-center gap-10">
                {/* --- CREDENTIAL CARD --- */}
                <div className="w-full max-w-[350px] aspect-[1/1.6] bg-slate-900 rounded-[2.5rem] shadow-2xl overflow-hidden relative group transition-transform hover:scale-[1.02] duration-500 print:shadow-none print:scale-100">
                    {/* Decorative Elements */}
                    <div className="absolute top-0 left-0 w-full h-1/3 bg-gradient-to-br from-pagnol-orange/20 to-transparent pointer-events-none" />
                    <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-pagnol-orange/10 rounded-full blur-3xl" />

                    <div className="relative h-full flex flex-col p-8">
                        {/* Header Branding */}
                        <div className="flex justify-between items-start mb-8">
                            <div className="flex flex-col">
                                <span className="text-2xl font-black tracking-tighter text-white leading-none">PAGNOL</span>
                                <span className="text-[8px] font-bold tracking-[0.2em] text-pagnol-orange">ASSET MANAGEMENT</span>
                            </div>
                            <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                                <ShieldCheck size={20} className="text-pagnol-orange" />
                            </div>
                        </div>

                        {/* User Avatar Placeholder or Real Avatar */}
                        <div className="flex flex-col items-center gap-4 mb-6">
                            <div className="w-32 h-32 rounded-3xl bg-slate-800 border-4 border-slate-700 shadow-xl overflow-hidden flex items-center justify-center relative">
                                {user?.kyc_face_image ? (
                                    <img src={user.kyc_face_image} alt={user.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-4xl font-black text-slate-600 uppercase">
                                        {user?.name?.[0] || 'U'}
                                    </div>
                                )}
                                <div className="absolute bottom-1 right-1 p-1.5 bg-pagnol-orange rounded-lg">
                                    <Camera size={12} className="text-white" />
                                </div>
                            </div>
                            <div className="text-center">
                                <h2 className="text-xl font-black uppercase text-white tracking-tight leading-tight">{user?.name}</h2>
                                <p className="text-[10px] font-bold text-pagnol-orange uppercase tracking-widest mt-1">{user?.cargo || 'Trabajador'}</p>
                            </div>
                        </div>

                        {/* QR Code Section */}
                        <div className="mt-auto bg-white p-4 rounded-[2rem] shadow-inner flex flex-col items-center gap-3">
                            <div className="p-2 bg-white rounded-xl">
                                <QRCode
                                    value={qrValue}
                                    size={140}
                                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                    viewBox={`0 0 256 256`}
                                />
                            </div>
                            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">ID: {user?.rut || user?.id?.substring(0, 10)}</p>
                        </div>

                        <div className="mt-6 flex justify-between items-center text-white/40">
                            <div className="flex items-center gap-2">
                                <Building2 size={12} />
                                <span className="text-[8px] font-bold uppercase tracking-widest">Inquilino Autorizado</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions & Instructions */}
            <div className="w-full space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <Button onClick={handlePrint} className="h-14 rounded-2xl bg-white text-slate-900 border-2 border-slate-100 hover:bg-slate-50 transition-all font-black uppercase text-[10px] tracking-widest group shadow-sm">
                        <Download size={18} className="mr-2 group-hover:-translate-y-1 transition-transform" /> Descargar PDF
                    </Button>
                    <Button className="h-14 rounded-2xl bg-slate-900 text-white hover:bg-black transition-all font-black uppercase text-[10px] tracking-widest group shadow-xl">
                        <QrCode size={18} className="mr-2" /> Compartir QR
                    </Button>
                </div>

                <Card className="border-none shadow-xl shadow-slate-200/50 bg-white rounded-[2rem] overflow-hidden">
                    <CardContent className="p-8 space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-pagnol-orange/10 rounded-xl text-pagnol-orange shrink-0">
                                <QrCode size={20} />
                            </div>
                            <div>
                                <h4 className="font-black uppercase text-sm text-slate-800">Uso en Pañol</h4>
                                <p className="text-xs font-semibold text-muted-foreground leading-relaxed mt-1">
                                    Presenta este código en el escáner de bodega para retirar herramientas o autorizar transacciones.
                                </p>
                            </div>
                        </div>
                        <div className="border-t border-slate-50 pt-4 flex items-start gap-4">
                            <div className="p-3 bg-blue-50 rounded-xl text-blue-600 shrink-0">
                                <ShieldCheck size={20} />
                            </div>
                            <div>
                                <h4 className="font-black uppercase text-sm text-slate-800">Control de Acceso</h4>
                                <p className="text-xs font-semibold text-muted-foreground leading-relaxed mt-1">
                                    Válido para el registro de asistencia diaria mediante tótems de identificación.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Print specific styles */}
            <style jsx global>{`
                @media print {
                    nav, button, .no-print {
                        display: none !important;
                    }
                    body {
                        background: white !important;
                    }
                }
            `}</style>
        </div>
    );
}
