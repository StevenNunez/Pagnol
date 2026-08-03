"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2, Search, CheckCircle2, XCircle, Users, QrCode, Printer,
  Trash2, AlertTriangle, Loader2, Plus,
} from "lucide-react";
import { supabase } from "@/modules/core/lib/supabase";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { useRouter } from "next/navigation";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CreateTenantForm } from "@/components/admin/create-tenant-form";

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

// Mapa estático: las clases construidas con template strings se purgan en producción.
const planBadge: Record<string, string> = {
  enterprise: "bg-primary/10 text-primary border-primary/20",
  professional: "bg-info-subtle text-info-subtle-foreground border-info/20",
  starter: "bg-muted text-muted-foreground border-border",
};

export default function TenantsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  // El borrado es irreversible y arrastra usuarios y datos, así que se confirma
  // escribiendo el nombre exacto — no con un segundo clic.
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user && user.role !== "super-admin") router.replace("/dashboard");
  }, [user, router]);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tenants")
      .select("id, name, tenant_id, plan, is_active, created_at, hardware_assigned, contract_signed")
      .order("created_at", { ascending: false });

    if (!data) { setTenants([]); setLoading(false); return; }

    // El conteo va por la ruta admin (service role): contar `profiles` desde el
    // cliente devuelve 0 para quien no sea super-admin, y hacía una consulta por
    // empresa.
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    const enriched = await Promise.all(
      data.map(async (t) => {
        try {
          const res = await fetch(`/api/admin/tenant-users?tenantId=${t.id}&countOnly=true`, { headers });
          if (res.ok) return { ...t, user_count: (await res.json()).count ?? 0 };
        } catch { /* el conteo es informativo: no debe tumbar la lista */ }
        return { ...t, user_count: 0 };
      })
    );
    setTenants(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTenants();
    const channel = supabase
      .channel(`super-admin-tenants-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tenants" }, () => loadTenants())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadTenants]);

  // El borrado NO puede hacerse desde el cliente: `tenants` no tiene política de
  // DELETE y, aunque la tuviera, falla por las claves foráneas de `profiles`.
  // La ruta server-side borra cuentas de Auth, datos y empresa, en ese orden.
  const handleDelete = async () => {
    if (!tenantToDelete) return;
    setDeleting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Sesión expirada. Vuelve a iniciar sesión.");

      const res = await fetch("/api/admin/delete-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenantId: tenantToDelete.id, confirmName: confirmText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo eliminar la empresa.");

      setTenants((prev) => prev.filter((t) => t.id !== tenantToDelete.id));
      toast({
        title: "Empresa eliminada",
        description: `"${json.tenantName}": ${json.usersDeleted} usuario(s) y ${json.rowsDeleted} registro(s) borrados.`,
      });
      setTenantToDelete(null);
      setConfirmText("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "No se eliminó la empresa", description: err.message });
    } finally {
      setDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tenants.filter((t) => t.name.toLowerCase().includes(q) || t.tenant_id.toLowerCase().includes(q));
  }, [tenants, search]);

  const columns: DataTableColumn<Tenant>[] = [
    {
      key: "name",
      header: "Empresa",
      cell: (t) => (
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-black text-sm shrink-0">
            {t.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{t.name}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{t.tenant_id}</p>
          </div>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      cell: (t) => (
        <Badge className={`text-[9px] font-black uppercase rounded-xl border ${planBadge[t.plan] ?? planBadge.starter}`}>
          {t.plan}
        </Badge>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      cell: (t) => (
        <Badge className={`text-[9px] font-black uppercase rounded-xl border-none ${t.is_active ? "badge-success" : "bg-destructive/10 text-destructive"}`}>
          {t.is_active ? "Activa" : "Inactiva"}
        </Badge>
      ),
    },
    {
      key: "usuarios",
      header: "Usuarios",
      cell: (t) => (
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Users size={13} className="text-muted-foreground" />
          {t.user_count}
        </span>
      ),
    },
    {
      key: "entrega",
      header: "Hardware / Contrato",
      cell: (t) => (
        <div className="flex items-center gap-2.5">
          <QrCode size={14} className={t.hardware_assigned?.qr_scanner ? "text-success" : "text-muted-foreground/40"} />
          <Printer size={14} className={t.hardware_assigned?.thermal_printer ? "text-success" : "text-muted-foreground/40"} />
          {t.contract_signed
            ? <CheckCircle2 size={14} className="text-info" />
            : <XCircle size={14} className="text-muted-foreground/40" />}
        </div>
      ),
    },
    {
      key: "acciones",
      header: "",
      headerClassName: "w-10",
      cell: (t) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => { e.stopPropagation(); setTenantToDelete(t); setConfirmText(""); }}
          className="rounded-xl h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Eliminar empresa"
        >
          <Trash2 size={14} />
        </Button>
      ),
    },
  ];

  return (
    <PageShell
      title="Gestión de Empresas"
      description="Alta, edición y baja de las empresas registradas en Pagnol."
      toolbar={
        <>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              placeholder="Buscar por nombre o RUT..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 h-11 rounded-xl"
            />
          </div>
          <Button
            onClick={() => setCreating(true)}
            className="rounded-[1.5rem] gap-2 shadow-lg shadow-primary/10 hover:scale-105 active:scale-95 transition-transform font-black uppercase tracking-widest text-[10px]"
          >
            <Plus size={14} /> Nueva empresa
          </Button>
        </>
      }
    >
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(t) => t.id}
        isLoading={loading}
        onRowClick={(t) => router.push(`/dashboard/super-admin/tenants/${t.id}`)}
        minWidth="820px"
        empty={{
          icon: <Building2 size={36} />,
          title: search ? "Sin resultados" : "Sin empresas registradas",
          description: search
            ? "Ninguna empresa coincide con la búsqueda."
            : "Crea la primera con «Nueva empresa».",
        }}
      />

      {/* Alta de empresa */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="rounded-[1.5rem] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                <Building2 size={18} />
              </div>
              <DialogTitle className="text-base font-black uppercase tracking-tight">
                Nueva empresa
              </DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-left">
              Se crea la empresa y se envía una invitación por correo a su administrador.
            </DialogDescription>
          </DialogHeader>
          <CreateTenantForm onCreated={() => { setCreating(false); loadTenants(); }} />
        </DialogContent>
      </Dialog>

      {/* Baja de empresa */}
      <Dialog
        open={tenantToDelete !== null}
        onOpenChange={(open) => { if (!open && !deleting) { setTenantToDelete(null); setConfirmText(""); } }}
      >
        <DialogContent className="rounded-[1.5rem] sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-destructive/10 text-destructive shrink-0">
                <AlertTriangle size={18} />
              </div>
              <DialogTitle className="text-base font-black uppercase tracking-tight">
                Eliminar empresa
              </DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-left">
              Esto borra <strong className="text-foreground">{tenantToDelete?.name}</strong> por
              completo: sus {tenantToDelete?.user_count ?? 0} usuario(s) y todos sus datos —
              activos, movimientos, asistencia, liquidaciones y registros financieros.
              <span className="block mt-2 font-bold text-destructive">No se puede deshacer.</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm-tenant-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Escribe <span className="text-foreground">{tenantToDelete?.name}</span> para confirmar
            </Label>
            <Input
              id="confirm-tenant-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={tenantToDelete?.name ?? ""}
              autoComplete="off"
              className="rounded-xl"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => { setTenantToDelete(null); setConfirmText(""); }}
              disabled={deleting}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || confirmText.trim() !== tenantToDelete?.name}
              className="rounded-xl gap-2"
            >
              {deleting
                ? <><Loader2 size={14} className="animate-spin" /> Eliminando…</>
                : <><Trash2 size={14} /> Eliminar definitivamente</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}