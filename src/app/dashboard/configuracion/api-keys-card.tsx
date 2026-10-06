"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useToast } from "@/modules/core/hooks/use-toast";
import { supabase } from "@/modules/core/lib/supabase";
import { generateApiKey } from "@/modules/core/lib/api-keys-client";
import { API_SCOPES_AVAILABLE, API_SCOPES_DEFAULT, API_SCOPE_LABELS, type ApiScope } from "@/lib/api/scopes";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plug, Trash2 } from "lucide-react";

const MICRO_LABEL = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * Llaves de la API pública v1: las usan otros sistemas de la empresa (por
 * ejemplo, su plataforma de compras) para leer el catálogo, los proveedores y
 * los activos. Son de la empresa, no de quien las crea.
 */
export function ApiKeysCard({ tenantId, userId }: { tenantId: string; userId: string }) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>([...API_SCOPES_DEFAULT]);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, prefix, scopes, created_at, last_used_at, revoked_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ variant: "destructive", title: "No se pudieron cargar las llaves", description: error.message });
    } else {
      setKeys(data ?? []);
    }
    setLoading(false);
  }, [tenantId, toast]);

  useEffect(() => { load(); }, [load]);

  const toggleScope = (scope: ApiScope, on: boolean) =>
    setScopes((prev) => (on ? [...prev, scope] : prev.filter((s) => s !== scope)));

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Ponle un nombre a la llave", description: "Así sabrás después qué sistema la usa." });
      return;
    }
    if (!scopes.length) {
      toast({ variant: "destructive", title: "Elige al menos un permiso" });
      return;
    }
    setCreating(true);
    try {
      const { raw, prefix, hash } = await generateApiKey();
      const { error } = await supabase.from("api_keys").insert({
        tenant_id: tenantId,
        name: name.trim(),
        prefix,
        key_hash: hash,
        scopes,
        created_by: userId,
      });
      if (error) throw error;
      setRevealed(raw);
      setName("");
      await load();
    } catch (err: any) {
      toast({ variant: "destructive", title: "No se pudo crear la llave", description: err?.message || "Intenta nuevamente." });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const { data, error } = await supabase
      .from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error || !data?.length) {
      toast({ variant: "destructive", title: "No se pudo revocar", description: error?.message || "Sin permiso o la llave ya no existe." });
      return;
    }
    toast({ title: "Llave revocada", description: "El sistema que la usaba dejará de tener acceso de inmediato." });
    load();
  };

  const apiUrl = typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "/api/v1";

  return (
    <Card className="rounded-[1.5rem]">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" /> Integraciones — API de Pagnol
        </CardTitle>
        <CardDescription>
          Crea una llave para que otro sistema de la empresa (por ejemplo, su plataforma de compras)
          consulte el catálogo, los proveedores y los activos de Pagnol. Cada llave sólo ve los datos
          de esta empresa y sólo lo que marques en sus permisos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
          <Label className={MICRO_LABEL}>Dirección de la API</Label>
          <code className="block text-xs font-mono text-foreground break-all">{apiUrl}</code>
          <p className="text-[11px] text-muted-foreground">
            Documentación técnica en <code className="font-mono">{apiUrl}/openapi.json</code>. La llave va en el header{" "}
            <code className="font-mono">Authorization: Bearer &lt;llave&gt;</code>.
          </p>
        </div>

        {revealed && (
          <div className="rounded-xl border border-warning bg-warning-subtle p-4 space-y-2">
            <div className="flex items-center gap-2 text-warning-subtle-foreground font-bold text-xs uppercase tracking-wider">
              <AlertTriangle className="h-4 w-4" /> Cópiala ahora — no se volverá a mostrar
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-card border rounded-lg px-3 py-2 break-all">{revealed}</code>
              <Button
                type="button" size="icon" variant="outline" className="shrink-0 rounded-lg"
                onClick={() => {
                  navigator.clipboard.writeText(revealed);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[11px] text-warning-subtle-foreground">
              Guárdala sólo en el servidor del otro sistema, nunca en una página web ni en un correo.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la llave (ej: Plataforma de compras)"
            className="rounded-xl"
            maxLength={60}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {API_SCOPES_AVAILABLE.map((scope) => (
              <label key={scope} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-foreground cursor-pointer">
                <Checkbox checked={scopes.includes(scope)} onCheckedChange={(v) => toggleScope(scope, v === true)} />
                {API_SCOPE_LABELS[scope]}
              </label>
            ))}
          </div>
          <Button onClick={handleCreate} disabled={creating} className="w-full rounded-xl gap-2">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Crear llave
          </Button>
        </div>

        {loading ? (
          <LoadingState />
        ) : keys.length === 0 ? (
          <EmptyState icon={<KeyRound size={20} />} title="Sin llaves" description="Crea una para conectar otro sistema de la empresa." />
        ) : (
          <div className="rounded-xl border divide-y">
            {keys.map((k) => (
              <div key={k.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground truncate">{k.name}</p>
                  <p className="text-[11px] font-mono text-muted-foreground">
                    {k.prefix}••• · creada {new Date(k.created_at).toLocaleDateString("es-CL")}
                    {k.last_used_at ? ` · usada ${new Date(k.last_used_at).toLocaleDateString("es-CL")}` : " · nunca usada"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} variant="outline" className="rounded-xl text-[10px] font-normal">
                        {API_SCOPE_LABELS[s as ApiScope] ?? s}
                      </Badge>
                    ))}
                  </div>
                </div>
                {k.revoked_at ? (
                  <Badge variant="secondary" className="rounded-xl shrink-0">Revocada</Badge>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-destructive hover:text-destructive rounded-lg">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Revocar “{k.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          El sistema que usa esta llave perderá el acceso de inmediato. Para reconectarlo tendrás que crear una llave nueva.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRevoke(k.id)}>Revocar</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
