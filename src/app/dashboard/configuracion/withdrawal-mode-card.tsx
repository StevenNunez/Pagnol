"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ClipboardCheck, Loader2 } from "lucide-react";
import type { Tenant } from "@/modules/core/lib/data";

type Mode = NonNullable<Tenant["withdrawalReviewMode"]>;

const OPTIONS: { value: Mode; title: string; body: string }[] = [
  {
    value: "prior",
    title: "Aprobación previa",
    body: "Si el retiro trae algo clase A o B, no sale hasta que un supervisor lo apruebe. La clase C se entrega al tiro.",
  },
  {
    value: "post",
    title: "Revisión posterior",
    body: "Las clases C y B se entregan al tiro y el supervisor revisa la lista después, ítem por ítem. La clase A sigue pidiendo aprobación antes.",
  },
];

/**
 * Cómo sale un retiro en la ventanilla del pañol. Pensado para faenas donde
 * cada trabajador retira 10-15 cosas por día: con aprobación previa, un solo
 * ítem clase B dejaba esperando todo el retiro.
 */
export function WithdrawalModeCard({
  tenant,
  onSave,
  disabled,
}: {
  tenant: Tenant;
  onSave: (mode: Mode) => Promise<void>;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const current: Mode = tenant.withdrawalReviewMode ?? "prior";
  const [saving, setSaving] = useState<Mode | null>(null);

  const choose = async (mode: Mode) => {
    if (mode === current || saving) return;
    setSaving(mode);
    try {
      await onSave(mode);
      toast({
        title: "Modalidad actualizada",
        description: mode === "post"
          ? "Los retiros clase B y C se entregan al tiro y quedan para revisión del supervisor."
          : "Los retiros con clase A o B vuelven a pedir aprobación antes de entregarse.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "No se pudo guardar", description: err?.message || "Intenta nuevamente." });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="rounded-[1.5rem]">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" /> Retiros en el pañol
        </CardTitle>
        <CardDescription>Cómo se autoriza lo que un trabajador retira en ventanilla.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const active = o.value === current;
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled || !!saving}
              onClick={() => choose(o.value)}
              aria-pressed={active}
              className={cn(
                "text-left p-4 rounded-xl border-2 transition-all disabled:opacity-60",
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
              )}
            >
              <p className="text-sm font-bold flex items-center gap-2">
                {o.title}
                {saving === o.value && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {active && <span className="text-[10px] font-black uppercase tracking-widest text-primary">Activa</span>}
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{o.body}</p>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
