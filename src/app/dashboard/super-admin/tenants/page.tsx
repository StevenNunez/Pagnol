"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, ArrowRight, Search, CheckCircle2, XCircle, Users, QrCode, Printer, Trash2 } from "lucide-react";
import { supabase } from "@/modules/core/lib/supabase";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { useRouter } from "next/navigation";
import { useToast } from "@/modules/core/hooks/use-toast";

interface Tenant {
  id: string;
  name: string;
  tenant_id: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  hardware_assigned: { qr_scanner?: boolean; thermal_printer?: boolean } | null;
  contract_signed: boolean | null;
  user_count: number;
}

const planColors: Record<string, string> = {
  enterprise: "bg-pagnol-orange/10 text-pagnol-orange border-pagnol-orange/20",
  professional: "bg-blue-100 text-blue-700 border-blue-200",
  starter: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function TenantsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user && user.role !== "super-admin") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    const loadTenants = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("tenants")
        .select("id, name, tenant_id, plan, is_active, created_at, hardware_assigned, contract_signed")
        .order("created_at", { ascending: false });

      if (!data) { setLoading(false); return; }

      const enriched = await Promise.all(
        data.map(async (t) => {
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

    loadTenants();

    const channel = supabase
      .channel(`super-admin-tenants-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => {
        loadTenants();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        loadTenants();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setDeleting(true);
    const { error } = await supabase.from("tenants").delete().eq("id", id);
    setDeleting(false);
    setConfirmDeleteId(null);
    if (error) {
      toast({ title: "Error al eliminar", description: error.message, variant: "destructive" });
    } else {
      setTenants(prev => prev.filter(t => t.id !== id));
      toast({ title: "Empresa eliminada" });
    }
  };

  const filtered = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.tenant_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Gestión de Empresas" description="Listado completo de todas las empresas registradas en Pagnol." />

      <div className="relative max-w-sm">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <Input
          placeholder="Buscar por nombre o RUT..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-11 h-11 bg-slate-100 dark:bg-card border-slate-200 dark:border-white/10 rounded-xl"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="rounded-[2rem] border-none shadow animate-pulse bg-slate-100 dark:bg-slate-800 h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <Link key={t.id} href={`/dashboard/super-admin/tenants/${t.id}`}>
              <Card className="rounded-[2rem] border border-slate-100 dark:border-white/5 shadow hover:shadow-lg transition-all cursor-pointer bg-slate-100 dark:bg-card group">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-pagnol-teal/10 flex items-center justify-center text-pagnol-teal font-black text-lg shrink-0">
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-black uppercase truncate group-hover:text-pagnol-orange transition-colors">{t.name}</p>
                      <Badge className={`text-[8px] font-black uppercase rounded-lg border ${planColors[t.plan] ?? planColors.starter}`}>
                        {t.plan}
                      </Badge>
                      <Badge className={`text-[8px] font-black uppercase rounded-lg border-none ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {t.is_active ? "Activa" : "Inactiva"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground">
                      <span className="font-mono">{t.tenant_id}</span>
                      <span className="flex items-center gap-1"><Users size={10} /> {t.user_count} usuarios</span>
                      <span className="flex items-center gap-1.5">
                        <QrCode size={10} className={t.hardware_assigned?.qr_scanner ? 'text-green-500' : 'text-slate-300'} />
                        <Printer size={10} className={t.hardware_assigned?.thermal_printer ? 'text-green-500' : 'text-slate-300'} />
                        {t.contract_signed
                          ? <CheckCircle2 size={10} className="text-blue-500" />
                          : <XCircle size={10} className="text-slate-300" />}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleDelete(t.id, e)}
                    disabled={deleting && confirmDeleteId === t.id}
                    className={`shrink-0 rounded-xl h-8 w-8 transition-colors ${confirmDeleteId === t.id ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'text-slate-300 hover:text-red-500 hover:bg-red-50'}`}
                    title={confirmDeleteId === t.id ? "Clic de nuevo para confirmar" : "Eliminar empresa"}
                  >
                    <Trash2 size={14} />
                  </Button>
                  <ArrowRight size={16} className="text-slate-300 group-hover:text-pagnol-orange transition-colors shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Building2 size={36} className="mx-auto mb-3 opacity-30" />
              <p className="font-bold uppercase tracking-widest text-sm">Sin resultados</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
