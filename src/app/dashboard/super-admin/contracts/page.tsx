"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FileText, CheckCircle2, XCircle, Calendar, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/modules/core/lib/supabase";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { useRouter } from "next/navigation";
import { useToast } from "@/modules/core/hooks/use-toast";

interface TenantContract {
  id: string;
  name: string;
  tenant_id: string;
  plan: string;
  is_active: boolean;
  contract_signed: boolean | null;
  contract_signed_at: string | null;
}

export default function ContractsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [tenants, setTenants] = useState<TenantContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== "super-admin") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("tenants")
        .select("id, name, tenant_id, plan, is_active, contract_signed, contract_signed_at")
        .order("name");
      if (data) setTenants(data);
      setLoading(false);
    };
    fetch();
  }, []);

  const handleToggle = async (tenantId: string, current: boolean) => {
    setToggling(tenantId);
    const newVal = !current;
    // `.select()`: un UPDATE que la RLS no matchea devuelve 0 filas sin error, y
    // esta auditoría marcaría contratos como firmados sin haberlo guardado.
    const { data: rows, error } = await supabase
      .from("tenants")
      .update({
        contract_signed: newVal,
        contract_signed_at: newVal ? new Date().toISOString() : null,
      })
      .eq("id", tenantId)
      .select("id");

    if (error || !rows || rows.length === 0) {
      toast({
        variant: "destructive",
        title: "No se pudo actualizar el contrato",
        description: error?.message ?? "La base de datos rechazó el cambio. Sólo un super-admin puede marcar el contrato.",
      });
    } else {
      setTenants((prev) =>
        prev.map((t) =>
          t.id === tenantId
            ? { ...t, contract_signed: newVal, contract_signed_at: newVal ? new Date().toISOString() : null }
            : t
        )
      );
      toast({ title: newVal ? "Contrato marcado como firmado" : "Contrato pendiente" });
    }
    setToggling(null);
  };

  const signed = tenants.filter((t) => t.contract_signed).length;

  return (
    <PageShell
      title="Contratos de Responsabilidad"
      description="Auditoría de contratos firmados por cada empresa."
    >

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="rounded-[1.5rem] bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-success-subtle rounded-2xl text-success-subtle-foreground"><CheckCircle2 size={22} /></div>
            <div>
              <p className="text-2xl font-black">{signed}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Contratos firmados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-[1.5rem] bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-destructive/10 rounded-2xl text-destructive"><XCircle size={22} /></div>
            <div>
              <p className="text-2xl font-black">{tenants.length - signed}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pendientes</p>
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
      ) : (
        <div className="space-y-3">
          {tenants.map((t) => (
            <Card
              key={t.id}
              className={`rounded-[1.5rem] bg-card transition-all ${t.contract_signed ? "border-success/30" : ""}`}
            >
              <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className={`p-3 rounded-2xl shrink-0 ${t.contract_signed ? "bg-success-subtle text-success-subtle-foreground" : "bg-muted text-muted-foreground"}`}>
                  <FileText size={18} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold">{t.name}</p>
                    <Badge className={`text-[9px] font-black uppercase rounded-xl border-none ${t.is_active ? "badge-success" : "bg-destructive/10 text-destructive"}`}>
                      {t.is_active ? "Activa" : "Inactiva"}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono">{t.tenant_id}</p>
                  {t.contract_signed && t.contract_signed_at && (
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-success">
                      <Calendar size={10} />
                      <span>Firmado el {new Date(t.contract_signed_at).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" })}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {toggling === t.id
                    ? <Loader2 className="animate-spin text-primary" size={16} />
                    : (
                      <Switch
                        checked={t.contract_signed ?? false}
                        onCheckedChange={() => handleToggle(t.id, t.contract_signed ?? false)}
                      />
                    )
                  }
                  <Link href={`/dashboard/super-admin/tenants/${t.id}`}>
                    <Button size="sm" variant="ghost" className="rounded-xl h-9 text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary">
                      <ArrowRight size={14} />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
