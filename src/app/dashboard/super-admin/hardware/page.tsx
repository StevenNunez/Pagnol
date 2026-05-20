"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { QrCode, Printer, CheckCircle2, XCircle, Save, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/modules/core/lib/supabase";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { useRouter } from "next/navigation";
import { useToast } from "@/modules/core/hooks/use-toast";

interface TenantHW {
  id: string;
  name: string;
  tenant_id: string;
  is_active: boolean;
  hardware_assigned: { qr_scanner?: boolean; thermal_printer?: boolean } | null;
}

export default function SuperAdminHardwarePage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [tenants, setTenants] = useState<TenantHW[]>([]);
  const [hwState, setHwState] = useState<Record<string, { qr_scanner: boolean; thermal_printer: boolean }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && user.role !== "super-admin") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("tenants")
        .select("id, name, tenant_id, is_active, hardware_assigned")
        .order("name");

      if (data) {
        setTenants(data);
        const initial: Record<string, { qr_scanner: boolean; thermal_printer: boolean }> = {};
        data.forEach((t) => {
          initial[t.id] = {
            qr_scanner: t.hardware_assigned?.qr_scanner ?? false,
            thermal_printer: t.hardware_assigned?.thermal_printer ?? false,
          };
        });
        setHwState(initial);
      }
      setLoading(false);
    };
    fetch();
  }, []);

  const handleSave = async (tenantId: string) => {
    setSaving(tenantId);
    const { error } = await supabase
      .from("tenants")
      .update({ hardware_assigned: hwState[tenantId] })
      .eq("id", tenantId);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Guardado", description: "Hardware actualizado correctamente." });
    }
    setSaving(null);
  };

  const totalQR = Object.values(hwState).filter((h) => h.qr_scanner).length;
  const totalPrint = Object.values(hwState).filter((h) => h.thermal_printer).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Control de Hardware" description="Gestiona qué equipos están asignados a cada empresa." />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="rounded-[2rem] border-none shadow bg-slate-100 dark:bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-pagnol-orange/10 rounded-2xl text-pagnol-orange"><QrCode size={22} /></div>
            <div>
              <p className="text-2xl font-black">{totalQR}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Escáneres QR asignados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-[2rem] border-none shadow bg-slate-100 dark:bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-2xl text-blue-600"><Printer size={22} /></div>
            <div>
              <p className="text-2xl font-black">{totalPrint}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Impresoras asignadas</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-tenant rows */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="rounded-[2rem] border-none shadow animate-pulse bg-slate-100 dark:bg-slate-800 h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map((t) => {
            const hw = hwState[t.id] ?? { qr_scanner: false, thermal_printer: false };
            return (
              <Card key={t.id} className="rounded-[2rem] border border-slate-100 dark:border-white/5 shadow bg-slate-100 dark:bg-card">
                <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black uppercase">{t.name}</p>
                      <Badge className={`text-[8px] font-black uppercase rounded-lg border-none ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {t.is_active ? "Activa" : "Inactiva"}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">{t.tenant_id}</p>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <QrCode size={14} className="text-muted-foreground" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">QR</span>
                      <Switch
                        checked={hw.qr_scanner}
                        onCheckedChange={(v) =>
                          setHwState((p) => ({ ...p, [t.id]: { ...p[t.id], qr_scanner: v } }))
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Printer size={14} className="text-muted-foreground" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Imp.</span>
                      <Switch
                        checked={hw.thermal_printer}
                        onCheckedChange={(v) =>
                          setHwState((p) => ({ ...p, [t.id]: { ...p[t.id], thermal_printer: v } }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleSave(t.id)}
                      disabled={saving === t.id}
                      className="h-9 rounded-xl bg-pagnol-orange hover:bg-orange-600 text-white font-black uppercase tracking-widest text-[9px] px-4"
                    >
                      {saving === t.id ? <Loader2 className="animate-spin" size={12} /> : <><Save size={12} className="mr-1.5" />Guardar</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
