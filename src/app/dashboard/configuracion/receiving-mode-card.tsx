"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Truck } from "lucide-react";
import type { Tenant } from "@/modules/core/lib/data";

type Mode = NonNullable<Tenant["receivingMode"]>;

const OPTIONS: { value: Mode; title: string; body: string }[] = [
  {
    value: "externa",
    title: "En el sistema de compras",
    body: "Quien compra (por ejemplo, Valar) recibe allá y le avisa a Pagnol lo que llegó. Pagnol no tiene lista de «por recibir».",
  },
  {
    value: "pagnol",
    title: "En Pagnol",
    body: "El sistema de compras anuncia lo que viene en camino y el pañolero lo recibe aquí. Nunca se recibe en los dos lados.",
  },
];

/**
 * Dónde se recibe lo que se compra. Es UNO u OTRO: si se recibiera en los dos lados, el stock
 * se contaría dos veces. No se puede cambiar mientras haya compras anunciadas sin cerrar
 * (lo impide la base y el mensaje dice cuántas faltan).
 */
export function ReceivingModeCard({
  tenant, onSave, disabled,
}: {
  tenant: Tenant;
  onSave: (mode: Mode) => Promise<void>;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const current: Mode = tenant.receivingMode ?? "externa";
  const [saving, setSaving] = useState<Mode | null>(null);

  const choose = async (mode: Mode) => {
    if (mode === current || saving) return;
    setSaving(mode);
    try {
      await onSave(mode);
      toast({
        title: "Listo",
        description: mode === "pagnol"
          ? "Desde ahora las compras anunciadas se reciben en Pagnol (menú Control de Activos › Por Recibir)."
          : "Desde ahora la recepción vuelve a hacerse en el sistema de compras.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "No se pudo cambiar", description: err?.message || "Intenta nuevamente." });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="rounded-[1.5rem]">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" /> Dónde se recibe
        </CardTitle>
        <CardDescription>Qué sistema registra lo que llega cuando compras por una integración.</CardDescription>
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
