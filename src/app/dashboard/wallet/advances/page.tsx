"use client";

import React, { useMemo } from 'react';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Clock,
    CheckCircle2,
    XCircle,
    HandCoins,
    Calendar,
    ArrowLeft,
    TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function WorkerAdvancesPage() {
    const { salaryAdvances } = useAppState();
    const { user } = useAuth();

    const myAdvances = useMemo(() => {
        if (!user || !salaryAdvances) return [];
        return salaryAdvances
            .filter(adv => adv.workerId === user.id)
            .sort((a, b) => new Date(b.requestedAt as any).getTime() - new Date(a.requestedAt as any).getTime());
    }, [user, salaryAdvances]);

    const stats = useMemo(() => {
        const total = myAdvances.length;
        const approved = myAdvances.filter(a => a.status === 'approved').reduce((acc, curr) => acc + curr.amount, 0);
        const pending = myAdvances.filter(a => a.status === 'pending').length;
        return { total, approved, pending };
    }, [myAdvances]);

    const formatCLP = (amount: number) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    };

    const formatDate = (date: any) => {
        if (!date) return '-';
        const d = date instanceof Date ? date : new Date(date);
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved':
                return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none px-3 rounded-full flex gap-1 items-center"><CheckCircle2 size={12} /> Aprobado</Badge>;
            case 'rejected':
                return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-none px-3 rounded-full flex gap-1 items-center"><XCircle size={12} /> Rechazado</Badge>;
            default:
                return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-none px-3 rounded-full flex gap-1 items-center"><Clock size={12} /> Pendiente</Badge>;
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header / Back */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" asChild className="text-muted-foreground hover:text-pagnol-orange transition-colors">
                    <Link href="/dashboard/wallet" className="flex items-center gap-2">
                        <ArrowLeft size={16} /> Volver a mi billetera
                    </Link>
                </Button>
                <div className="text-right hidden sm:block">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Protocolo de Adelantos</p>
                    <p className="text-sm font-bold text-pagnol-orange">Estado de Operaciones</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-none shadow-sm bg-white overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl group-hover:scale-110 transition-transform">
                                <TrendingUp size={24} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Monto Aprobado</p>
                                <p className="text-xl font-black">{formatCLP(stats.approved)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-none shadow-sm bg-white overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-orange-50 text-orange-600 rounded-2xl group-hover:scale-110 transition-transform">
                                <Clock size={24} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">En Revisión</p>
                                <p className="text-xl font-black">{stats.pending} Solicitudes</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-none shadow-sm bg-white overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-slate-50 text-slate-600 rounded-2xl group-hover:scale-110 transition-transform">
                                <HandCoins size={24} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Total Solicitudes</p>
                                <p className="text-xl font-black">{stats.total}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-none shadow-xl shadow-slate-200/50 bg-white rounded-[2.5rem] overflow-hidden">
                <CardHeader className="px-8 pt-10 pb-4">
                    <CardTitle className="text-2xl font-black uppercase font-outfit text-slate-800">Historial de Adelantos</CardTitle>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Listado Cronológico de Solicitudes</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-50/50 border-y border-slate-100">
                                    <th className="px-8 py-4 text-left text-[10px] font-black text-slate-600 uppercase tracking-widest">Fecha</th>
                                    <th className="px-8 py-4 text-left text-[10px] font-black text-slate-600 uppercase tracking-widest">Monto</th>
                                    <th className="px-8 py-4 text-left text-[10px] font-black text-slate-600 uppercase tracking-widest">Estado</th>
                                    <th className="px-8 py-4 text-left text-[10px] font-black text-slate-600 uppercase tracking-widest">Aprobado Por</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {myAdvances.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-8 py-20 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-200">
                                                    <HandCoins size={32} />
                                                </div>
                                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">No has realizado solicitudes de adelanto aún</p>
                                                <Button asChild variant="outline" className="rounded-xl border-slate-200 text-slate-600 hover:border-pagnol-orange hover:text-pagnol-orange transition-all">
                                                    <Link href="/dashboard/wallet">Solicitar Primero</Link>
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    myAdvances.map((adv) => (
                                        <tr key={adv.id} className="group hover:bg-slate-50/50 transition-colors">
                                            <td className="px-8 py-6">
                                                <div className="flex items-center gap-3">
                                                    <Calendar className="text-slate-300" size={16} />
                                                    <span className="font-bold text-slate-700">{formatDate(adv.requestedAt)}</span>
                                                </div>
                                            </td>
                                            <td className="px-8 py-6">
                                                <span className="text-lg font-black text-slate-800 font-outfit">{formatCLP(adv.amount)}</span>
                                            </td>
                                            <td className="px-8 py-6">
                                                {getStatusBadge(adv.status)}
                                                {adv.status === 'rejected' && adv.rejectionReason && (
                                                    <p className="text-[9px] font-bold text-red-400 mt-1 uppercase max-w-[150px] line-clamp-1">{adv.rejectionReason}</p>
                                                )}
                                            </td>
                                            <td className="px-8 py-6">
                                                {adv.approverName ? (
                                                    <div className="flex items-center gap-2">
                                                        <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center text-[8px] font-black text-muted-foreground uppercase">
                                                            {adv.approverName[0]}
                                                        </div>
                                                        <span className="text-[11px] font-bold text-muted-foreground uppercase">{adv.approverName}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest italic">En espera</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Hint Footnote */}
            <div className="p-8 bg-slate-900 rounded-[2.5rem] text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
                <div className="flex items-center gap-6">
                    <div className="h-16 w-16 bg-pagnol-orange rounded-[1.5rem] flex items-center justify-center shadow-lg shadow-pagnol-orange/20">
                        <HandCoins size={32} />
                    </div>
                    <div>
                        <h4 className="text-xl font-black uppercase font-outfit">Control de Liquidez</h4>
                        <p className="text-xs text-muted-foreground font-medium max-w-sm">Los adelantos aprobados serán depositados en un máximo de 24 horas hábiles a tu cuenta registrada.</p>
                    </div>
                </div>
                <Button asChild className="bg-white text-slate-900 hover:bg-pagnol-orange hover:text-white px-8 py-6 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl active:scale-95">
                    <Link href="/dashboard/wallet">Nueva Solicitud</Link>
                </Button>
            </div>
        </div>
    );
}
