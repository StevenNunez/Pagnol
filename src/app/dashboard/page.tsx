'use client';

import React from 'react';
import { useAuth } from '@/modules/core/contexts/app-provider';
import Link from 'next/link';
import {
    QrCode,
    User,
    HardHat,
    ShoppingCart,
    Users,
    ShieldCheck,
    CalendarDays,
    DollarSign,
    BarChart3,
    FileText,
    ArrowRight,
    LayoutGrid,
    Crown,
    Wallet,
    Construction,
    ShieldAlert,
    Pickaxe,
    Receipt,
    KeyRound,
    NotebookPen,
    UserCog,
    PackageSearch
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { Permission } from '@/modules/core/lib/permissions';
import { PageHeader } from '@/components/page-header';

export default function DashboardHub() {
    const { user, can } = useAuth();

    const modules = [
        {
            title: "Módulo Control de Activos",
            description: "Gestión especializada para minería: activos, pañol, solicitudes y transacciones.",
            icon: Pickaxe,
            href: "/dashboard/pagnol",
            color: "text-cyan-600 dark:text-cyan-400",
            bg: "bg-cyan-100 dark:bg-cyan-500/10",
            border: "hover:border-cyan-300 dark:hover:border-cyan-500/50",
            shadow: "hover:shadow-cyan-500/20 dark:hover:shadow-cyan-500/10",
            // Bodega fusionada en Pagnol: visible para quien veía cualquiera de los dos.
            permissions: ['module_pagnol:view', 'module_bodega:view', 'module_warehouse:view']
        },
        {
            title: "Módulo Control de Obras",
            description: "Gestiona el avance físico de la obra.",
            icon: HardHat,
            href: "/dashboard/construction-control",
            color: "text-primary",
            bg: "bg-orange-100 dark:bg-orange-500/10",
            border: "hover:border-orange-300 dark:hover:border-orange-500/50",
            shadow: "hover:shadow-orange-500/20 dark:hover:shadow-orange-500/10",
            permission: 'module_construction_control:view'
        },
        {
            title: "Módulo Reportabilidad",
            description: "Informes diarios de terreno con fotos, HH, HM, firmas y aprobaciones.",
            icon: NotebookPen,
            href: "/dashboard/work-reports",
            color: "text-orange-600 dark:text-orange-400",
            bg: "bg-orange-100 dark:bg-orange-500/10",
            border: "hover:border-orange-300 dark:hover:border-orange-500/50",
            shadow: "hover:shadow-orange-500/20 dark:hover:shadow-orange-500/10",
            permission: 'module_work_reports:view'
        },
        {
            title: "Autorizaciones",
            description: "Bandeja del Administrador de Contratos: autoriza solicitudes de material, compra y arriendo antes de Abastecimiento.",
            icon: ShieldCheck,
            href: "/dashboard/authorizations",
            color: "text-primary",
            bg: "bg-orange-100 dark:bg-orange-500/10",
            border: "hover:border-orange-300 dark:hover:border-orange-500/50",
            shadow: "hover:shadow-orange-500/20 dark:hover:shadow-orange-500/10",
            permission: 'module_authorizations:view'
        },
        {
            title: "Compras y Abastecimiento",
            description: "Ciclo completo de compras: solicitud → RFQ → OC → recepción → pago, con lotes, finanzas y control de costos.",
            icon: PackageSearch,
            href: "/dashboard/abastecimiento",
            color: "text-emerald-600 dark:text-emerald-400",
            bg: "bg-emerald-100 dark:bg-emerald-500/10",
            border: "hover:border-emerald-300 dark:hover:border-emerald-500/50",
            shadow: "hover:shadow-emerald-500/20 dark:hover:shadow-emerald-500/10",
            // Visible para quien podía ver el viejo Compras O Abastecimiento (consolidado).
            permissions: ['module_abastecimiento:view', 'module_purchasing:view']
        },
        {
            title: "Gestión de Usuarios y Permisos",
            description: "Gestiona los perfiles, roles y permisos de los trabajadores.",
            icon: Users,
            href: "/dashboard/users",
            color: "text-purple-600 dark:text-purple-400",
            bg: "bg-purple-100 dark:bg-purple-500/10",
            border: "hover:border-purple-300 dark:hover:border-purple-500/50",
            shadow: "hover:shadow-purple-500/20 dark:hover:shadow-purple-500/10",
            permission: 'module_users:view'
        },
        {
            title: "Módulo de Suscripciones",
            description: "Gestiona los inquilinos (clientes) de la plataforma.",
            icon: Crown,
            href: "/dashboard/subscriptions",
            color: "text-amber-600 dark:text-amber-400",
            bg: "bg-amber-100 dark:bg-amber-500/10",
            border: "hover:border-amber-300 dark:hover:border-amber-500/50",
            shadow: "hover:shadow-amber-500/20 dark:hover:shadow-amber-500/10",
            permission: 'module_subscriptions:view'
        },
        {
            title: "Módulo de Prevención",
            description: "Gestión de checklists, plantillas y revisiones de seguridad.",
            icon: ShieldCheck,
            href: "/dashboard/safety",
            color: "text-red-600 dark:text-red-400",
            bg: "bg-red-100 dark:bg-red-500/10",
            border: "hover:border-red-300 dark:hover:border-red-500/50",
            shadow: "hover:shadow-red-500/20 dark:hover:shadow-red-500/10",
            permission: 'module_safety:view'
        },
        {
            title: "Módulo de Asistencia",
            description: "Control de entrada/salida del personal.",
            icon: CalendarDays,
            href: "/dashboard/attendance",
            color: "text-indigo-600 dark:text-indigo-400",
            bg: "bg-indigo-100 dark:bg-indigo-500/10",
            border: "hover:border-indigo-300 dark:hover:border-indigo-500/50",
            shadow: "hover:shadow-indigo-500/20 dark:hover:shadow-indigo-500/10",
            permission: 'module_attendance:view'
        },
        {
            title: "Módulo de Pagos",
            description: "Gestiona las facturas y pagos a proveedores.",
            icon: DollarSign,
            href: "/dashboard/payments",
            color: "text-green-600 dark:text-green-400",
            bg: "bg-green-100 dark:bg-green-500/10",
            border: "hover:border-green-300 dark:hover:border-green-500/50",
            shadow: "hover:shadow-green-500/20 dark:hover:shadow-green-500/10",
            permission: 'module_payments:view'
        },
        {
            title: "Módulo de Reportes",
            description: "Analiza consumos y genera informes.",
            icon: BarChart3,
            href: "/dashboard/reports",
            color: "text-pink-600 dark:text-pink-400",
            bg: "bg-pink-100 dark:bg-pink-500/10",
            border: "hover:border-pink-300 dark:hover:border-pink-500/50",
            shadow: "hover:shadow-pink-500/20 dark:hover:shadow-pink-500/10",
            permission: 'module_reports:view'
        },
        {
            title: "Mi Billetera Digital",
            description: "Consulta tu saldo ganado y solicita adelantos de sueldo.",
            icon: Wallet,
            href: "/dashboard/wallet",
            color: "text-sky-600 dark:text-sky-400",
            bg: "bg-sky-100 dark:bg-sky-500/10",
            border: "hover:border-sky-300 dark:hover:border-sky-500/50",
            shadow: "hover:shadow-sky-500/20 dark:hover:shadow-sky-500/10",
        },
        {
            title: "Módulo Supervisor",
            description: "Gestiona solicitudes, devoluciones y compras de faena.",
            icon: Construction,
            href: "/dashboard/supervisor",
            color: "text-yellow-600 dark:text-yellow-400",
            bg: "bg-yellow-100 dark:bg-yellow-500/10",
            border: "hover:border-yellow-300 dark:hover:border-yellow-500/50",
            shadow: "hover:shadow-yellow-500/20 dark:hover:shadow-yellow-500/10",
            permission: 'material_requests:create'
        },
        {
            title: "Estado de Pago",
            description: "Gestiona tus partidas y estados de pago.",
            icon: FileText,
            href: "/dashboard/estado-pago",
            color: "text-cyan-600 dark:text-cyan-400",
            bg: "bg-cyan-100 dark:bg-cyan-500/10",
            border: "hover:border-cyan-300 dark:hover:border-cyan-500/50",
            shadow: "hover:shadow-cyan-500/20 dark:hover:shadow-cyan-500/10",
            permission: 'construction_control:register_progress'
        },
        {
            title: "Módulo Comité Paritario",
            description: "Accede a las herramientas de gestión de seguridad del comité.",
            icon: ShieldAlert,
            href: "/dashboard/cphs",
            color: "text-rose-600 dark:text-rose-400",
            bg: "bg-rose-100 dark:bg-rose-500/10",
            border: "hover:border-rose-300 dark:hover:border-rose-500/50",
            shadow: "hover:shadow-rose-500/20 dark:hover:shadow-rose-500/10",
            permission: 'safety_checklists:review'
        },
        {
            title: "Finanzas — Resultado por Contrato",
            description: "Ledger de hechos económicos: comprometido, devengado y pagado por contrato (RFC-002).",
            icon: DollarSign,
            href: "/dashboard/finanzas",
            color: "text-teal-600 dark:text-teal-400",
            bg: "bg-teal-100 dark:bg-teal-500/10",
            border: "hover:border-teal-300 dark:hover:border-teal-500/50",
            shadow: "hover:shadow-teal-500/20 dark:hover:shadow-teal-500/10",
            permission: 'module_finance:view'
        },
        {
            title: "Facturación DTE",
            description: "Emisión y gestión de documentos tributarios electrónicos.",
            icon: Receipt,
            href: "/dashboard/dte",
            color: "text-violet-600 dark:text-violet-400",
            bg: "bg-violet-100 dark:bg-violet-500/10",
            border: "hover:border-violet-300 dark:hover:border-violet-500/50",
            shadow: "hover:shadow-violet-500/20 dark:hover:shadow-violet-500/10",
            permission: 'module_dte:view'
        },
        {
            title: "Módulo de Arriendos",
            description: "Gestiona arriendos de maquinaria, vehículos y equipos: contratos, pagos y alertas.",
            icon: KeyRound,
            href: "/dashboard/rentals",
            color: "text-teal-600 dark:text-teal-400",
            bg: "bg-teal-100 dark:bg-teal-500/10",
            border: "hover:border-teal-300 dark:hover:border-teal-500/50",
            shadow: "hover:shadow-teal-500/20 dark:hover:shadow-teal-500/10",
            permission: 'module_rentals:view'
        },
        {
            title: "Recursos Humanos",
            description: "Ficha de empleados, vacaciones/licencias y documentos del personal.",
            icon: UserCog,
            href: "/dashboard/rrhh",
            color: "text-fuchsia-600 dark:text-fuchsia-400",
            bg: "bg-fuchsia-100 dark:bg-fuchsia-500/10",
            border: "hover:border-fuchsia-300 dark:hover:border-fuchsia-500/50",
            shadow: "hover:shadow-fuchsia-500/20 dark:hover:shadow-fuchsia-500/10",
            permission: 'module_rrhh:view'
        },
        {
            title: "Mis Solicitudes RRHH",
            description: "Solicita vacaciones/licencias y gestiona tus documentos personales.",
            icon: UserCog,
            href: "/dashboard/rrhh/mis-solicitudes",
            color: "text-fuchsia-600 dark:text-fuchsia-400",
            bg: "bg-fuchsia-100 dark:bg-fuchsia-500/10",
            border: "hover:border-fuchsia-300 dark:hover:border-fuchsia-500/50",
            shadow: "hover:shadow-fuchsia-500/20 dark:hover:shadow-fuchsia-500/10",
        },
    ];

    const visibleModules = modules.filter((mod: any) => {
        // Soporta `permissions` (cualquiera de varios) además del `permission` único.
        if (mod.permissions) return mod.permissions.some((p: Permission) => can(p));
        return !mod.permission || can(mod.permission as Permission);
    });

    return (
        // 1. APLICAMOS UN CONTENEDOR CON FONDO SUTIL
        // bg-slate-50 para modo claro y un tono muy profundo para oscuro, generando contraste inmediato con las cards.
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 p-6 sm:p-8 bg-slate-50/60 dark:bg-slate-950/40 rounded-[2.5rem] border border-border/40">
            <PageHeader title="Inicio" description="Selecciona el módulo al que deseas acceder" />

            {/* Welcome Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl sm:text-4xl font-black tracking-tighter uppercase text-foreground">
                        Bienvenido, <span className="text-primary">{user?.name?.split(' ')[0] || 'Usuario'}</span>
                    </h1>
                    <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs mt-2">
                        Selecciona el módulo al que deseas acceder o gestiona tu perfil.
                    </p>
                </div>
                <div className="hidden md:flex items-center gap-2 bg-background/80 backdrop-blur-sm px-4 py-2 rounded-full shadow-sm border border-border/50">
                    <LayoutGrid size={16} className="text-muted-foreground" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Panel Central</span>
                </div>
            </div>

            {/* Quick Access Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="rounded-[2.5rem] border border-orange-200/70 shadow-lg hover:shadow-xl hover:shadow-orange-500/10 bg-gradient-to-br from-orange-100 to-slate-50 dark:from-orange-900/30 dark:to-slate-800/80 transition-all duration-300 group cursor-pointer overflow-hidden relative">
                    <Link href="/dashboard/profile/credential" className="absolute inset-0 z-20" />
                    <CardContent className="p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-8 relative z-10">
                        <div className="bg-white dark:bg-card p-4 rounded-3xl shadow-lg border border-border/50 group-hover:scale-110 transition-transform duration-300">
                            <QrCode size={64} className="text-foreground" />
                        </div>
                        <div className="text-center sm:text-left">
                            <h3 className="text-xl font-black uppercase tracking-tight text-foreground">Mi Credencial Digital</h3>
                            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                                Usa este QR para registrar tu asistencia o el retiro y devolución de herramientas en el pañol.
                            </p>
                            <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
                                Ver Credencial <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>
                    </CardContent>
                    <div className="absolute top-0 right-0 w-64 h-64 bg-orange-200/30 dark:bg-orange-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                </Card>

                <Card className="rounded-[2.5rem] border border-border/80 shadow-lg hover:shadow-xl bg-gradient-to-br from-slate-100 to-slate-200/60 dark:from-slate-800/80 dark:to-slate-900/60 transition-all duration-300 group cursor-pointer overflow-hidden relative">
                    <Link href="/dashboard/profile" className="absolute inset-0 z-20" />
                    <CardContent className="p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-8 relative z-10">
                        <div className="bg-background p-6 rounded-full shadow-lg border border-border/50 group-hover:scale-110 transition-transform duration-300">
                            <User size={48} className="text-foreground" />
                        </div>
                        <div className="text-center sm:text-left">
                            <h3 className="text-xl font-black uppercase tracking-tight text-foreground">Mi Perfil</h3>
                            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                                Consulta tu información personal, historial de actividades y planilla de turnos.
                            </p>
                            <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-foreground group-hover:text-primary">
                                Gestionar Cuenta <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>
                    </CardContent>
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-slate-200/40 dark:bg-slate-800/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />
                </Card>
            </div>

            {/* Modules Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {visibleModules.map((mod, idx) => (
                    <Link key={idx} href={mod.href} className="group">
                        {/* 2. ELEVACIÓN Y BORDES EN LAS CARDS */}
                        {/* Aumentamos shadow-sm a shadow-md, forzamos bg-card explícito y mejoramos el borde base */}
                        <Card className={`h-full rounded-[2rem] border border-border/80 shadow-lg hover:-translate-y-1 hover:shadow-xl transition-all duration-300 ${mod.border} ${mod.shadow} bg-slate-100 dark:bg-slate-800/70 overflow-hidden relative`}>
                            <CardContent className="p-8 flex flex-col items-start gap-4 h-full relative z-10">
                                <div className={`p-4 rounded-2xl shadow-sm ${mod.bg} ${mod.color} transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
                                    <mod.icon size={28} strokeWidth={2.5} />
                                </div>
                                <div className="space-y-2 mt-2">
                                    <h3 className="font-black text-lg uppercase tracking-tight text-foreground group-hover:text-primary transition-colors">
                                        {mod.title}
                                    </h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                        {mod.description}
                                    </p>
                                </div>
                                <div className="mt-auto pt-6 w-full flex justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-2 group-hover:translate-y-0">
                                    <div className={`p-2 rounded-full ${mod.bg} ${mod.color}`}>
                                        <ArrowRight size={16} />
                                    </div>
                                </div>
                            </CardContent>
                            <div className={`absolute -bottom-10 -right-10 w-32 h-32 rounded-full blur-2xl opacity-0 group-hover:opacity-30 transition-opacity duration-500 ${mod.bg}`} />
                        </Card>
                    </Link>
                ))}
            </div>

        </div>
    );
}
