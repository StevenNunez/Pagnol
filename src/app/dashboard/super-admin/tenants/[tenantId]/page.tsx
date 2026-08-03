"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { LoadingState } from "@/components/loading-state";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, Users, Crown, QrCode, Printer, FileText, CheckCircle2, XCircle,
  Calendar, Hash, ShieldCheck, Loader2, Save, Building2, Pencil,
} from "lucide-react";
import { supabase } from "@/modules/core/lib/supabase";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";
import { EditTenantForm } from "@/components/admin/edit-tenant-form";

interface TenantDetail {
  id: string;
  name: string;
  tenant_id: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  hardware_assigned: { qr_scanner?: boolean; thermal_printer?: boolean } | null;
  contract_signed: boolean | null;
  contract_signed_at: string | null;
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
  "soporte-pagnol": "Soporte",
  bodega: "Bodega",
  supervisor: "Supervisor",
  trabajador: "Trabajador",
  operador: "Operador",
  seguridad: "Seguridad",
  rrhh: "RRHH",
  compras: "Compras",
};

export default function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hw, setHw] = useState({ qr_scanner: false, thermal_printer: false });
  const [contractSigned, setContractSigned] = useState(false);

  useEffect(() => {
    if (user && user.role !== "super-admin") router.replace("/dashboard");
  }, [user, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: t } = await supabase
      .from("tenants")
      .select("id, name, tenant_id, plan, is_active, created_at, hardware_assigned, contract_signed, contract_signed_at")
      .eq("id", tenantId)
      .single();

    if (t) {
      setTenant(t);
      setHw({
        qr_scanner: t.hardware_assigned?.qr_scanner ?? false,
        thermal_printer: t.hardware_assigned?.thermal_printer ?? false,
      });
      setContractSigned(t.contract_signed ?? false);
    }

    // Los usuarios van por la ruta admin (service role): leerlos desde el cliente
    // los filtra la RLS y devuelve una lista vacía.
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const res = await fetch(`/api/admin/tenant-users?tenantId=${tenantId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setUsers((await res.json()).users ?? []);
    } catch { /* la lista de usuarios es informativa: no debe tumbar la página */ }

    setLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveHardware = async () => {
    setSaving(true);
    const { data: rows, error } = await supabase
      .from("tenants")
      .update({ hardware_assigned: hw })
      .eq("id", tenantId)
      .select("id");

    if (error || !rows || rows.length === 0) {
      toast({
        variant: "destructive",
        title: "No se guardó el hardware",
        description: error?.message ?? "La base de datos rechazó el cambio. Sólo un super-admin puede asignar hardware.",
      });
    } else {
      toast({ title: "Hardware actualizado", description: "La asignación fue guardada." });
    }
    setSaving(false);
  };

  const handleToggleContract = async () => {
    const newVal = !contractSigned;
    setContractSigned(newVal);
    // `.select()`: un UPDATE que la RLS no matchea devuelve 0 filas SIN error, y
    // antes esta función ni siquiera miraba `error` — siempre cantaba éxito.
    const { data: rows, error } = await supabase
      .from("tenants")
      .update({ contract_signed: newVal, contract_signed_at: newVal ? new Date().toISOString() : null })
      .eq("id", tenantId)
      .select("id");

    if (error || !rows || rows.length === 0) {
      setContractSigned(!newVal); // revertir el switch: no se guardó
      toast({
        variant: "destructive",
        title: "No se pudo actualizar el contrato",
        description: error?.message ?? "La base de datos rechazó el cambio. Sólo un super-admin puede marcar el contrato.",
      });
      return;
    }

    setTenant((prev) => (prev
      ? { ...prev, contract_signed: newVal, contract_signed_at: newVal ? new Date().toISOString() : null }
      : prev));
    toast({ title: newVal ? "Contrato marcado como firmado" : "Contrato desmarcado" });
  };

  if (loading) return <LoadingState />;

  if (!tenant) {
    return (
      <EmptyState
        icon={<Building2 size={36} />}
        title="Empresa no encontrada"
        description="Puede haber sido eliminada."
        action={
          <Link href="/dashboard/super-admin/tenants">
            <Button variant="outline" className="rounded-xl">Volver a Empresas</Button>
          </Link>
        }
      />
    );
  }

  return (
    <PageShell
      title={tenant.name}
      description={`Detalle completo de la empresa — RUT ${tenant.tenant_id}`}
    >
      <div>
        <Link href="/dashboard/super-admin/tenants">
          <Button variant="ghost" size="sm" className="rounded-xl gap-2 text-muted-foreground">
            <ArrowLeft size={14} /> Volver a Empresas
          </Button>
        </Link>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { icon: Hash, label: "RUT", value: tenant.tenant_id },
          { icon: Crown, label: "Plan", value: tenant.plan },
          { icon: Users, label: "Usuarios", value: users.length.toString() },
          { icon: Calendar, label: "Registro", value: new Date(tenant.created_at).toLocaleDateString("es-CL") },
        ].map((s) => (
          <Card key={s.label} className="rounded-[1.5rem] bg-card">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                <s.icon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black leading-tight truncate capitalize">{s.value}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6">
          {/* Datos comerciales — antes vivían en /subscriptions/[id] */}
          <Card className="rounded-[1.5rem] bg-card">
            <CardHeader className="p-6 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-xl text-primary"><Pencil size={16} /></div>
                <CardTitle className="text-sm font-black uppercase">Datos de la empresa</CardTitle>
              </div>
              <CardDescription className="text-xs">Nombre, plan contratado y estado.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-4">
              <EditTenantForm
                tenant={{
                  id: tenant.id,
                  name: tenant.name,
                  tenantId: tenant.tenant_id,
                  plan: tenant.plan,
                  createdAt: tenant.created_at as any,
                  is_active: tenant.is_active,
                } as any}
                onSaved={fetchData}
              />
            </CardContent>
          </Card>

          {/* Hardware */}
          <Card className="rounded-[1.5rem] bg-card">
            <CardHeader className="p-6 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-xl text-primary"><QrCode size={16} /></div>
                <CardTitle className="text-sm font-black uppercase">Hardware asignado</CardTitle>
              </div>
              <CardDescription className="text-xs">Equipos entregados físicamente a esta empresa.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
                <div className="flex items-center gap-3">
                  <QrCode size={16} className="text-muted-foreground" />
                  <Label className="text-xs font-bold uppercase tracking-widest cursor-pointer">Escáner QR / Barras</Label>
                </div>
                <Switch checked={hw.qr_scanner} onCheckedChange={(v) => setHw((p) => ({ ...p, qr_scanner: v }))} />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
                <div className="flex items-center gap-3">
                  <Printer size={16} className="text-muted-foreground" />
                  <Label className="text-xs font-bold uppercase tracking-widest cursor-pointer">Impresora térmica</Label>
                </div>
                <Switch checked={hw.thermal_printer} onCheckedChange={(v) => setHw((p) => ({ ...p, thermal_printer: v }))} />
              </div>
              <Button
                onClick={handleSaveHardware}
                disabled={saving}
                className="w-full h-10 rounded-xl font-black uppercase tracking-widest text-[10px]"
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : <><Save size={14} className="mr-2" />Guardar hardware</>}
              </Button>
            </CardContent>
          </Card>

          {/* Contrato */}
          <Card className="rounded-[1.5rem] bg-card">
            <CardHeader className="p-6 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-info-subtle rounded-xl text-info-subtle-foreground"><FileText size={16} /></div>
                <CardTitle className="text-sm font-black uppercase">Contrato de responsabilidad</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest">Firmado</p>
                  {tenant.contract_signed_at && contractSigned && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(tenant.contract_signed_at).toLocaleDateString("es-CL")}
                    </p>
                  )}
                </div>
                <Switch checked={contractSigned} onCheckedChange={handleToggleContract} />
              </div>
              <div className={`flex items-center gap-2 rounded-xl px-4 py-3 ${contractSigned ? "bg-success-subtle" : "bg-muted"}`}>
                {contractSigned
                  ? <CheckCircle2 size={16} className="text-success shrink-0" />
                  : <XCircle size={16} className="text-muted-foreground shrink-0" />}
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {contractSigned ? "Contrato vigente" : "Pendiente de firma"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Plan */}
          <Card className="rounded-[1.5rem] bg-pagnol-dark text-white border-none">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-white/10 rounded-2xl shrink-0">
                <ShieldCheck size={22} className="text-primary" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Plan activo</p>
                <p className="text-lg font-black uppercase">{tenant.plan}</p>
                <Badge className={`mt-1 text-[9px] font-black uppercase rounded-xl border-none ${tenant.is_active ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
                  {tenant.is_active ? "Activa" : "Inactiva"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Usuarios */}
        <div className="lg:col-span-2">
          <Card className="rounded-[1.5rem] bg-card h-full">
            <CardHeader className="p-6 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-info-subtle rounded-xl text-info-subtle-foreground"><Users size={16} /></div>
                <CardTitle className="text-sm font-black uppercase">Usuarios ({users.length})</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-4">
              {users.length === 0 ? (
                <EmptyState
                  className="border-0"
                  icon={<Users size={32} />}
                  title="Sin usuarios registrados"
                  description="Esta empresa todavía no tiene cuentas activas."
                />
              ) : (
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1 no-scrollbar">
                  {users.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3">
                      <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-black text-sm shrink-0">
                        {u.name?.charAt(0)?.toUpperCase() ?? "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">{u.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="secondary" className="text-[9px] font-black uppercase rounded-lg border-none">
                          {roleLabel[u.role] ?? u.role}
                        </Badge>
                        <span className={`text-[9px] font-bold uppercase ${u.is_active ? "text-success" : "text-destructive"}`}>
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
    </PageShell>
  );
}