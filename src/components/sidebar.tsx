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
  Tags,
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
  KeyRound,
  CalendarClock,
  CalendarRange,
  Contact,
  NotebookPen,
  UserCog,
  ClipboardCheck,
  FileBadge,
  PackageSearch,
  Settings,
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
  { href: '/dashboard/pagnol/solicitudes', icon: ClipboardList, label: 'Solicitudes y Devoluciones' },
  { href: '/dashboard/pagnol/movimientos', icon: ArrowLeftRight, label: 'Transacciones' },
  { href: '/dashboard/pagnol/mantenimiento', icon: Wrench, label: 'Mantenimiento (OT)' },
  { href: '/dashboard/pagnol/ingreso-stock', icon: PackagePlus, label: 'Ingreso Manual' },
  { href: '/dashboard/pagnol/panoles', icon: Warehouse, label: 'Pañoles' },
  { href: '/dashboard/pagnol/solicitudes-compra', icon: ShoppingCart, label: 'Solicitudes Compra' },
  { href: '/dashboard/pagnol/catalogos', icon: FolderTree, label: 'Catálogos' },
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
  { href: '/dashboard/construction-control/mis-protocolos', icon: ClipboardList, label: 'Mis Partidas' },
  ...(can('construction_control:review_protocols') ? [
    { href: '/dashboard/construction-control/revisar-protocolos', icon: ListChecks, label: 'Aprobar Partidas' },
  ] : []),
];

const getPurchasingNavItems = () => [
  { href: '/dashboard/purchasing', icon: LayoutDashboard, label: 'Panel de Compras' },
  { href: '/dashboard/purchasing/purchase-requests', icon: ShoppingCart, label: 'Solicitudes' },
  { href: '/dashboard/purchasing/orders', icon: FileText, label: 'Órdenes de Compra' },
  { href: '/dashboard/purchasing/suppliers', icon: Building2, label: 'Proveedores' },
  { href: '/dashboard/purchasing/lots', icon: PackagePlus, label: 'Lotes de Compra' },
  { href: '/dashboard/purchasing/finance', icon: DollarSign, label: 'Finanzas' },
];

const getSafetyNavItems = (can: (p: any) => boolean) => [
  { href: '/dashboard/safety', icon: ShieldCheck, label: 'Panel de Seguridad' },
  { href: '/dashboard/safety/assigned-checklists', icon: ClipboardList, label: 'Checklists' },
  { href: '/dashboard/safety/assigned-inspections', icon: Search, label: 'Inspecciones' },
  { href: '/dashboard/safety/daily-talk', icon: Users, label: 'Charla Diaria' },
  { href: '/dashboard/safety/behavior-observation', icon: Target, label: 'Observaciones' },
  { href: '/dashboard/safety/templates', icon: FileUp, label: 'Plantillas' },
  ...(can('safety_checklists:review') ? [
    { href: '/dashboard/safety/review-checklists', icon: ListChecks, label: 'Revisar Checklists' },
  ] : []),
  ...(can('safety_inspections:review') ? [
    { href: '/dashboard/safety/review-inspections', icon: ShieldAlert, label: 'Revisar Inspecciones' },
  ] : []),
  ...(can('safety_checklists:review') ? [
    { href: '/dashboard/safety/review-daily-talks', icon: BookOpen, label: 'Revisar Charlas' },
  ] : []),
  ...(can('safety_observations:review') ? [
    { href: '/dashboard/safety/review-observations', icon: Target, label: 'Revisar Observaciones' },
  ] : []),
];

const getAttendanceNavItems = () => [
  { href: '/dashboard/attendance/overview', icon: Globe, label: 'Vista General' },
  { href: '/dashboard/attendance', icon: Clock, label: 'Control de Asistencia' },
  { href: '/dashboard/attendance/contracts', icon: Briefcase, label: 'Contratos' },
  { href: '/dashboard/attendance/shifts', icon: RotateCcw, label: 'Turnos' },
  { href: '/dashboard/attendance/import', icon: FileUp, label: 'Importar Planilla' },
  { href: '/dashboard/attendance/report', icon: FileBarChart, label: 'Reporte Semanal' },
  // "Liquidación de Sueldo" apuntaba acá a una calculadora con valores legales
  // quemados y desactualizados (ADR-011). Liquidar es del módulo Remuneraciones.
  { href: '/dashboard/rrhh/remuneraciones', icon: FileSpreadsheet, label: 'Liquidación de Sueldo' },
  { href: '/dashboard/attendance/overtime', icon: Zap, label: 'Horas Extras' },
  // Igual que "Liquidación de Sueldo": la calculadora vieja de finiquitos quedó
  // retirada (ADR-012). Emitir finiquitos es del módulo RRHH.
  { href: '/dashboard/rrhh/finiquitos', icon: HandCoins, label: 'Finiquitos' },
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
  { href: '/dashboard/reports/contract-stock', icon: Warehouse, label: 'Stock por Contrato' },
  { href: '/dashboard/reports/deliveries', icon: ArrowLeftRight, label: 'Reporte Entregas' },
  { href: '/dashboard/reports/stats', icon: BarChart3, label: 'Estadísticas' },
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

const getRentalsNavItems = () => [
  { href: '/dashboard/rentals', icon: LayoutDashboard, label: 'Panel de Arriendos' },
  { href: '/dashboard/rentals/contracts', icon: FileText, label: 'Contratos' },
  { href: '/dashboard/rentals/parties', icon: Contact, label: 'Arrendadores y Clientes' },
  { href: '/dashboard/rentals/payments', icon: CalendarClock, label: 'Calendario de Pagos' },
];

const getWorkReportsNavItems = () => [
  { href: '/dashboard/work-reports', icon: LayoutDashboard, label: 'Centro Operativo' },
  { href: '/dashboard/work-reports/ot', icon: ClipboardList, label: 'OT / Reportes de Trabajo' },
  { href: '/dashboard/work-reports/reportesdiarios', icon: NotebookPen, label: 'Reportes Diarios' },
  { href: '/dashboard/work-reports/semanal', icon: CalendarRange, label: 'Reportes Semanales' },
  { href: '/dashboard/work-reports/catalogos', icon: Tags, label: 'Catálogos' },
];

const getAbastecimientoNavItems = () => [
  { href: '/dashboard/abastecimiento', icon: LayoutDashboard, label: 'Panel de Control' },
  { href: '/dashboard/abastecimiento/solicitudes', icon: ShoppingCart, label: 'Solicitudes de Compra' },
  { href: '/dashboard/abastecimiento/lotes', icon: PackagePlus, label: 'Lotes de Compra' },
  { href: '/dashboard/abastecimiento/rfq', icon: Search, label: 'Cotizaciones (RFQ)' },
  { href: '/dashboard/abastecimiento/comparador', icon: ListChecks, label: 'Comparador' },
  { href: '/dashboard/abastecimiento/ordenes', icon: FileText, label: 'Órdenes de Compra' },
  { href: '/dashboard/abastecimiento/recepcion', icon: Truck, label: 'Recepción' },
  { href: '/dashboard/abastecimiento/proveedores', icon: Building2, label: 'Proveedores' },
  { href: '/dashboard/abastecimiento/costos', icon: Target, label: 'Control de Costos' },
  { href: '/dashboard/abastecimiento/finanzas', icon: Receipt, label: 'Finanzas' },
  { href: '/dashboard/abastecimiento/arriendos', icon: KeyRound, label: 'Arriendos' },
  { href: '/dashboard/abastecimiento/pagos', icon: DollarSign, label: 'Pagos' },
  { href: '/dashboard/abastecimiento/reportes', icon: FileBarChart, label: 'Reportes' },
];

const getRrhhNavItems = (can: (p: Permission) => boolean) => [
  ...(can('module_rrhh:view') ? [
    { href: '/dashboard/rrhh', icon: LayoutDashboard, label: 'Panel RRHH' },
  ] : []),
  ...(can('hr_employees:view') ? [
    { href: '/dashboard/rrhh/empleados', icon: Users, label: 'Ficha de Empleados' },
  ] : []),
  ...(can('hr_employees:edit') ? [
    { href: '/dashboard/rrhh/remuneraciones', icon: Wallet, label: 'Remuneraciones' },
    { href: '/dashboard/rrhh/finiquitos', icon: HandCoins, label: 'Finiquitos' },
  ] : []),
  ...(can('contracts:manage') ? [
    { href: '/dashboard/rrhh/contratos', icon: Briefcase, label: 'Contratos' },
  ] : []),
  ...(can('shifts:manage') ? [
    { href: '/dashboard/rrhh/turnos', icon: RotateCcw, label: 'Turnos' },
  ] : []),
  ...(can('hr_leave:view_all') ? [
    { href: '/dashboard/rrhh/solicitudes', icon: ClipboardCheck, label: 'Vacaciones y Licencias' },
  ] : []),
  ...(can('hr_documents:view') ? [
    { href: '/dashboard/rrhh/documentos', icon: FileBadge, label: 'Documentos' },
  ] : []),
  { href: '/dashboard/rrhh/mis-solicitudes', icon: CalendarClock, label: 'Mis Solicitudes' },
  { href: '/dashboard/rrhh/mis-documentos', icon: FileText, label: 'Mis Documentos' },
];

const getUsersNavItems = () => [
  { href: '/dashboard/users', icon: Users, label: 'Lista de Usuarios' },
  { href: '/dashboard/users/print-qrs', icon: QrCode, label: 'Imprimir Credenciales' },
  { href: '/dashboard/users/geofence', icon: MapPin, label: 'Zona de la Faena' },
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
  { href: '/dashboard/supervisor/rental-request', icon: KeyRound, label: 'Solicitud Arriendo' },
  { href: '/dashboard/supervisor/suppliers', icon: Building2, label: 'Lista Proveedores' },
];

const getCommitteeNavItems = () => [
  { href: '/dashboard/cphs', icon: ShieldAlert, label: 'Comité Paritario' },
  { href: '/dashboard/cphs/meetings', icon: Users, label: 'Reuniones' },
];

const getSettingsNavItems = () => [
  { href: '/dashboard/configuracion', icon: Settings, label: 'Datos y Correlativos' },
  { href: '/dashboard/configuracion/clientes', icon: Building2, label: 'Clientes y Contratos' },
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

    if (pathname.startsWith('/dashboard/authorizations')) {
      return {
        navItems: [
          { href: '/dashboard/authorizations', icon: ShieldCheck, label: 'Bandeja de Autorización' },
        ],
        moduleTitle: 'Autorizaciones',
        moduleIcon: ShieldCheck,
      };
    }
    if (pathname.startsWith('/dashboard/abastecimiento')) {
      return { navItems: getAbastecimientoNavItems(), moduleTitle: 'Abastecimiento', moduleIcon: PackageSearch };
    }
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
      return { navItems: getSafetyNavItems(can), moduleTitle: 'Seguridad', moduleIcon: ShieldCheck };
    }
    if (pathname.startsWith('/dashboard/attendance')) {
      return { navItems: getAttendanceNavItems(), moduleTitle: 'Asistencia', moduleIcon: CalendarCheck };
    }
    if (pathname.startsWith('/dashboard/payments')) {
      return { navItems: getPaymentsNavItems(), moduleTitle: 'Pagos', moduleIcon: DollarSign };
    }
    if (pathname.startsWith('/dashboard/rentals')) {
      return { navItems: getRentalsNavItems(), moduleTitle: 'Arriendos', moduleIcon: KeyRound };
    }
    if (pathname.startsWith('/dashboard/work-reports')) {
      return { navItems: getWorkReportsNavItems(), moduleTitle: 'Reportes Trabajo', moduleIcon: NotebookPen };
    }
    if (pathname.startsWith('/dashboard/rrhh')) {
      return { navItems: getRrhhNavItems(can), moduleTitle: 'Recursos Humanos', moduleIcon: UserCog };
    }
    if (pathname.startsWith('/dashboard/finanzas')) {
      return {
        navItems: [
          { href: '/dashboard/finanzas', icon: LayoutDashboard, label: 'Resultado por Contrato' },
        ],
        moduleTitle: 'Finanzas',
        moduleIcon: DollarSign,
      };
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
    // Bodega fusionada en el Módulo Pagnol: las rutas viejas redirigen, pero si
    // el usuario aterriza en una, mostramos el nav de Pagnol.
    if (pathname.startsWith('/dashboard/bodega')) {
      return { navItems: getPanolNavItems(can), moduleTitle: 'Módulo Pagnol', moduleIcon: Warehouse };
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
    if (pathname.startsWith('/dashboard/configuracion')) {
      return { navItems: getSettingsNavItems(), moduleTitle: 'Configuración', moduleIcon: Settings };
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
