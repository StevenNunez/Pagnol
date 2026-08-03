"use client";

import React, { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { QrCode, Printer, Save, Loader2, Building2 } from "lucide-react";
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
    const load = async () => {
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
    load();
  }, []);

  const handleSave = async (tenantId: string) => {
    setSaving(tenantId);
    // `.select()`: sin esto un UPDATE bloqueado por RLS devuelve 0 filas y ningún
    // error, y la pantalla confirmaba un guardado que no ocurrió.
    const { data: rows, error } = await supabase
      .from("tenants")
      .update({ hardware_assigned: hwState[tenantId] })
      .eq("id", tenantId)
      .select("id");

    if (error || !rows || rows.length === 0) {
      toast({
        variant: "destructive",
        title: "No se guardó el hardware",
        description: error?.message ?? "La base de datos rechazó el cambio. Sólo un super-admin puede asignar hardware.",
      });
    } else {
      setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, hardware_assigned: hwState[tenantId] } : t)));
      toast({ title: "Guardado", description: "Hardware actualizado correctamente." });
    }
    setSaving(null);
  };

  const totalQR = Object.values(hwState).filter((h) => h.qr_scanner).length;
  const totalPrint = Object.values(hwState).filter((h) => h.thermal_printer).length;

  return (
    <PageShell
      title="Control de Hardware"
      description="Gestiona qué equipos están asignados a cada empresa."
    >
      <div className="grid grid-cols-2 gap-4">
        <Card className="rounded-[1.5rem] bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-2xl text-primary shrink-0"><QrCode size={22} /></div>
            <div>
              <p className="text-2xl font-black">{totalQR}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Escáneres QR asignados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-[1.5rem] bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-info-subtle rounded-2xl text-info-subtle-foreground shrink-0"><Printer size={22} /></div>
            <div>
              <p className="text-2xl font-black">{totalPrint}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Impresoras asignadas</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="rounded-[1.5rem] animate-pulse bg-muted h-24 border-none" />
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <EmptyState
          icon={<Building2 size={36} />}
          title="Sin empresas registradas"
          description="No hay equipos que asignar todavía."
        />
      ) : (
        <div className="space-y-3">
          {tenants.map((t) => {
            const hw = hwState[t.id] ?? { qr_scanner: false, thermal_printer: false };
            const dirty =
              hw.qr_scanner !== (t.hardware_assigned?.qr_scanner ?? false) ||
              hw.thermal_printer !== (t.hardware_assigned?.thermal_printer ?? false);

            return (
              <Card key={t.id} className="rounded-[1.5rem] bg-card">
                <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold">{t.name}</p>
                      <Badge className={`text-[9px] font-black uppercase rounded-xl border-none ${t.is_active ? "badge-success" : "bg-destructive/10 text-destructive"}`}>
                        {t.is_active ? "Activa" : "Inactiva"}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">{t.tenant_id}</p>
                  </div>

                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-2">
                      <QrCode size={14} className="text-muted-foreground" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">QR</span>
                      <Switch
                        checked={hw.qr_scanner}
                        onCheckedChange={(v) => setHwState((p) => ({ ...p, [t.id]: { ...p[t.id], qr_scanner: v } }))}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Printer size={14} className="text-muted-foreground" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Imp.</span>
                      <Switch
                        checked={hw.thermal_printer}
                        onCheckedChange={(v) => setHwState((p) => ({ ...p, [t.id]: { ...p[t.id], thermal_printer: v } }))}
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleSave(t.id)}
                      disabled={saving === t.id || !dirty}
                      className="h-9 rounded-xl font-black uppercase tracking-widest text-[9px] px-4"
                    >
                      {saving === t.id
                        ? <Loader2 className="animate-spin" size={12} />
                        : <><Save size={12} className="mr-1.5" />{dirty ? "Guardar" : "Guardado"}</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}