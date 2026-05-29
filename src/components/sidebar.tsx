'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import Image from 'next/image';
import {
  LayoutDashboard,
  Wrench,
  Users,
  ClipboardList,
  Warehouse,
  Package,
  PlusCircle,
  ShoppingCart,
  Briefcase,
  PackagePlus,
  FileText,
  FileSpreadsheet,
  Edit,
  CalendarCheck,
  Clock,
  BookOpen,
  FileBarChart,
  User as UserIcon,
  UserPlus,
  Ruler,
  ShieldCheck,
  FileUp,
  RotateCcw,
  ArrowLeft,
  ListChecks,
  DollarSign,
  ShieldAlert,
  ClipboardPaste,
  BarChart3,
  QrCode,
  Undo2,
  FolderTree,
  HandCoins,
  Crown,
  Construction,
  CheckSquare,
  GanttChartSquare,
  Wallet,
  HandPlatter,
  History,
  HardDrive,
  ArrowLeftRight,
  LogOut,
  Building2,
  Search,
  Target,
  Zap,
  Receipt,
  FileMinus,
  FilePlus,
  ShoppingBag,
  Truck,
  FileCheck,
  Globe,
  MapPin,
  HelpCircle,
  Link2,
} from 'lucide-react';

import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { cn } from '@/lib/utils';
import { UserRole } from '@/modules/core/lib/data';
import type { Permission } from '@/modules/core/lib/permissions';
import { TenantSwitcher } from '@/components/TenantSwitcher';
import { Button } from '@/components/ui/button';

const getPanolNavItems = (can: (p: Permission) => boolean) => [
  { href: '/dashboard/pagnol', icon: LayoutDashboard, label: 'Panel Principal' },
  { href: '/dashboard/pagnol/activos', icon: Package, label: 'Gestión de Activos' },
  { href: '/dashboard/pagnol/mantenimiento', icon: Wrench, label: 'Mantenimiento (OT)' },
  { href: '/dashboard/pagnol/movimientos', icon: ArrowLeftRight, label: 'Transacciones' },
  { href: '/dashboard/pagnol/reports', icon: BarChart3, label: 'Informes y Reportes' },
  { href: '/dashboard/pagnol/personal', icon: Users, label: 'Gestión de Personal' },
  { href: '/dashboard/pagnol/invitaciones', icon: UserPlus, label: 'Invitaciones' },
  { href: '/dashboard/pagnol/carga-masiva', icon: FileUp, label: 'Carga Masiva' },
  { href: '/dashboard/pagnol/hardware', icon: HardDrive, label: 'Integración Hardware' },
];

const getConstructionNavItems = (can: (p: any) => boolean) => [
  { href: '/dashboard/construction-control', icon: LayoutDashboard, label: 'Panel de Control' },
  { href: '/dashboard/construction-control/gantt', icon: GanttChartSquare, label: 'Cronograma Gantt' },
  { href: '/dashboard/construction-control/wbs', icon: FolderTree, label: 'Estructura WBS' },
  { href: '/dashboard/construction-control/protocolos', icon: FileCheck, label: 'Protocolos de Calidad' },
  ...(can('construction_control:review_protocols') ? [
    { href: '/dashboard/construction-control/protocolos/plantillas', icon: BookOpen, label: 'Plantillas' },
  ] : []),
  { href: '/dashboard/construction-control/mis-protocolos', icon: ClipboardList, label: 'Mis EDT' },
  { href: '/dashboard/construction-control/revisar-protocolos', icon: ListChecks, label: 'Revisar EDT' },
];

const getPurchasingNavItems = () => [
  { href: '/dashboard/purchasing', icon: LayoutDashboard, label: 'Panel de Compras' },
  { href: '/dashboard/purchasing/purchase-requests', icon: ShoppingCart, label: 'Solicitudes' },
  { href: '/dashboard/purchasing/orders', icon: FileText, label: 'Órdenes de Compra' },
  { href: '/dashboard/purchasing/suppliers', icon: Building2, label: 'Proveedores' },
  { href: '/dashboard/purchasing/lots', icon: PackagePlus, label: 'Lotes de Compra' },
  { href: '/dashboard/purchasing/finance', icon: DollarSign, label: 'Finanzas' },
];

const getSafetyNavItems = () => [
  { href: '/dashboard/safety', icon: ShieldCheck, label: 'Panel de Seguridad' },
  { href: '/dashboard/safety/assigned-checklists', icon: ClipboardList, label: 'Checklists' },
  { href: '/dashboard/safety/assigned-inspections', icon: Search, label: 'Inspecciones' },
  { href: '/dashboard/safety/daily-talk', icon: Users, label: 'Charla Diaria' },
  { href: '/dashboard/safety/behavior-observation', icon: Target, label: 'Observaciones' },
  { href: '/dashboard/safety/templates', icon: FileUp, label: 'Plantillas' },
];

const getAttendanceNavItems = () => [
  { href: '/dashboard/attendance/overview', icon: Globe, label: 'Vista General' },
  { href: '/dashboard/attendance', icon: Clock, label: 'Control de Asistencia' },
  { href: '/dashboard/attendance/contracts', icon: Briefcase, label: 'Contratos' },
  { href: '/dashboard/attendance/shifts', icon: RotateCcw, label: 'Turnos' },
  { href: '/dashboard/attendance/import', icon: FileUp, label: 'Importar Planilla' },
  { href: '/dashboard/attendance/report', icon: FileBarChart, label: 'Reporte Semanal' },
  { href: '/dashboard/attendance/monthly-report', icon: FileSpreadsheet, label: 'Liquidación de Sueldo' },
  { href: '/dashboard/attendance/overtime', icon: Zap, label: 'Horas Extras' },
  { href: '/dashboard/attendance/severance', icon: HandCoins, label: 'Finiquitos' },
];

const getPaymentsNavItems = () => [
  { href: '/dashboard/payments', icon: Wallet, label: 'Gestión de Pagos' },
  { href: '/dashboard/payments/pago-facturas', icon: FileText, label: 'Facturas' },
  { href: '/dashboard/payments/advances', icon: HandPlatter, label: 'Adelantos' },
  { href: '/dashboard/payments/suppliers', icon: Users, label: 'Proveedores' },
];

const getReportsNavItems = () => [
  { href: '/dashboard/reports', icon: LayoutDashboard, label: 'Panel de Reportes' },
  { href: '/dashboard/reports/inventory', icon: Package, label: 'Reporte Inventario' },
  { href: '/dashboard/reports/deliveries', icon: ArrowLeftRight, label: 'Reporte Entregas' },
  { href: '/dashboard/reports/stats', icon: BarChart3, label: 'Estadísticas' },
];

const getBodegaNavItems = () => [
  { href: '/dashboard/bodega', icon: LayoutDashboard, label: 'Resumen Bodega' },
  { href: '/dashboard/bodega/requests', icon: ClipboardList, label: 'Gestionar Solicitudes' },
  { href: '/dashboard/bodega/return-requests', icon: RotateCcw, label: 'Gestionar Devoluciones' },
  { href: '/dashboard/bodega/tools', icon: Wrench, label: 'Herramientas' },
  { href: '/dashboard/bodega/tools/print-qrs', icon: QrCode, label: 'Imprimir QRs' },
  { href: '/dashboard/bodega/materials', icon: Package, label: 'Materiales' },
  { href: '/dashboard/bodega/manual-stock-entry', icon: PackagePlus, label: 'Ingreso Manual' },
  { href: '/dashboard/bodega/units', icon: Ruler, label: 'Unidades' },
  { href: '/dashboard/bodega/categories', icon: FolderTree, label: 'Categorías' },
  { href: '/dashboard/bodega/purchase-requests', icon: ShoppingCart, label: 'Solicitudes Compra' },
];

const getDteNavItems = () => [
  { href: '/dashboard/dte', icon: LayoutDashboard, label: 'Resumen DTE' },
  { href: '/dashboard/dte/facturas', icon: FileText, label: 'Facturas Electrónicas' },
  { href: '/dashboard/dte/notas-credito', icon: FileMinus, label: 'Notas de Crédito' },
  { href: '/dashboard/dte/notas-debito', icon: FilePlus, label: 'Notas de Débito' },
  { href: '/dashboard/dte/facturas-compras', icon: ShoppingBag, label: 'Fact. de Compras' },
  { href: '/dashboard/dte/facturas-proveedores', icon: Building2, label: 'Fact. Proveedores' },
  { href: '/dashboard/dte/guias-despacho', icon: Truck, label: 'Guías de Despacho' },
  { href: '/dashboard/dte/facturas-exentas', icon: FileCheck, label: 'Facturas Exentas' },
  { href: '/dashboard/dte/exportacion', icon: Globe, label: 'Doc. Exportación' },
  { href: '/dashboard/dte/boletas', icon: Receipt, label: 'Boletas Electrónicas' },
  { href: '/dashboard/dte/localizacion', icon: MapPin, label: 'Localización CL' },
  { href: '/dashboard/dte/integracion-sii', icon: Link2, label: 'Integración SII' },
  { href: '/dashboard/dte/soporte', icon: HelpCircle, label: 'Soporte Técnico' },
];

const getUsersNavItems = () => [
  { href: '/dashboard/users', icon: Users, label: 'Lista de Usuarios' },
  { href: '/dashboard/users/print-qrs', icon: QrCode, label: 'Imprimir Credenciales' },
  { href: '/dashboard/permissions', icon: ShieldCheck, label: 'Gestión de Permisos' },
];

const getSubscriptionsNavItems = () => [
  { href: '/dashboard/subscriptions', icon: Crown, label: 'Planes y Clientes' },
  { href: '/dashboard/subscriptions/plans', icon: Building2, label: 'Gestión de Tenants' },
  { href: '/dashboard/subscriptions/feedback', icon: ShieldAlert, label: 'Feedback de Usuarios' },
];

const getWalletNavItems = () => [
  { href: '/dashboard/wallet', icon: Wallet, label: 'Mi Balance' },
  { href: '/dashboard/wallet/advances', icon: HandCoins, label: 'Solicitar Adelanto' },
];

const getSupervisorNavItems = () => [
  { href: '/dashboard/supervisor', icon: LayoutDashboard, label: 'Panel Supervisor' },
  { href: '/dashboard/supervisor/request', icon: PlusCircle, label: 'Solicitud Material' },
  { href: '/dashboard/supervisor/return-request', icon: RotateCcw, label: 'Devolución Material' },
  { href: '/dashboard/supervisor/purchase-request-form', icon: ShoppingCart, label: 'Solicitud Compra' },
  { href: '/dashboard/supervisor/suppliers', icon: Building2, label: 'Lista Proveedores' },
];

const getCommitteeNavItems = () => [
  { href: '/dashboard/cphs', icon: ShieldAlert, label: 'Comité Paritario' },
  { href: '/dashboard/cphs/meetings', icon: Users, label: 'Reuniones' },
];

const getSuperAdminNavItems = () => [
  { href: '/dashboard/super-admin',           icon: LayoutDashboard, label: 'Panel Global'      },
  { href: '/dashboard/super-admin/tenants',   icon: Building2,       label: 'Empresas'          },
  { href: '/dashboard/super-admin/hardware',  icon: HardDrive,       label: 'Hardware'          },
  { href: '/dashboard/super-admin/contracts', icon: FileText,        label: 'Contratos'         },
];

interface SidebarProps {
  onLinkClick?: () => void;
}

export function Sidebar({ onLinkClick }: SidebarProps) {
  const pathname = usePathname();
  const { user, can, logout } = useAuth();

  const handleLinkClick = () => {
    if (onLinkClick) {
      onLinkClick();
    }
  }

  const { navItems, moduleTitle, moduleIcon: ModuleIcon } = React.useMemo(() => {
    if (!user) return { navItems: [], moduleTitle: '', moduleIcon: LayoutDashboard };

    if (pathname.startsWith('/dashboard/pagnol')) {
      return { navItems: getPanolNavItems(can), moduleTitle: 'Módulo Pagnol', moduleIcon: Warehouse };
    }
    if (pathname.startsWith('/dashboard/construction-control')) {
      return { navItems: getConstructionNavItems(can), moduleTitle: 'Obra', moduleIcon: Construction };
    }
    if (pathname.startsWith('/dashboard/purchasing')) {
      return { navItems: getPurchasingNavItems(), moduleTitle: 'Compras', moduleIcon: ShoppingCart };
    }
    if (pathname.startsWith('/dashboard/safety')) {
      return { navItems: getSafetyNavItems(), moduleTitle: 'Seguridad', moduleIcon: ShieldCheck };
    }
    if (pathname.startsWith('/dashboard/attendance')) {
      return { navItems: getAttendanceNavItems(), moduleTitle: 'Asistencia', moduleIcon: CalendarCheck };
    }
    if (pathname.startsWith('/dashboard/payments')) {
      return { navItems: getPaymentsNavItems(), moduleTitle: 'Pagos', moduleIcon: DollarSign };
    }
    if (pathname.startsWith('/dashboard/estado-pago')) {
      return {
        navItems: [
          { href: '/dashboard/estado-pago', icon: LayoutDashboard, label: 'Contratos' },
          { href: '/dashboard/estado-pago/historial', icon: History, label: 'Historial' },
        ],
        moduleTitle: 'E. de Pago',
        moduleIcon: FileText
      };
    }
    if (pathname.startsWith('/dashboard/reports')) {
      return { navItems: getReportsNavItems(), moduleTitle: 'Reportes', moduleIcon: BarChart3 };
    }
    if (pathname.startsWith('/dashboard/bodega')) {
      return { navItems: getBodegaNavItems(), moduleTitle: 'Bodega Central', moduleIcon: Warehouse };
    }
    if (pathname.startsWith('/dashboard/dte')) {
      return { navItems: getDteNavItems(), moduleTitle: 'Facturación DTE', moduleIcon: Receipt };
    }
    if (pathname.startsWith('/dashboard/users') || pathname.startsWith('/dashboard/permissions')) {
      return {
        navItems: getUsersNavItems(),
        moduleTitle: 'Usuarios y Permisos',
        moduleIcon: Users
      };
    }
    if (pathname.startsWith('/dashboard/subscriptions')) {
      return { navItems: getSubscriptionsNavItems(), moduleTitle: 'Suscripciones', moduleIcon: Crown };
    }
    if (pathname.startsWith('/dashboard/wallet')) {
      return { navItems: getWalletNavItems(), moduleTitle: 'Billetera', moduleIcon: Wallet };
    }
    if (pathname.startsWith('/dashboard/supervisor')) {
      return { navItems: getSupervisorNavItems(), moduleTitle: 'Supervisor', moduleIcon: Construction };
    }
    if (pathname.startsWith('/dashboard/cphs')) {
      return { navItems: getCommitteeNavItems(), moduleTitle: 'Comité', moduleIcon: ShieldAlert };
    }
    if (pathname.startsWith('/dashboard/super-admin')) {
      return { navItems: getSuperAdminNavItems(), moduleTitle: 'Super Admin', moduleIcon: Crown };
    }

    return { navItems: [], moduleTitle: 'PAGNOL', moduleIcon: LayoutDashboard };
  }, [pathname, user, can]);

  return (
    <div className="flex h-full max-h-screen flex-col bg-[#1A3A44] text-white">
      {/* Brand Header */}
      <div className="flex h-16 items-center border-b border-white/5 px-6 shrink-0 gap-3">
        <Link href="/dashboard" onClick={handleLinkClick} className="flex items-center gap-3 group">
          <div className="h-8 w-8 relative flex-shrink-0">
            <Image src="/logo.png" alt="Pagnol Logo" layout="fill" objectFit="contain" />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-black tracking-tighter leading-none text-white group-hover:text-pagnol-orange transition-colors">PAGNOL</span>
            <span className="text-[9px] font-bold tracking-[0.2em] text-pagnol-orange group-hover:text-white transition-colors uppercase">ASSET MANAGEMENT</span>
          </div>
        </Link>
      </div>

      {/* Module Hub Link */}
      <div className="px-4 py-4 space-y-4">
        <Button
          asChild
          variant="ghost"
          className="w-full justify-start gap-3 bg-white/5 hover:bg-white/10 hover:text-white rounded-2xl h-12 border border-white/5 px-4 shadow-sm group"
          onClick={handleLinkClick}
        >
          <Link href="/dashboard">
            <Undo2 size={18} className="text-slate-400 group-hover:text-pagnol-orange transition-colors" />
            <span className="text-[10px] font-black uppercase tracking-widest">Panel Central</span>
          </Link>
        </Button>

        {user?.role === 'super-admin' && <TenantSwitcher />}
      </div>

      {/* Current Module Indicator */}
      {moduleTitle !== 'PAGNOL' && (
        <div className="px-6 py-2">
          <div className="flex items-center gap-3 text-pagnol-orange/60 mb-4">
            <ModuleIcon size={14} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">{moduleTitle}</span>
          </div>
        </div>
      )}

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 no-scrollbar">
        <nav className="space-y-1.5">
          {navItems.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleLinkClick}
                className={cn(
                  'group flex items-center gap-4 rounded-[1.2rem] px-4 py-3.5 text-slate-400 transition-all duration-300 relative overflow-hidden',
                  isActive
                    ? 'text-white bg-pagnol-orange shadow-lg shadow-pagnol-orange/20 font-bold'
                    : 'hover:text-white hover:bg-white/5'
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-white rounded-r-full" />
                )}
                <item.icon className={cn(
                  "h-5 w-5 transition-transform duration-300 group-hover:scale-110",
                  isActive ? "text-white" : "text-slate-500 group-hover:text-white"
                )} />
                <span className="flex-1 uppercase tracking-widest text-[10px] whitespace-nowrap">{item.label}</span>
                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-white opacity-40 animate-pulse" />
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Footer Info & Logout */}
      <div className="mt-auto p-4 border-t border-white/5 bg-black/10">
        <Button
          variant="ghost"
          className="w-full justify-start gap-4 hover:bg-red-500/10 hover:text-red-400 text-slate-400 rounded-xl h-11"
          onClick={logout}
        >
          <LogOut size={18} />
          <span className="uppercase tracking-widest text-[10px] font-black">Cerrar Sesión</span>
        </Button>
      </div>
    </div>
  );
}
