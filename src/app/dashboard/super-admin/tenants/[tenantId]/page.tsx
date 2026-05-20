"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Building2,
  Users,
  Crown,
  QrCode,
  Printer,
  FileText,
  CheckCircle2,
  XCircle,
  Calendar,
  Hash,
  ShieldCheck,
  Loader2,
  Save,
} from "lucide-react";
import { supabase } from "@/modules/core/lib/supabase";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";

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
  cargo: string | null;
  is_active: boolean;
  created_at: string;
}

const planColors: Record<string, string> = {
  enterprise: "bg-pagnol-orange/10 text-pagnol-orange border-pagnol-orange/20",
  professional: "bg-blue-100 text-blue-700 border-blue-200",
  starter: "bg-slate-100 text-slate-600 border-slate-200",
};

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
    const [{ data: t }, { data: u }] = await Promise.all([
      supabase
        .from("tenants")
        .select("id, name, tenant_id, plan, is_active, created_at, hardware_assigned, contract_signed, contract_signed_at")
        .eq("id", tenantId)
        .single(),
      supabase
        .from("profiles")
        .select("id, name, email, role, cargo, is_active, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
    ]);

    if (t) {
      setTenant(t);
      setHw({ qr_scanner: t.hardware_assigned?.qr_scanner ?? false, thermal_printer: t.hardware_assigned?.thermal_printer ?? false });
      setContractSigned(t.contract_signed ?? false);
    }
    if (u) setUsers(u);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveHardware = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({ hardware_assigned: hw })
      .eq("id", tenantId);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Hardware actualizado", description: "La asignación fue guardada." });
    }
    setSaving(false);
  };

  const handleToggleContract = async () => {
    const newVal = !contractSigned;
    setContractSigned(newVal);
    await supabase
      .from("tenants")
      .update({ contract_signed: newVal, contract_signed_at: newVal ? new Date().toISOString() : null })
      .eq("id", tenantId);
    toast({ title: newVal ? "Contrato marcado como firmado" : "Contrato desmarcado" });
  };

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
        <Link href="/dashboard/super-admin"><Button variant="ghost">Volver al Panel</Button></Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/super-admin">
          <Button variant="ghost" size="sm" className="rounded-xl gap-2 text-muted-foreground hover:text-white hover:bg-white/10">
            <ArrowLeft size={14} /> Volver
          </Button>
        </Link>
      </div>

      <PageHeader
        title={tenant.name}
        description={`Detalle completo de la empresa — RUT ${tenant.tenant_id}`}
      />

      {/* Header Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { icon: Hash, label: "RUT", value: tenant.tenant_id },
          { icon: Crown, label: "Plan", value: tenant.plan },
          { icon: Users, label: "Usuarios", value: users.length.toString() },
          { icon: Calendar, label: "Registro", value: new Date(tenant.created_at).toLocaleDateString("es-CL") },
        ].map((s) => (
          <Card key={s.label} className="rounded-[2rem] border-none shadow bg-white dark:bg-card">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-pagnol-orange/10 text-pagnol-orange">
                <s.icon size={16} />
              </div>
              <div>
                <p className="text-xs font-black leading-tight">{s.value}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: hardware + contract */}
        <div className="space-y-6">
          {/* Hardware */}
          <Card className="rounded-[2rem] border-none shadow-lg bg-white dark:bg-card">
            <CardHeader className="p-6 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-pagnol-orange/10 rounded-xl text-pagnol-orange"><QrCode size={16} /></div>
                <CardTitle className="text-sm font-black uppercase">Hardware Asignado</CardTitle>
              </div>
              <CardDescription className="text-xs">Activa el hardware entregado físicamente a esta empresa.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-white/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <QrCode size={16} className="text-muted-foreground" />
                  <Label className="text-xs font-bold uppercase tracking-widest cursor-pointer">Escáner QR / Barras</Label>
                </div>
                <Switch
                  checked={hw.qr_scanner}
                  onCheckedChange={(v) => setHw((p) => ({ ...p, qr_scanner: v }))}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-white/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Printer size={16} className="text-muted-foreground" />
                  <Label className="text-xs font-bold uppercase tracking-widest cursor-pointer">Impresora Térmica</Label>
                </div>
                <Switch
                  checked={hw.thermal_printer}
                  onCheckedChange={(v) => setHw((p) => ({ ...p, thermal_printer: v }))}
                />
              </div>
              <Button
                onClick={handleSaveHardware}
                disabled={saving}
                className="w-full h-10 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px]"
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : <><Save size={14} className="mr-2" />Guardar Hardware</>}
              </Button>
            </CardContent>
          </Card>

          {/* Contrato */}
          <Card className="rounded-[2rem] border-none shadow-lg bg-white dark:bg-card">
            <CardHeader className="p-6 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400"><FileText size={16} /></div>
                <CardTitle className="text-sm font-black uppercase">Contrato de Responsabilidad</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-white/5 px-4 py-3">
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
              <div className={`flex items-center gap-2 rounded-xl px-4 py-3 ${contractSigned ? 'bg-green-50 dark:bg-green-900/20' : 'bg-slate-50 dark:bg-white/5'}`}>
                {contractSigned
                  ? <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                  : <XCircle size={16} className="text-muted-foreground shrink-0" />}
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {contractSigned ? "Contrato vigente" : "Pendiente de firma"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Plan */}
          <Card className="rounded-[2rem] border-none shadow-lg bg-pagnol-teal text-white">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-white/10 rounded-2xl">
                <ShieldCheck size={22} className="text-pagnol-orange" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-white/60">Plan activo</p>
                <p className="text-lg font-black uppercase">{tenant.plan}</p>
                <Badge className={`mt-1 text-[9px] font-black uppercase rounded-lg border ${tenant.is_active ? 'bg-green-400/20 text-green-300 border-green-400/30' : 'bg-red-400/20 text-red-300 border-red-400/30'}`}>
                  {tenant.is_active ? "Activa" : "Inactiva"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: users */}
        <div className="lg:col-span-2">
          <Card className="rounded-[2rem] border-none shadow-lg bg-white dark:bg-card h-full">
            <CardHeader className="p-6 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400"><Users size={16} /></div>
                <CardTitle className="text-sm font-black uppercase">Usuarios ({users.length})</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-4">
              {users.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 font-medium">Sin usuarios registrados</p>
              ) : (
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1 no-scrollbar">
                  {users.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 dark:bg-white/5 px-4 py-3">
                      <div className="h-9 w-9 rounded-xl bg-pagnol-teal/10 flex items-center justify-center text-pagnol-teal font-black text-sm shrink-0">
                        {u.name?.charAt(0)?.toUpperCase() ?? "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">{u.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge className="text-[8px] font-black uppercase rounded-md bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 border-none">
                          {roleLabel[u.role] ?? u.role}
                        </Badge>
                        <span className={`text-[8px] font-bold uppercase ${u.is_active ? 'text-green-500' : 'text-red-400'}`}>
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
    </div>
  );
}
