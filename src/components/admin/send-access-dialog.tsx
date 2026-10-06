"use client";

import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/modules/core/hooks/use-toast";
import { authHeaders } from "@/modules/core/lib/auth-header";
import { ROLES } from "@/modules/core/lib/permissions";
import type { User } from "@/modules/core/lib/data";
import { Loader2, Mail, Send } from "lucide-react";

const MICRO_LABEL = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";

/**
 * "Enviar acceso por correo": le manda a los usuarios elegidos un correo de
 * Pagnol que explica cómo entrar y los lleva a crear su contraseña. Pensado
 * para la puesta en marcha de una empresa o antes de una inducción.
 * Los operadores quedan fuera por defecto: se identifican con la cara en el
 * pañol y no necesitan entrar a la app.
 */
export function SendAccessDialog({ users, selfId }: { users: User[]; selfId?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const candidates = useMemo(
    () => users
      .filter(u => u.email && u.employmentStatus !== "terminated" && u.role !== "super-admin")
      .sort((a, b) => Number(a.role === "operador") - Number(b.role === "operador") || a.name.localeCompare(b.name)),
    [users],
  );
  const defaultSelection = useMemo(
    // Tú vienes en la lista pero desmarcado: sirve para mandártelo primero y ver cómo llega.
    () => new Set(candidates.filter(u => u.role !== "operador" && u.id !== selfId).map(u => u.id)),
    [candidates, selfId],
  );
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const current = selected ?? defaultSelection;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const handleSend = async () => {
    if (!current.size) return;
    setSending(true);
    try {
      const res = await fetch("/api/users/send-access", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ userIds: [...current], note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No se pudo enviar.");
      const problems = [...(data.failed ?? []), ...(data.skipped ?? [])] as { name: string; reason: string }[];
      toast({
        title: `Correo enviado a ${data.sent?.length ?? 0} persona(s)`,
        description: problems.length
          ? `No se envió a: ${problems.map(p => `${p.name} (${p.reason})`).join(", ")}`
          : "Cada uno recibe cómo entrar y un botón para crear su contraseña.",
        variant: problems.length ? "destructive" : undefined,
      });
      if (!problems.length) { setOpen(false); setNote(""); setSelected(null); }
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo enviar", description: e?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-12 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest">
          <Mail className="mr-2 h-4 w-4" />
          Enviar acceso
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg rounded-[1.5rem]">
        <DialogHeader>
          <DialogTitle>Enviar acceso por correo</DialogTitle>
          <DialogDescription>
            Cada persona recibe un correo de Pagnol con cómo entrar y un botón para crear su contraseña.
            Los operadores no vienen marcados: se identifican con la cara en el pañol.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className={MICRO_LABEL}>Destinatarios ({current.size})</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-7 rounded-xl text-xs" onClick={() => setSelected(new Set(candidates.map(u => u.id)))}>Todos</Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 rounded-xl text-xs" onClick={() => setSelected(new Set())}>Ninguno</Button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-xl border divide-y">
            {candidates.map(u => (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                <Checkbox checked={current.has(u.id)} onCheckedChange={v => toggle(u.id, v === true)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{u.name}{u.id === selfId ? " (tú)" : ""}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                </div>
                <Badge variant="outline" className="rounded-xl text-[10px] font-normal shrink-0">{ROLES[u.role]?.label || u.role}</Badge>
              </label>
            ))}
          </div>

          <div className="space-y-2">
            <span className={MICRO_LABEL}>Mensaje tuyo (opcional)</span>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={800}
              rows={3}
              className="rounded-xl"
              placeholder="Ej: Mañana a las 9:00 hacemos la inducción de Pagnol. Deja tu contraseña lista hoy."
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSend} disabled={sending || !current.size} className="rounded-xl gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar a {current.size}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
