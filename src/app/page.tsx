"use client";

import React from 'react';
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Fingerprint,
  BarChart3,
  PackageCheck,
  ChevronRight,
  HardDrive,
  ArrowRight,
  Building2,
  Lock,
  Linkedin,
  Twitter,
  Instagram,
  Facebook,
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
} from 'lucide-react';
import { ThemeSwitcher } from '@/components/theme-switcher';

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
    title: "Herramientas",
    desc: "Control independiente del pool de herramientas con estados: disponible, en uso y en mantenimiento. Trazabilidad por operario y turno.",
    badge: "Core"
  },
  {
    icon: Users,
    title: "Gestión de Personal",
    desc: "Directorio de empleados con roles, cargos, biometría DigitalPersona, historial de activos asignados y control de permisos granular por módulo.",
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

const LandingPage: React.FC = () => {
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
          <Link href="#modules" className="hover:text-foreground transition-colors">Módulos</Link>
          <Link href="#iso" className="hover:text-foreground transition-colors">ISO 55001</Link>
          <Link href="#hardware" className="hover:text-foreground transition-colors">Hardware</Link>
          <Link href="#about" className="hover:text-foreground transition-colors">Nosotros</Link>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeSwitcher />
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
        </div>
      </nav>

      {/* Hero */}
      <section className="relative px-8 py-20 md:py-36 max-w-7xl mx-auto overflow-hidden">
        <div className="relative z-10 max-w-3xl text-center md:text-left">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1 rounded-full text-primary text-[10px] font-black uppercase tracking-widest mb-6 animate-bounce">
            <ShieldCheck size={12} /> Solución Estándar Minero
          </div>
          <h1 className="text-4xl xs:text-5xl md:text-7xl font-black leading-[1.1] mb-6 tracking-tighter text-foreground">
            Control <span className="text-primary">Total</span> en el Corazón de la Faena.
          </h1>
          <p className="text-muted-foreground text-base md:text-xl leading-relaxed mb-8 max-w-2xl">
            PAGNOL es el sistema de gestión de activos diseñado a tu medida ya que conectamos tu Sistema de Inventario o ERP con la Faena para que tengas la información actualizada siempre.
          </p>
          <div className="flex flex-wrap gap-3 mb-10 justify-center md:justify-start">
            {["12 Módulos Operativos", "ISO 55000/55001/55002 Package Completo", "Acta EA — Art. 11 CT Chile"].map((f, i) => (
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
        <div className="absolute top-1/2 -right-20 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="hidden lg:block absolute top-1/2 right-0 -translate-y-1/2 w-1/3 aspect-square border-2 border-[#1A3A44]/40 rounded-[4rem] rotate-12 -z-0 opacity-60"></div>
        <div className="hidden lg:block absolute top-1/3 right-10 -translate-y-1/2 w-1/4 aspect-square border border-[#1A3A44]/20 rounded-[3rem] -rotate-6 -z-0"></div>
      </section>

      {/* Stats Bar */}
      <section className="border-y border-[#1A3A44]/30 bg-[#1A3A44]">
        <div className="max-w-7xl mx-auto px-8 py-8 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "12", label: "Módulos Activos" },
            { value: "ISO 55000/55001/55002", label: "Package Completo" },
            { value: "100%", label: "Tiempo Real" },
            { value: "Art. 11 CT", label: "Chile Laboral" },
          ].map((s, i) => (
            <div key={i} className="space-y-1">
              <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{s.value}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Modules Grid */}
      <section id="modules" className="px-8 py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block bg-orange-100 dark:bg-orange-500/20 px-3 py-1 rounded-full text-primary text-[10px] font-black uppercase tracking-widest mb-4">Plataforma Completa</div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-foreground">Todo lo que necesita<br />para controlar su faena.</h2>
            <p className="text-muted-foreground font-medium max-w-2xl mx-auto">12 módulos diseñados junto a operadores mineros reales. Activos ISO 55001, mantenimiento, despacho, biometría y documentos legales.</p>
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
            {[
              { name: "Javier Ramírez Ch.", age: "54", image: "/img/team/javier.png", roles: ["Emprendedor", "Experto en Nanotecnología", "Fundador y CEO de Nanofix", "MBA, Reino Unido"], socials: { linkedin: "https://www.linkedin.com/GAC" } },
              { name: "Francisco Valdés A.", age: "42", image: "/img/team/francisco.png", roles: ["Empresario", "Fundador y CEO de Valar Servicios a la Minería", "Magister Innovación y Emprendimiento, UDD", "Ingeniero Industrial"], socials: { linkedin: "https://www.linkedin.com/JRA" } },
              { name: "Germán Arellano C.", age: "60", image: "/img/team/german.png", roles: ["Emprendedor serial", "Experto en bebidas y aguas", "Fundador y CEO Ur Garbia S.A.", "PhD Advanced Management (U. Lleida)", "MBA (UAI)"], socials: { linkedin: "https://www.linkedin.com/FVA" } },
              { name: "Steven Nuñez", age: "36", image: "/img/team/steven.png", roles: ["Dev Full stack", "Fundador y CEO de TeoLabs", "CTO Pagnol"], socials: { linkedin: "https://www.linkedin.com/in/steven-nuñez" } },
            ].map((member, i) => (
              <div key={i} className="flex flex-col items-center text-center p-8 rounded-[2.5rem] bg-card border border-border hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/10 transition-all group">
                <div className="w-40 h-40 rounded-[2.5rem] overflow-hidden border-4 border-primary/20 shadow-xl mb-6 group-hover:scale-105 transition-transform">
                  <img src={member.image} alt={member.name} className="w-full h-full object-cover" />
                </div>
                <h4 className="text-xl font-black uppercase tracking-tight text-foreground">{member.name} <span className="text-muted-foreground text-sm ml-1">({member.age})</span></h4>
                <div className="w-10 h-1 bg-primary rounded-full my-4 opacity-50"></div>
                <div className="space-y-2 mb-6">
                  {member.roles.map((role, r) => (
                    <p key={r} className="text-sm font-bold text-muted-foreground leading-tight">{role}</p>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-auto">
                  <Link href={member.socials.linkedin} className="p-2 bg-muted rounded-xl shadow-sm hover:text-primary transition-colors text-muted-foreground">
                    <Linkedin size={18} />
                  </Link>
                  <Link href="#" className="p-2 bg-muted rounded-xl shadow-sm hover:text-primary transition-colors text-muted-foreground"><Twitter size={18} /></Link>
                  <Link href="#" className="p-2 bg-muted rounded-xl shadow-sm hover:text-primary transition-colors text-muted-foreground"><Instagram size={18} /></Link>
                  <Link href="#" className="p-2 bg-muted rounded-xl shadow-sm hover:text-primary transition-colors text-muted-foreground"><Facebook size={18} /></Link>
                </div>
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
          <p className="text-white/80 mb-12 text-lg">12 módulos operativos. Mantenimiento ISO 55001. Acta EA legal. Biometría. AI. Todo incluido.</p>
          <Button asChild size="lg" className="inline-flex items-center gap-3 bg-primary text-white hover:bg-primary/90 px-10 py-5 rounded-2xl font-black text-xl transition-all shadow-2xl shadow-black/30 active:scale-95 group">
            <Link href="/pricing">
              Comenzar Ahora <ArrowRight className="group-hover:translate-x-2 transition-transform" />
            </Link>
          </Button>
        </div>
        <div className="mt-24 border-t border-white/10">
          <div className="max-w-7xl mx-auto px-8 py-6 flex flex-col md:flex-row items-center justify-between text-white/60 text-[10px] font-bold uppercase tracking-widest gap-4">
            <p className="text-center md:text-left">© {new Date().getFullYear()} PAGNOL ASSET MANAGEMENT. ALL RIGHTS RESERVED.</p>
            <div className="flex items-center gap-8">
              <Link href="#" className="hover:text-white transition-colors">Privacidad</Link>
              <Link href="#" className="hover:text-white transition-colors">Términos</Link>
              <Link href="#" className="hover:text-white transition-colors">Soporte</Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[1200px] h-[400px] bg-primary/10 rounded-full blur-[120px] -z-0"></div>
      </footer>
    </div>
  );
};
export default LandingPage;