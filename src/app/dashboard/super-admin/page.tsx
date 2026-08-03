"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2, Users, Crown, ArrowRight, CheckCircle2, AlertCircle, Clock,
  HardDrive, FileText, QrCode, Printer,
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

// Mapa estático: las clases construidas con template strings se purgan en producción.
const planBadge: Record<string, string> = {
  enterprise: "bg-primary/10 text-primary border-primary/20",
  professional: "bg-info-subtle text-info-subtle-foreground border-info/20",
  starter: "bg-muted text-muted-foreground border-border",
};

const chipOn = "bg-success-subtle text-success-subtle-foreground";
const chipOff = "bg-muted text-muted-foreground";

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

      if (!tenantsData) { setTenants([]); setLoading(false); return; }

      // El conteo va por la ruta admin (service role): contar `profiles` desde el
      // cliente devuelve 0 para quien no sea super-admin.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      const enriched: TenantSummary[] = await Promise.all(
        tenantsData.map(async (t) => {
          try {
            const res = await fetch(`/api/admin/tenant-users?tenantId=${t.id}&countOnly=true`, { headers });
            if (res.ok) return { ...t, user_count: (await res.json()).count ?? 0 };
          } catch { /* informativo: no debe tumbar el panel */ }
          return { ...t, user_count: 0 };
        })
      );

      setTenants(enriched);
      setLoading(false);
    };

    fetchData();
  }, []);

  const totalUsers = tenants.reduce((s, t) => s + t.user_count, 0);
  const stats = [
    { label: "Empresas registradas", value: tenants.length, icon: Building2 },
    { label: "Empresas activas", value: tenants.filter((t) => t.is_active).length, icon: CheckCircle2 },
    { label: "Total usuarios", value: totalUsers, icon: Users },
    { label: "Plan Enterprise", value: tenants.filter((t) => t.plan === "enterprise").length, icon: Crown },
  ];

  return (
    <PageShell
      title="Panel Global"
      description="Vista centralizada de todas las empresas y su estado en Pagnol."
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-[1.5rem] bg-card">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-primary/10 text-primary shrink-0">
                <s.icon size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-black">{loading ? "—" : s.value}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <div className="flex items-center gap-3 mb-4">
          <Building2 size={16} className="text-primary" />
          <p className="text-[10px] font-black uppercase tracking-widest text-primary">Empresas registradas</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="rounded-[1.5rem] animate-pulse bg-muted h-56 border-none" />
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={<Building2 size={36} />}
            title="Sin empresas registradas"
            description="Crea la primera desde Gestión de Empresas."
            action={
              <Link href="/dashboard/super-admin/tenants">
                <Button className="rounded-xl">Ir a Empresas</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {tenants.map((tenant) => {
              const hw = tenant.hardware_assigned;
              return (
                <Link key={tenant.id} href={`/dashboard/super-admin/tenants/${tenant.id}`}>
                  <Card className="rounded-[1.5rem] bg-card hover:shadow-lg transition-all h-full cursor-pointer group">
                    <CardHeader className="p-6 pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm font-black uppercase leading-tight truncate group-hover:text-primary transition-colors">
                            {tenant.name}
                          </CardTitle>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{tenant.tenant_id}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <Badge className={`text-[9px] font-black uppercase rounded-xl border ${planBadge[tenant.plan] ?? planBadge.starter}`}>
                            {tenant.plan}
                          </Badge>
                          <Badge className={`text-[9px] font-black uppercase rounded-xl border-none ${tenant.is_active ? "badge-success" : "bg-destructive/10 text-destructive"}`}>
                            {tenant.is_active ? "Activa" : "Inactiva"}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-6 pb-6 space-y-4">
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

                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase rounded-xl px-2 py-1 ${hw?.qr_scanner ? chipOn : chipOff}`}>
                          <QrCode size={10} /> Escáner QR
                          {hw?.qr_scanner ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase rounded-xl px-2 py-1 ${hw?.thermal_printer ? chipOn : chipOff}`}>
                          <Printer size={10} /> Impresora
                          {hw?.thermal_printer ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase rounded-xl px-2 py-1 ${tenant.contract_signed ? "bg-info-subtle text-info-subtle-foreground" : chipOff}`}>
                          <FileText size={10} /> Contrato
                          {tenant.contract_signed ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                        </span>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 rounded-xl text-[10px] font-black uppercase tracking-widest text-primary border-primary/20 hover:bg-primary hover:text-primary-foreground transition-all"
                      >
                        Ver detalle <ArrowRight size={12} className="ml-1" />
                      </Button>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { href: "/dashboard/super-admin/tenants", icon: Building2, label: "Gestionar empresas", desc: "Alta, baja y edición" },
          { href: "/dashboard/super-admin/hardware", icon: HardDrive, label: "Control de hardware", desc: "Equipos por empresa" },
          { href: "/dashboard/super-admin/contracts", icon: FileText, label: "Contratos", desc: "Auditoría de firmas" },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="rounded-[1.5rem] bg-pagnol-dark text-white border-none hover:shadow-lg transition-all cursor-pointer group h-full">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 bg-white/10 rounded-2xl group-hover:bg-white/20 transition-colors shrink-0">
                  <item.icon size={20} className="text-primary" />
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
    </PageShell>
  );
}