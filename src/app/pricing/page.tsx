"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ChevronRight, Server, FileSpreadsheet, ArrowLeft, X, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ERP_OPTIONS = [
    'SAP',
    'Oracle',
    'Softland',
    'Microsoft Dynamics',
    'Infor',
    'Otro / Desarrollado a medida',
];

const API_OPTIONS = [
    { value: 'rest', label: 'REST API' },
    { value: 'rfc', label: 'SAP RFC / BAPI' },
    { value: 'sftp', label: 'SFTP / Archivos planos' },
    { value: 'webhook', label: 'Webhooks' },
    { value: 'no_se', label: 'No lo sé aún' },
];

export default function PricingPage() {
    const [erpDialogOpen, setErpDialogOpen] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState('');
    const [form, setForm] = useState({
        name: '',
        company: '',
        email: '',
        phone: '',
        erp: '',
        api: '',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSending(true);
        setSendError('');
        try {
            const res = await fetch('/api/contact/erp-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Error al enviar.');
            }
            setSubmitted(true);
        } catch (err: any) {
            setSendError(err.message || 'No se pudo enviar. Intenta nuevamente.');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-pagnol-orange selection:text-white">
            {/* Nav */}
            <nav className="flex items-center justify-between px-4 sm:px-8 py-6 max-w-7xl mx-auto border-b border-white/5">
                <div className="flex items-center gap-3">
                    <Link href="/" className="flex flex-col">
                        <h1 className="text-xl font-black tracking-tighter">PAGNOL</h1>
                        <p className="text-xs font-bold tracking-[0.2em] text-pagnol-orange">ASSET MANAGEMENT</p>
                    </Link>
                </div>
                <Button asChild variant="ghost" className="text-slate-400 hover:text-foreground">
                    <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" /> Volver al Inicio</Link>
                </Button>
            </nav>

            <div className="max-w-7xl mx-auto px-4 sm:px-8 py-16 md:py-24">
                <div className="text-center mb-16 space-y-4">
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight font-outfit uppercase">
                        ¿Cómo está tu empresa hoy?
                    </h1>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto font-medium">
                        Pagnol se adapta a tu realidad operacional. Elige la modalidad que mejor describe tu situación actual.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-16">

                    {/* OPCION 1: SIN ERP */}
                    <Card className="border-none shadow-2xl shadow-slate-200/50 bg-white rounded-[2.5rem] overflow-hidden flex flex-col relative group hover:shadow-primary/10 transition-all duration-500">
                        <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-slate-400 to-slate-200" />
                        <CardHeader className="p-10 pb-0">
                            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-700 mb-6 group-hover:bg-primary group-hover:text-white transition-all duration-300">
                                <FileSpreadsheet size={32} />
                            </div>
                            <CardTitle className="text-3xl font-black uppercase text-slate-900">Sin ERP</CardTitle>
                            <CardDescription className="text-base font-medium text-muted-foreground mt-4 leading-relaxed">
                                Gestionas tus activos con planillas, cuadernos o sin registro formal. Pagnol te da control total desde el primer día.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-10 flex-1">
                            <ul className="space-y-4">
                                {[
                                    "Carga masiva de activos desde Excel o CSV — sin reingreso manual.",
                                    "Clasificación y trazabilidad según estándares ISO 55000.",
                                    "Control de ubicación, responsables y estado en tiempo real.",
                                    "Generación de actas de entrega y documentos legales firmados.",
                                    "Historial completo de movimientos, préstamos y devoluciones.",
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 text-slate-600 font-medium">
                                        <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                                        <span className="text-sm">{item}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-8 flex items-center gap-3 bg-slate-50 rounded-2xl px-5 py-4">
                                <div className="text-2xl">📋</div>
                                <p className="text-xs text-slate-500 font-medium leading-snug">
                                    <span className="font-black text-slate-700">ISO 55000</span> — Trabajamos bajo el estándar internacional de gestión de activos físicos para garantizar trazabilidad y cumplimiento normativo.
                                </p>
                            </div>
                        </CardContent>
                        <CardFooter className="p-10 pt-0">
                            <Button
                                className="w-full py-6 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest hover:bg-slate-800 shadow-xl transition-all"
                                asChild
                            >
                                <Link href="/register?plan=stand-alone">
                                    Comenzar ahora <ChevronRight className="ml-2 h-4 w-4" />
                                </Link>
                            </Button>
                        </CardFooter>
                    </Card>

                    {/* OPCION 2: CON ERP */}
                    <Card className="border-none shadow-2xl shadow-orange-100/50 bg-white rounded-[2.5rem] overflow-hidden flex flex-col relative group hover:shadow-orange-200/50 transition-all duration-500 ring-4 ring-primary/5">
                        <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-orange-400 to-primary" />
                        <div className="absolute top-6 right-6 bg-orange-100 text-orange-700 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                            Recomendado
                        </div>
                        <CardHeader className="p-10 pb-0">
                            <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center text-primary mb-6 group-hover:bg-primary group-hover:text-white transition-all duration-300">
                                <Server size={32} />
                            </div>
                            <CardTitle className="text-3xl font-black uppercase text-slate-900">Con ERP</CardTitle>
                            <CardDescription className="text-base font-medium text-muted-foreground mt-4 leading-relaxed">
                                Tienes SAP, Oracle, Softland u otro sistema central, pero no llega a la bodega de terreno. Pagnol cubre esa "última milla".
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-10 flex-1">
                            <ul className="space-y-4">
                                {[
                                    "Integración bidireccional con tu ERP — sin doble digitación.",
                                    "Toda la información de terreno sincronizada en tiempo real.",
                                    "Clasificación experta de activos bajo estándares ISO 55000.",
                                    "Cumplimiento normativo y legal automatizado en faena.",
                                    "Reportería avanzada de mermas, pérdidas y uso real.",
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 text-slate-600 font-medium">
                                        <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                                        <span className="text-sm">{item}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-8 flex items-center gap-3 bg-orange-50 rounded-2xl px-5 py-4">
                                <div className="text-2xl">🔌</div>
                                <p className="text-xs text-slate-500 font-medium leading-snug">
                                    Para integrar tu ERP necesitamos algunos datos técnicos de tu sistema. Nuestro equipo te guiará en todo el proceso.
                                </p>
                            </div>
                        </CardContent>
                        <CardFooter className="p-10 pt-0">
                            <Button
                                className="w-full py-6 rounded-2xl bg-primary text-white font-black uppercase tracking-widest hover:bg-orange-600 shadow-xl shadow-orange-200 transition-all"
                                onClick={() => { setSubmitted(false); setErpDialogOpen(true); }}
                            >
                                Solicitar integración <ChevronRight className="ml-2 h-4 w-4" />
                            </Button>
                        </CardFooter>
                    </Card>

                </div>

                <div className="mt-20 text-center space-y-2">
                    <p className="text-slate-400 font-medium">¿Tienes dudas sobre cuál elegir?</p>
                    <p className="text-slate-400 text-sm">
                        Escríbenos a{' '}
                        <a href="mailto:hola@teolabs.app" className="text-primary font-bold hover:underline">
                            hola@teolabs.app
                        </a>
                    </p>
                </div>
            </div>

            {/* Dialog: solicitud integración ERP */}
            <Dialog open={erpDialogOpen} onOpenChange={setErpDialogOpen}>
                <DialogContent className="sm:max-w-lg rounded-3xl p-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight">
                            Conecta tu ERP
                        </DialogTitle>
                        <DialogDescription className="text-sm text-slate-500 mt-1">
                            Completa estos datos para que nuestro equipo prepare la integración con tu sistema.
                        </DialogDescription>
                    </DialogHeader>

                    {submitted ? (
                        <div className="text-center py-10 space-y-4">
                            <div className="text-5xl">✅</div>
                            <p className="font-black text-xl text-slate-800">¡Solicitud enviada!</p>
                            <p className="text-slate-500 text-sm">Te contactaremos en las próximas 24 horas hábiles.</p>
                            <Button
                                className="mt-4 rounded-2xl bg-primary text-white font-bold uppercase tracking-widest hover:bg-orange-600"
                                onClick={() => setErpDialogOpen(false)}
                            >
                                Cerrar
                            </Button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Nombre</Label>
                                    <Input
                                        required
                                        placeholder="Tu nombre"
                                        value={form.name}
                                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                        className="rounded-xl"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Empresa</Label>
                                    <Input
                                        required
                                        placeholder="Nombre de la empresa"
                                        value={form.company}
                                        onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                                        className="rounded-xl"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Email</Label>
                                    <Input
                                        required
                                        type="email"
                                        placeholder="correo@empresa.cl"
                                        value={form.email}
                                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                        className="rounded-xl"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Teléfono</Label>
                                    <Input
                                        placeholder="+56 9 XXXX XXXX"
                                        value={form.phone}
                                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                                        className="rounded-xl"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">¿Qué ERP utilizas?</Label>
                                <Select required onValueChange={v => setForm(f => ({ ...f, erp: v }))}>
                                    <SelectTrigger className="rounded-xl">
                                        <SelectValue placeholder="Selecciona tu ERP" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ERP_OPTIONS.map(opt => (
                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">¿Qué tipo de conexión tiene disponible?</Label>
                                <Select onValueChange={v => setForm(f => ({ ...f, api: v }))}>
                                    <SelectTrigger className="rounded-xl">
                                        <SelectValue placeholder="Tipo de integración" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {API_OPTIONS.map(opt => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {sendError && (
                                <p className="text-red-500 text-xs font-medium text-center">{sendError}</p>
                            )}
                            <Button
                                type="submit"
                                disabled={sending}
                                className="w-full py-6 rounded-2xl bg-primary text-white font-black uppercase tracking-widest hover:bg-orange-600 shadow-xl shadow-orange-200 transition-all mt-2 disabled:opacity-60"
                            >
                                <Send className="mr-2 h-4 w-4" />
                                {sending ? 'Enviando...' : 'Enviar solicitud'}
                            </Button>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
