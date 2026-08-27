"use client";

import React from 'react';
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/marketing/site-footer";
import {
  BarChart3,
  PackageCheck,
  ChevronRight,
  HardDrive,
  ArrowRight,
  Building2,
  Lock,
  Linkedin,
  FileSpreadsheet,
  QrCode,
  Wrench,
  Users,
  Zap,
  ShieldCheck,
  Tag,
  LayoutDashboard,
  CheckCircle2,
  FileText,
  Hammer,
  UserPlus,
  ScanFace,
  HardHat,
  ShoppingCart,
  Menu,
  X,
} from 'lucide-react';

const MODULES = [
  {
    icon: LayoutDashboard,
    title: "Dashboard Operativo",
    desc: "Centro de mando en tiempo real con KPIs de inventario, tránsito, valorización, disponibilidad de activos y cumplimiento de mantenimiento.",
    badge: "Live"
  },
  {
    icon: PackageCheck,
    title: "Gestión de Activos ISO 55001",
    desc: "Inventario con jerarquía de activos, matriz de riesgo P×I (Clase A/B/C), MTBF, MTTR, disponibilidad, ciclo de vida completo y fotos por activo.",
    badge: "ISO 55001"
  },
  {
    icon: Wrench,
    title: "Mantenimiento ISO 55001",
    desc: "OTs preventivas, correctivas y predictivas con código interno automático. Cierre con RCA (Análisis Causa Raíz), acciones preventivas y registro de tiempo de inactividad.",
    badge: "Mantenimiento"
  },
  {
    icon: FileText,
    title: "Acta de Entrega de Activos (EA)",
    desc: "Documento legal digital conforme al Art. 11 del Código del Trabajo Chile. Generación PDF automática, firma digital y tracking de envío a la Dirección del Trabajo.",
    badge: "Legal"
  },
  {
    icon: ArrowRight,
    title: "Movimientos / Despacho",
    desc: "Flujo de retiro y retorno con aprobación por clase de activo (A/B/C), firma digital del supervisor y contrato de responsabilidad imprimible.",
    badge: "Core"
  },
  {
    icon: Hammer,
    title: "Herramientas como Activos",
    desc: "El pool de herramientas se gestiona dentro de Activos (superficie única): estados disponible / en uso / en mantenimiento, \"en posesión de\" por trabajador y trazabilidad por operario y turno.",
    badge: "Core"
  },
  {
    icon: Users,
    title: "Gestión de Personal",
    desc: "Directorio de empleados con roles, cargos, reconocimiento facial (Face-API), historial de activos asignados y control de permisos granular por módulo.",
    badge: "Core"
  },
  {
    icon: FileSpreadsheet,
    title: "Carga Masiva ISO 55001",
    desc: "Ingesta de activos vía plantilla Excel alineada con ISO 55001. Detección de duplicados, auto-categorización y mapeo de ERPs legacy.",
    badge: "ISO 55001"
  },
  {
    icon: Tag,
    title: "Etiquetas QR / Barcode",
    desc: "Generación e impresión de etiquetas con QR, código interno secuencial y logo corporativo. Compatible con impresoras térmicas industriales.",
    badge: "Hardware"
  },
  {
    icon: BarChart3,
    title: "Informes y Reportes",
    desc: "Reportes exportables de inventario, movimientos, valorización, KPIs ISO 55001, disponibilidad de activos y cumplimiento de mantenimiento.",
    badge: "Analytics"
  },
  {
    icon: Zap,
    title: "AI Diagnostic Engine",
    desc: "Asistente inteligente con Gemini que analiza inventario, mantenimiento y operaciones en tiempo real entregando alertas y recomendaciones estratégicas.",
    badge: "IA"
  },
  {
    icon: UserPlus,
    title: "Invitaciones y Acceso",
    desc: "Invitación de usuarios por correo con asignación de rol. Onboarding controlado sin exposición de credenciales y auditoría de accesos por tenant.",
    badge: "Seguridad"
  },
];

const BADGE_COLORS: Record<string, string> = {
  "Live": "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400",
  "Core": "bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300",
  "ISO 55001": "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400",
  "Hardware": "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400",
  "Analytics": "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-400",
  "IA": "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400",
  "Seguridad": "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400",
  "Mantenimiento": "bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-400",
  "Legal": "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400",
};

// Flujo core del pañol — la historia del producto en 4 pasos
const PANOL_STEPS = [
  {
    icon: UserPlus,
    title: "Enrola",
    desc: "Cada trabajador queda registrado con su credencial QR y su rostro. Enrolamiento presencial o por link de invitación.",
  },
  {
    icon: ScanFace,
    title: "Verifica",
    desc: "En el mesón del pañol, verificación facial 1:1 contra su registro. Nadie retira activos a nombre de otro.",
  },
  {
    icon: PackageCheck,
    title: "Entrega y Devuelve",
    desc: "Despacho y recepción con aprobación según criticidad del activo (Clase A/B/C), firma digital y acta imprimible.",
  },
  {
    icon: BarChart3,
    title: "Trazabilidad Total",
    desc: "Kardex en tiempo real: quién tiene qué, en qué contrato y en qué pañol — con stock valorizado y exportable.",
  },
];

// La suite que crece alrededor del pañol
const SUITE_GROUPS = [
  {
    icon: ShoppingCart,
    title: "Abastecimiento",
    desc: "El ciclo completo de compras conectado al pañol.",
    features: [
      "Solicitudes de material, compra y arriendo con autorización ADC",
      "RFQ con comparador de cotizaciones — la IA lee los PDF de tus proveedores",
      "Órdenes de compra, recepción ligada a OC y proveedores 360°",
      "Costos por centro de costo y alertas de abastecimiento",
    ],
  },
  {
    icon: HardHat,
    title: "Terreno",
    desc: "Lo que pasa en la faena, documentado y firmado.",
    features: [
      "Reportes de trabajo en cascada: OT → diario → semanal (formato SQM)",
      "PDF y firmas digitales en cada nivel",
      "Órdenes de trabajo con modo offline — opera sin señal y sincroniza al volver",
      "Panel ejecutivo de avance",
    ],
  },
  {
    icon: Users,
    title: "Personas",
    desc: "Del registro diario al finiquito, sin planillas paralelas.",
    features: [
      "Asistencia diaria con reportes semanales y mensuales",
      "Cálculo de remuneraciones y finiquitos",
      "RRHH: empleados, documentos y solicitudes",
      "Seguridad CPHS: charlas, checklists, inspecciones y observaciones",
    ],
  },
  {
    icon: Building2,
    title: "Administración",
    desc: "El control financiero y contractual de la operación.",
    features: [
      "Arriendos de equipos — cada equipo arrendado se vuelve un activo trazable",
      "Estados de pago por contrato",
      "Facturas, adelantos y pagos a proveedores",
      "Multi-empresa: cada tenant con sus datos aislados, logo y correlativos propios",
    ],
  },
];

const LandingPage: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-white">

      {/* Navigation */}
      <nav className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 max-w-7xl mx-auto border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex flex-col">
            <h1 className="text-lg sm:text-xl font-black tracking-tighter text-foreground">PAGNOL</h1>
            <p className="text-[8px] sm:text-xs font-bold tracking-[0.2em] text-primary leading-none sm:mt-1">ASSET MANAGEMENT</p>
          </Link>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <Link href="#panol" className="hover:text-foreground transition-colors">Pañol</Link>
          <Link href="#modules" className="hover:text-foreground transition-colors">Módulos</Link>
          <Link href="#suite" className="hover:text-foreground transition-colors">Suite</Link>
          <Link href="#iso" className="hover:text-foreground transition-colors">ISO 55001</Link>
          <Link href="#hardware" className="hover:text-foreground transition-colors">Hardware</Link>
          <Link href="#about" className="hover:text-foreground transition-colors">Nosotros</Link>
          <Link href="/ayuda" className="hover:text-foreground transition-colors">Ayuda</Link>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <Button asChild variant="outline" className="inline-flex bg-transparent border-[#1A3A44] text-[#1A3A44] dark:border-[#1A3A44] dark:text-[#1A3A44] px-3 py-2.5 rounded-xl font-bold text-[10px] sm:text-xs transition-all hover:bg-[#1A3A44] hover:text-white gap-2 uppercase tracking-widest shrink-0">
            <Link href="/pricing">
              <Building2 className="h-4 w-4" />
              <span>Comenzar</span>
            </Link>
          </Button>
          <Button asChild className="bg-primary hover:bg-primary/90 text-white px-3 py-2.5 rounded-xl font-bold text-[10px] sm:text-xs transition-all shadow-lg shadow-primary/20 active:scale-95 flex items-center gap-2 uppercase tracking-widest shrink-0">
            <Link href="/login">
              <Lock className="h-4 w-4" />
              <span>Acceso Personal</span>
            </Link>
          </Button>
          <button
            type="button"
            aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setMobileMenuOpen((o) => !o)}
            className="md:hidden p-2 rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Menú móvil (anchors) */}
      {mobileMenuOpen && (
        <div className="md:hidden sticky top-[65px] z-40 bg-background/95 backdrop-blur-md border-b border-border px-6 py-4 flex flex-col gap-1 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          {[
            ["#panol", "Pañol"],
            ["#modules", "Módulos"],
            ["#suite", "Suite"],
            ["#iso", "ISO 55001"],
            ["#hardware", "Hardware"],
            ["#about", "Nosotros"],
            ["/ayuda", "Centro de Ayuda"],
          ].map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className="py-2.5 px-3 rounded-xl hover:bg-muted hover:text-foreground transition-colors">
              {label}
            </Link>
          ))}
        </div>
      )}

      {/* Hero */}
      <section className="relative px-8 py-20 md:py-28 max-w-7xl mx-auto overflow-hidden">
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-16 items-center">
        <div className="text-center md:text-left">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1 rounded-full text-primary text-[10px] font-black uppercase tracking-widest mb-6 animate-bounce">
            <ShieldCheck size={12} /> Control Total en el Corazón de tu Faena
          </div>
          <h1 className="text-4xl xs:text-5xl md:text-7xl font-black leading-[1.1] mb-6 tracking-tighter text-foreground">
            El <span className="text-primary">Pagnol digital</span> de tu faena.
          </h1>
          <p className="text-muted-foreground text-base md:text-xl leading-relaxed mb-8 max-w-2xl">
            PAGNOL es el sistema de gestión de activos diseñado para todos los activos de tu empresa. Cada activo es trazable en tiempo real: quién la tiene, quien la autorizo y en qué pañol. PAGNOL parte por ordenar tu pañol y crece hasta cubrir toda tu operación.
          </p>
          <div className="flex flex-wrap gap-3 mb-10 justify-center md:justify-start">
            {["Verificación Facial", "Funciona Sin Señal", "Stock Multi-Contrato", "Acta EA — Art. 11 CT Chile"].map((f, i) => (
              <span key={i} className="flex items-center gap-1.5 bg-muted border border-border text-foreground px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest">
                <CheckCircle2 size={10} className="text-primary" /> {f}
              </span>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-2xl font-black text-lg transition-all shadow-2xl shadow-primary/40 flex items-center justify-center gap-3 group">
              <Link href="/pricing">
                Contratar Servicio <ChevronRight className="group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="bg-[#0F172A] border border-[#0F172A]/80 hover:bg-[#0F172A]/90 text-white px-8 py-4 rounded-2xl font-black text-lg transition-all flex items-center justify-center gap-3">
              <Link href="/demo">
                Ver Demo
              </Link>
            </Button>
          </div>
        </div>
        {/* Screenshot real del producto */}
        <div className="relative hidden lg:block">
          <div className="bg-card p-3 rounded-[2rem] shadow-2xl shadow-primary/15 border border-border rotate-1 hover:rotate-0 transition-transform duration-500">
            <img
              src="/img/landing/movimientos.png"
              alt="PAGNOL — Control de Movimientos: trazabilidad biométrica de activos, despacho y recepción"
              className="rounded-[1.5rem] w-full"
            />
          </div>
          <div className="absolute -bottom-5 -left-5 bg-[#0F172A] text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3">
            <ScanFace className="text-primary" size={26} />
            <div>
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-widest">El producto real</p>
              <p className="text-sm font-black uppercase tracking-tight">Trazabilidad Biométrica</p>
            </div>
          </div>
        </div>
        </div>
        <div className="absolute top-1/2 -right-20 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
      </section>

      {/* Stats Bar */}
      <section className="border-y border-[#1A3A44]/30 bg-[#1A3A44]">
        <div className="max-w-7xl mx-auto px-8 py-8 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "+20", label: "Módulos Operativos" },
            { value: "ISO 55000/55001/55002", label: "Package Completo" },
            { value: "Realtime + Offline", label: "Opera Con o Sin Señal" },
            { value: "Art. 11 CT", label: "Acta EA Digital" },
          ].map((s, i) => (
            <div key={i} className="space-y-1">
              <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{s.value}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* El Pañol — flujo core */}
      <section id="panol" className="px-8 py-24 bg-background">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block bg-orange-100 dark:bg-orange-500/20 px-3 py-1 rounded-full text-primary text-[10px] font-black uppercase tracking-widest mb-4">El Módulo Central</div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-foreground">Todo empieza en el <span className="text-primary">pañol</span>.</h2>
            <p className="text-muted-foreground font-medium max-w-2xl mx-auto">El mesón donde se entregan y devuelven los activos es donde se pierde — o se gana — el control de la faena. PAGNOL lo digitaliza en 4 pasos.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              {PANOL_STEPS.map((step, i) => (
                <div key={i} className="flex items-start gap-5">
                  <div className="relative shrink-0">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                      <step.icon size={26} />
                    </div>
                    <span className="absolute -top-2 -right-2 w-6 h-6 bg-primary text-white rounded-full flex items-center justify-center text-[11px] font-black">{i + 1}</span>
                  </div>
                  <div>
                    <h4 className="text-lg font-black tracking-tight text-foreground mb-1">{step.title}</h4>
                    <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="relative">
              <div className="bg-card p-3 rounded-[2rem] shadow-2xl shadow-primary/10 border border-border">
                <img
                  src="/img/landing/activos.png"
                  alt="PAGNOL — Gestión de Activos: catálogo maestro con clasificación por criticidad, filtros por contrato y estados operativos"
                  className="rounded-[1.5rem] w-full"
                />
              </div>
              <div className="absolute -bottom-5 -right-5 bg-[#0F172A] text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3">
                <QrCode className="text-primary" size={24} />
                <div>
                  <p className="text-[9px] font-bold text-white/60 uppercase tracking-widest">Cada activo con</p>
                  <p className="text-sm font-black uppercase tracking-tight">QR y Criticidad A/B/C</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modules Grid */}
      <section id="modules" className="px-8 py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block bg-orange-100 dark:bg-orange-500/20 px-3 py-1 rounded-full text-primary text-[10px] font-black uppercase tracking-widest mb-4">El Núcleo — Módulo Pañol</div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-foreground">Todo lo que necesita<br />para controlar su faena.</h2>
            <p className="text-muted-foreground font-medium max-w-2xl mx-auto">Diseñado junto a operadores mineros reales. Activos ISO 55001, mantenimiento, despacho, verificación facial y documentos legales — y una suite completa de abastecimiento, terreno y personas alrededor.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {MODULES.map((mod, idx) => (
              <div key={idx} className="group p-8 rounded-[2.5rem] bg-card border border-border hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/10 transition-all duration-300 flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary group-hover:scale-110 group-hover:bg-primary group-hover:text-white transition-all duration-300">
                    <mod.icon size={28} />
                  </div>
                  <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ${BADGE_COLORS[mod.badge] || 'bg-muted text-muted-foreground'}`}>
                    {mod.badge}
                  </span>
                </div>
                <div>
                  <h4 className="text-lg font-black mb-2 tracking-tight text-foreground">{mod.title}</h4>
                  <p className="text-muted-foreground text-sm leading-relaxed">{mod.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Suite — crece alrededor del pañol */}
      <section id="suite" className="px-8 py-24 bg-background">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block bg-orange-100 dark:bg-orange-500/20 px-3 py-1 rounded-full text-primary text-[10px] font-black uppercase tracking-widest mb-4">La Suite Completa</div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-foreground">Y crece con <span className="text-primary">tu operación</span>.</h2>
            <p className="text-muted-foreground font-medium max-w-2xl mx-auto">Alrededor del pañol, más de 20 módulos que comparten los mismos datos: lo que se compra, se arrienda, se entrega y se reporta queda conectado — sin planillas paralelas.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SUITE_GROUPS.map((group, i) => (
              <div key={i} className="group p-8 md:p-10 rounded-[2.5rem] bg-card border border-border hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/10 transition-all duration-300">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary group-hover:scale-110 group-hover:bg-primary group-hover:text-white transition-all duration-300 shrink-0">
                    <group.icon size={28} />
                  </div>
                  <div>
                    <h4 className="text-xl font-black tracking-tight text-foreground">{group.title}</h4>
                    <p className="text-muted-foreground text-sm font-medium">{group.desc}</p>
                  </div>
                </div>
                <ul className="space-y-3 mt-6">
                  {group.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed">
                      <CheckCircle2 size={16} className="text-primary shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ISO 55001 Section */}
      <section id="iso" className="px-8 py-24 industrial-gradient text-white overflow-hidden relative">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary rounded-full blur-[150px] translate-x-1/3 -translate-y-1/3"></div>
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600 rounded-full blur-[120px] -translate-x-1/3 translate-y-1/3"></div>
        </div>
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <div className="inline-block bg-primary/20 border border-primary/30 px-3 py-1 rounded-full text-primary text-[10px] font-black uppercase tracking-widest">ISO 55000 · 55001 · 55002 Package</div>
              <h2 className="text-5xl font-black tracking-tighter leading-none">Software diseñado para ayudarte a cumplir la <span className="text-primary">ISO 55001.</span></h2>
              <p className="text-white/80 text-lg leading-relaxed">
                Las organizaciones — no el software — son las que se certifican en ISO 55001. PAGNOL cubre los tres estándares de la serie: terminología (55000), requisitos (55001) y guía de implementación (55002).
              </p>
              <ul className="space-y-4">
                {[
                  "Jerarquía y trazabilidad completa del ciclo de vida de activos",
                  "Matriz de riesgo P×I — clasificación automática Clase A/B/C",
                  "OTs preventivas, correctivas y predictivas con cierre y RCA",
                  "KPIs de disponibilidad: MTBF, MTTR y Disponibilidad por activo",
                  "Acta de Entrega de Activos (EA) digital — Art. 11 CT Chile",
                  "Auditoría de cambios: quién hizo qué y cuándo",
                  "Reportes exportables para procesos de certificación",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-white/90 text-sm font-medium">
                    <CheckCircle2 size={18} className="text-primary shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "ISO 55000", desc: "Vocabulario, conceptos y terminología de gestión de activos", color: "border-white/20" },
                { label: "ISO 55001", desc: "Requisitos del sistema: OTs, riesgo P×I, MTBF/MTTR, ciclo de vida", color: "border-primary/50", highlight: true },
                { label: "ISO 55002", desc: "Guía de implementación: Acta EA, mantenimiento, documentación", color: "border-white/20" },
                { label: "PAGNOL", desc: "ERP operacional que cubre los tres estándares en producción", color: "border-blue-500/50" },
              ].map((box, i) => (
                <div key={i} className={`p-6 rounded-[2rem] border-2 bg-white/5 backdrop-blur-sm ${box.color} ${box.highlight ? 'bg-primary/10' : ''}`}>
                  <p className={`text-xl font-black tracking-tighter mb-2 ${box.highlight ? 'text-primary' : 'text-white'}`}>{box.label}</p>
                  <p className="text-white/70 text-xs font-bold uppercase tracking-wide leading-relaxed">{box.desc}</p>
                </div>
              ))}
            </div>
          </div>
          {/* Prueba visual: módulo de mantenimiento en producción */}
          <div className="mt-16 relative">
            <div className="bg-white/5 backdrop-blur-sm p-3 rounded-[2rem] border border-white/15 shadow-2xl">
              <img
                src="/img/landing/mantenimiento.png"
                alt="PAGNOL — Gestión de Mantenimiento ISO 55001: disponibilidad física, MTBF, MTTR y órdenes de trabajo"
                className="rounded-[1.5rem] w-full"
              />
            </div>
            <div className="absolute -top-5 left-8 bg-primary text-white px-5 py-2.5 rounded-2xl shadow-2xl">
              <p className="text-xs font-black uppercase tracking-widest">MTBF · MTTR · Disponibilidad — en producción</p>
            </div>
          </div>
        </div>
      </section>

      {/* Hardware Section */}
      <section id="hardware" className="px-8 py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16">
          <div className="flex-1 space-y-8">
            <div className="inline-block bg-orange-100 dark:bg-orange-500/20 px-3 py-1 rounded-full text-primary text-[10px] font-black uppercase tracking-widest">Hardware Pack</div>
            <h2 className="text-5xl font-black tracking-tighter leading-none text-foreground">Equipamiento <span className="text-primary">Plug & Play</span>.</h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              PAGNOL incluye hardware industrial certificado para identificar activos y generar etiquetas en faena. Listo para operar desde el primer día.
            </p>
            <ul className="space-y-4">
              {[
                { icon: QrCode, label: "Pistola Láser QR / Barcode Industrial", desc: "Lectura USB/Bluetooth. Compatible con todos los módulos de despacho e inventario." },
                { icon: Tag, label: "Impresora Térmica de Etiquetas QR", desc: "Genera etiquetas adhesivas 22×32mm con código QR único por activo y logo corporativo." },
              ].map((item, idx) => (
                <li key={idx} className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-orange-100 dark:bg-orange-500/20 text-primary rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                    <item.icon size={18} />
                  </div>
                  <div>
                    <p className="font-black text-foreground">{item.label}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex-1 relative">
            <div className="bg-card p-4 rounded-[3rem] shadow-2xl border border-border">
              <img
                src="https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&q=80&w=1000"
                alt="Hardware Industrial"
                className="rounded-[2.5rem] w-full h-[400px] object-cover"
              />
            </div>
            <div className="absolute -bottom-6 -left-6 bg-[#0F172A] text-white p-6 rounded-3xl shadow-2xl flex items-center gap-4 border border-border">
              <HardDrive className="text-primary" size={40} />
              <div>
                <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Contrato de</p>
                <p className="text-xl font-black uppercase tracking-tighter">Responsabilidad</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section id="about" className="px-8 py-24 bg-background">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20 space-y-4">
            <h2 className="text-4xl font-black tracking-tight text-foreground">Nuestros Fundadores</h2>
            <p className="text-muted-foreground font-medium text-lg">Experiencia multidisciplinaria unida por la innovación.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
            {([
              { name: "Javier Ramírez Ch.", image: "/img/team/javier.png", roles: ["Emprendedor", "Experto en Nanotecnología", "Fundador y CEO de Nanofix", "MBA, Reino Unido"], linkedin: null },
              { name: "Francisco Valdés A.", image: "/img/team/francisco.png", roles: ["Empresario", "Fundador y CEO de Valar Servicios a la Minería", "Magister Innovación y Emprendimiento, UDD", "Ingeniero Industrial"], linkedin: null },
              { name: "Germán Arellano C.", image: "/img/team/german.png", roles: ["Emprendedor serial", "Experto en bebidas y aguas", "Fundador y CEO Ur Garbia S.A.", "PhD Advanced Management (U. Lleida)", "MBA (UAI)"], linkedin: null },
              { name: "Steven Nuñez", image: "/img/team/steven.png", roles: ["Dev Full stack", "Fundador y CEO de TeoLabs", "CTO Pagnol"], linkedin: "https://www.linkedin.com/in/steven-nuñez" },
            ] as { name: string; image: string; roles: string[]; linkedin: string | null }[]).map((member, i) => (
              <div key={i} className="flex flex-col items-center text-center p-8 rounded-[2.5rem] bg-card border border-border hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/10 transition-all group">
                <div className="w-40 h-40 rounded-[2.5rem] overflow-hidden border-4 border-primary/20 shadow-xl mb-6 group-hover:scale-105 transition-transform">
                  <img src={member.image} alt={member.name} className="w-full h-full object-cover" />
                </div>
                <h4 className="text-xl font-black uppercase tracking-tight text-foreground">{member.name}</h4>
                <div className="w-10 h-1 bg-primary rounded-full my-4 opacity-50"></div>
                <div className="space-y-2 mb-6">
                  {member.roles.map((role, r) => (
                    <p key={r} className="text-sm font-bold text-muted-foreground leading-tight">{role}</p>
                  ))}
                </div>
                {member.linkedin && (
                  <div className="flex items-center gap-4 mt-auto">
                    <Link href={member.linkedin} target="_blank" rel="noopener noreferrer" className="p-2 bg-muted rounded-xl shadow-sm hover:text-primary transition-colors text-muted-foreground">
                      <Linkedin size={18} />
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-20 text-center">
            <h3 className="text-5xl md:text-6xl font-black text-foreground/80 tracking-tighter uppercase">Juntos creamos Pagnol</h3>
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <footer className="px-8 pt-24 bg-[#1A3A44] text-center relative overflow-hidden">
        <div className="max-w-3xl mx-auto relative z-10">
          <h2 className="text-5xl font-black tracking-tighter mb-8 text-white">¿Listo para modernizar su pañol?</h2>
          <p className="text-white/80 mb-12 text-lg">Del pañol a toda tu operación: activos ISO 55001, mantenimiento, abastecimiento, terreno y personas. Con verificación facial, modo offline y Acta EA legal.</p>
          <Button asChild size="lg" className="inline-flex items-center gap-3 bg-primary text-white hover:bg-primary/90 px-10 py-5 rounded-2xl font-black text-xl transition-all shadow-2xl shadow-black/30 active:scale-95 group">
            <Link href="/pricing">
              Comenzar Ahora <ArrowRight className="group-hover:translate-x-2 transition-transform" />
            </Link>
          </Button>
        </div>
        <div className="mt-24 relative z-10">
          <SiteFooter />
        </div>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[1200px] h-[400px] bg-primary/10 rounded-full blur-[120px] -z-0"></div>
      </footer>
    </div>
  );
};
export default LandingPage;