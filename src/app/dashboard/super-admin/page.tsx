"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Users,
  Crown,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  TrendingUp,
  HardDrive,
  FileText,
  QrCode,
  Printer,
} from "lucide-react";
import { supabase } from "@/modules/core/lib/supabase";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { useRouter } from "next/navigation";

interface TenantSummary {
  id: string;
  name: string;
  tenant_id: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  user_count: number;
  hardware_assigned: { qr_scanner?: boolean; thermal_printer?: boolean } | null;
  contract_signed: boolean | null;
}

const planColors: Record<string, string> = {
  enterprise: "bg-pagnol-orange/10 text-pagnol-orange border-pagnol-orange/20",
  professional: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
  starter: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400",
};

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && user.role !== "super-admin") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const { data: tenantsData } = await supabase
        .from("tenants")
        .select("id, name, tenant_id, plan, is_active, created_at, hardware_assigned, contract_signed")
        .order("created_at", { ascending: false });

      if (!tenantsData) { setLoading(false); return; }

      const enriched: TenantSummary[] = await Promise.all(
        tenantsData.map(async (t) => {
          const { count } = await supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", t.id);
          return { ...t, user_count: count ?? 0 };
        })
      );

      setTenants(enriched);
      setLoading(false);
    };

    fetchData();
  }, []);

  const totalUsers = tenants.reduce((s, t) => s + t.user_count, 0);
  const activeTenants = tenants.filter((t) => t.is_active).length;
  const enterpriseTenants = tenants.filter((t) => t.plan === "enterprise").length;

  const stats = [
    { label: "Empresas Registradas", value: tenants.length, icon: Building2, color: "text-pagnol-orange" },
    { label: "Empresas Activas", value: activeTenants, icon: CheckCircle2, color: "text-green-500" },
    { label: "Total Usuarios", value: totalUsers, icon: Users, color: "text-blue-500" },
    { label: "Plan Enterprise", value: enterpriseTenants, icon: Crown, color: "text-pagnol-orange" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Panel Global"
        description="Vista centralizada de todas las empresas y su estado en Pagnol."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-[2rem] border-none shadow-lg bg-slate-100 dark:bg-card">
            <CardContent className="p-6 flex items-center gap-4">
              <div className={`p-3 rounded-2xl bg-slate-100 dark:bg-white/5 ${s.color}`}>
                <s.icon size={22} />
              </div>
              <div>
                <p className="text-2xl font-black">{loading ? "—" : s.value}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tenant Grid */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Building2 size={16} className="text-pagnol-orange" />
          <p className="text-[10px] font-black uppercase tracking-widest text-pagnol-orange">Empresas Registradas</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="rounded-[2rem] border-none shadow animate-pulse bg-slate-100 dark:bg-slate-800 h-56" />
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <Card className="rounded-[2rem] border-none shadow p-10 text-center text-muted-foreground">
            <p className="font-bold uppercase tracking-widest text-sm">Sin empresas registradas</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {tenants.map((tenant) => {
              const hw = tenant.hardware_assigned;
              const hasQR = hw?.qr_scanner;
              const hasPrinter = hw?.thermal_printer;
              return (
                <Link key={tenant.id} href={`/dashboard/super-admin/tenants/${tenant.id}`}>
                  <Card className="rounded-[2rem] border border-slate-100 dark:border-white/5 shadow-lg hover:shadow-xl transition-all h-full cursor-pointer bg-slate-100 dark:bg-card group">
                    <CardHeader className="p-6 pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm font-black uppercase leading-tight truncate group-hover:text-pagnol-orange transition-colors">
                            {tenant.name}
                          </CardTitle>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{tenant.tenant_id}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <Badge className={`text-[9px] font-black uppercase rounded-lg border ${planColors[tenant.plan] ?? planColors.starter}`}>
                            {tenant.plan}
                          </Badge>
                          <Badge className={`text-[9px] font-black uppercase rounded-lg border-none ${tenant.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                            {tenant.is_active ? "Activa" : "Inactiva"}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-6 pb-6 space-y-4">
                      {/* Stats row */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Users size={13} />
                          <span className="font-bold">{tenant.user_count}</span> usuarios
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock size={13} />
                          {new Date(tenant.created_at).toLocaleDateString("es-CL", { month: "short", year: "numeric" })}
                        </span>
                      </div>

                      {/* Hardware chips */}
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase rounded-lg px-2 py-1 ${hasQR ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-slate-100 text-muted-foreground dark:bg-white/5'}`}>
                          <QrCode size={10} /> Escáner QR
                          {hasQR ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase rounded-lg px-2 py-1 ${hasPrinter ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-slate-100 text-muted-foreground dark:bg-white/5'}`}>
                          <Printer size={10} /> Impresora
                          {hasPrinter ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase rounded-lg px-2 py-1 ${tenant.contract_signed ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-slate-100 text-muted-foreground dark:bg-white/5'}`}>
                          <FileText size={10} /> Contrato
                          {tenant.contract_signed ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                        </span>
                      </div>

                      <Button size="sm" variant="ghost" className="w-full h-8 rounded-xl text-[10px] font-black uppercase tracking-widest text-pagnol-orange hover:bg-pagnol-orange/10 border border-pagnol-orange/20 group-hover:bg-pagnol-orange group-hover:text-white transition-all">
                        Ver Detalle <ArrowRight size={12} className="ml-1" />
                      </Button>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { href: "/dashboard/super-admin/tenants", icon: Building2, label: "Gestionar Empresas", desc: "Alta, baja y edición de tenants" },
          { href: "/dashboard/super-admin/hardware", icon: HardDrive, label: "Control de Hardware", desc: "Asignación de equipos por empresa" },
          { href: "/dashboard/super-admin/contracts", icon: FileText, label: "Contratos", desc: "Auditoría de contratos firmados" },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="rounded-[2rem] border-none shadow hover:shadow-lg transition-all cursor-pointer bg-pagnol-teal text-white group h-full">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 bg-white/10 rounded-2xl group-hover:bg-white/20 transition-colors">
                  <item.icon size={20} className="text-pagnol-orange" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest leading-tight">{item.label}</p>
                  <p className="text-[10px] text-white/60 mt-0.5">{item.desc}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
