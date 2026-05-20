"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
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
    const { error } = await supabase
      .from("tenants")
      .update({
        contract_signed: newVal,
        contract_signed_at: newVal ? new Date().toISOString() : null,
      })
      .eq("id", tenantId);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
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
    <div className="flex flex-col gap-8">
      <PageHeader title="Contratos de Responsabilidad" description="Auditoría de contratos firmados por cada empresa." />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="rounded-[2rem] border-none shadow bg-slate-100 dark:bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-2xl text-green-600"><CheckCircle2 size={22} /></div>
            <div>
              <p className="text-2xl font-black">{signed}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Contratos firmados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-[2rem] border-none shadow bg-slate-100 dark:bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-2xl text-red-500"><XCircle size={22} /></div>
            <div>
              <p className="text-2xl font-black">{tenants.length - signed}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pendientes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="rounded-[2rem] border-none shadow animate-pulse bg-slate-100 dark:bg-slate-800 h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map((t) => (
            <Card
              key={t.id}
              className={`rounded-[2rem] border shadow bg-slate-100 dark:bg-card transition-all ${
                t.contract_signed
                  ? "border-green-200 dark:border-green-800/40"
                  : "border-slate-100 dark:border-white/5"
              }`}
            >
              <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className={`p-3 rounded-2xl shrink-0 ${t.contract_signed ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-slate-100 dark:bg-white/5 text-muted-foreground'}`}>
                  <FileText size={18} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-black uppercase">{t.name}</p>
                    <Badge className={`text-[8px] font-black uppercase rounded-lg border-none ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {t.is_active ? "Activa" : "Inactiva"}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono">{t.tenant_id}</p>
                  {t.contract_signed && t.contract_signed_at && (
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-green-600 dark:text-green-400">
                      <Calendar size={10} />
                      <span>Firmado el {new Date(t.contract_signed_at).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" })}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {toggling === t.id
                    ? <Loader2 className="animate-spin text-pagnol-orange" size={16} />
                    : (
                      <Switch
                        checked={t.contract_signed ?? false}
                        onCheckedChange={() => handleToggle(t.id, t.contract_signed ?? false)}
                      />
                    )
                  }
                  <Link href={`/dashboard/super-admin/tenants/${t.id}`}>
                    <Button size="sm" variant="ghost" className="rounded-xl h-9 text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-pagnol-orange">
                      <ArrowRight size={14} />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
