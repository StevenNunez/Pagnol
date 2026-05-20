"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Users, Crown, ArrowRight, CheckCircle2, AlertCircle, QrCode, Printer } from "lucide-react";
import { CreateTenantForm } from "@/components/admin/create-tenant-form";
import { supabase } from "@/modules/core/lib/supabase";

interface TenantRow {
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

export default function SubscriptionsPage() {
  const { can } = useAuth();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTenants = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tenants")
      .select("id, name, tenant_id, plan, is_active, created_at, hardware_assigned, contract_signed")
      .order("created_at", { ascending: false });

    if (!data) { setLoading(false); return; }

    // Get session token once for admin API calls
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    const enriched = await Promise.all(
      data.map(async (t) => {
        try {
          const res = await fetch(`/api/admin/tenant-users?tenantId=${t.id}&countOnly=true`, { headers });
          if (res.ok) {
            const json = await res.json();
            return { ...t, user_count: json.count ?? 0 };
          }
        } catch {}
        return { ...t, user_count: 0 };
      })
    );
    setTenants(enriched);
    setLoading(false);
  };

  useEffect(() => { fetchTenants(); }, []);

  if (!can("module_subscriptions:view")) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle size={36} />
        <p className="font-bold uppercase tracking-widest text-sm">Acceso denegado</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Gestión de Suscriptores"
        description="Administra las empresas clientes de la plataforma."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Form */}
        <Card className="rounded-[2rem] border-none shadow-lg bg-slate-100 dark:bg-card lg:col-span-1">
          <CardHeader className="p-6 pb-2">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-pagnol-orange/10 rounded-xl text-pagnol-orange"><Building2 size={16} /></div>
              <CardTitle className="text-sm font-black uppercase">Nuevo Suscriptor</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <CreateTenantForm />
          </CardContent>
        </Card>

        {/* List */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Crown size={14} className="text-pagnol-orange" />
            <p className="text-[10px] font-black uppercase tracking-widest text-pagnol-orange">
              {tenants.length} empresa{tenants.length !== 1 ? "s" : ""} registrada{tenants.length !== 1 ? "s" : ""}
            </p>
          </div>

          {loading ? (
            [1, 2, 3].map((i) => (
              <Card key={i} className="rounded-[2rem] border-none shadow animate-pulse bg-slate-100 dark:bg-slate-800 h-24" />
            ))
          ) : tenants.length === 0 ? (
            <Card className="rounded-[2rem] border-none shadow p-10 text-center text-muted-foreground">
              <p className="font-bold uppercase tracking-widest text-sm">Sin empresas registradas</p>
            </Card>
          ) : (
            tenants.map((t) => (
              <Link key={t.id} href={`/dashboard/subscriptions/${t.id}`}>
                <Card className="rounded-[2rem] border border-slate-100 dark:border-white/5 shadow hover:shadow-lg transition-all cursor-pointer bg-slate-100 dark:bg-card group">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className="h-11 w-11 rounded-2xl bg-pagnol-teal/10 flex items-center justify-center text-pagnol-teal font-black text-base shrink-0">
                      {t.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-black uppercase truncate group-hover:text-pagnol-orange transition-colors">{t.name}</p>
                        <Badge className={`text-[8px] font-black uppercase rounded-lg border ${planColors[t.plan] ?? planColors.starter}`}>
                          {t.plan}
                        </Badge>
                        <Badge className={`text-[8px] font-black uppercase rounded-lg border-none ${t.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {t.is_active ? "Activa" : "Inactiva"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="font-mono">{t.tenant_id}</span>
                        <span className="flex items-center gap-1"><Users size={10} /> {t.user_count}</span>
                        <span className="flex items-center gap-1.5">
                          <QrCode size={10} className={t.hardware_assigned?.qr_scanner ? "text-green-500" : "text-slate-300"} />
                          <Printer size={10} className={t.hardware_assigned?.thermal_printer ? "text-green-500" : "text-slate-300"} />
                          {t.contract_signed
                            ? <CheckCircle2 size={10} className="text-blue-500" />
                            : <AlertCircle size={10} className="text-slate-300" />}
                        </span>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-slate-300 group-hover:text-pagnol-orange transition-colors shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
