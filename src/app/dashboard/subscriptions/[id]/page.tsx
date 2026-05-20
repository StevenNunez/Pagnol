"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Users, Calendar, Hash, Crown, AlertCircle, XCircle } from "lucide-react";
import { EditTenantForm } from "@/components/admin/edit-tenant-form";
import { supabase } from "@/modules/core/lib/supabase";
import { useAuth } from "@/modules/core/contexts/app-provider";

interface TenantDetail {
  id: string;
  name: string;
  tenant_id: string;
  plan: string;
  is_active: boolean;
  created_at: string;
}

interface Profile {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
}

const roleLabel: Record<string, string> = {
  administrador: "Admin",
  "super-admin": "Super-Admin",
  bodega: "Bodega",
  supervisor: "Supervisor",
  trabajador: "Trabajador",
  seguridad: "Seguridad",
  rrhh: "RRHH",
  compras: "Compras",
};

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    // Fetch tenant info (directo, tenants table is readable by super-admin via RLS or no policy)
    const { data: t } = await supabase
      .from("tenants")
      .select("id, name, tenant_id, plan, is_active, created_at")
      .eq("id", id)
      .single();
    if (t) setTenant(t);

    // Fetch users via server-side admin API (bypasses RLS)
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const res = await fetch(`/api/admin/tenant-users?tenantId=${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const json = await res.json();
        setUsers(json.users ?? []);
      } else {
        console.error("[TenantDetail] users API error:", await res.text());
      }
    } catch (e) {
      console.error("[TenantDetail] users fetch error:", e);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (!can("module_subscriptions:view")) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle size={36} />
        <p className="font-bold uppercase tracking-widest text-sm">Acceso denegado</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-pagnol-orange" size={32} />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
        <XCircle size={40} />
        <p className="font-bold uppercase tracking-widest text-sm">Empresa no encontrada</p>
        <Link href="/dashboard/subscriptions"><Button variant="ghost">Volver</Button></Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/subscriptions">
          <Button variant="ghost" size="sm" className="rounded-xl gap-2 text-muted-foreground hover:text-white hover:bg-white/10">
            <ArrowLeft size={14} /> Volver
          </Button>
        </Link>
      </div>

      <PageHeader title={tenant.name} description={`RUT: ${tenant.tenant_id}`} />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { icon: Hash, label: "RUT", value: tenant.tenant_id },
          { icon: Crown, label: "Plan", value: tenant.plan },
          { icon: Users, label: "Usuarios", value: String(users.length) },
          { icon: Calendar, label: "Registro", value: new Date(tenant.created_at).toLocaleDateString("es-CL") },
        ].map((s) => (
          <Card key={s.label} className="rounded-[2rem] border-none shadow bg-white dark:bg-card">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-pagnol-orange/10 text-pagnol-orange"><s.icon size={15} /></div>
              <div>
                <p className="text-xs font-black leading-tight">{s.value}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Edit form */}
        <Card className="rounded-[2rem] border-none shadow-lg bg-white dark:bg-card">
          <CardHeader className="p-6 pb-2">
            <CardTitle className="text-sm font-black uppercase">Editar Empresa</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <EditTenantForm
              tenant={{ id: tenant.id, name: tenant.name, tenantId: tenant.tenant_id, plan: tenant.plan, createdAt: tenant.created_at as any, is_active: tenant.is_active } as any}
              onSaved={fetchData}
            />
          </CardContent>
        </Card>

        {/* Users */}
        <Card className="rounded-[2rem] border-none shadow-lg bg-white dark:bg-card">
          <CardHeader className="p-6 pb-2">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400"><Users size={15} /></div>
              <CardTitle className="text-sm font-black uppercase">Usuarios ({users.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            {users.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Sin usuarios registrados</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto no-scrollbar">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 dark:bg-white/5 px-4 py-2.5">
                    <div className="h-8 w-8 rounded-xl bg-pagnol-teal/10 flex items-center justify-center text-pagnol-teal font-black text-xs shrink-0">
                      {u.name?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{u.name}</p>
                      <p className="text-[9px] text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <Badge className="text-[8px] font-black uppercase rounded-md bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 border-none">
                        {roleLabel[u.role] ?? u.role}
                      </Badge>
                      <span className={`text-[8px] font-bold ${u.is_active ? "text-green-500" : "text-red-400"}`}>
                        {u.is_active ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
