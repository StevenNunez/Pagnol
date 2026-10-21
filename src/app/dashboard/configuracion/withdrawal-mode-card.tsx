"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ClipboardCheck, Loader2, Clock, UserX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  onSaveDeadline,
  workersWithoutSupervisor = 0,
  disabled,
}: {
  tenant: Tenant;
  onSave: (mode: Mode) => Promise<void>;
  onSaveDeadline: (hours: number) => Promise<void>;
  /** Trabajadores activos sin supervisor responsable (sus retiros caen al respaldo por contrato). */
  workersWithoutSupervisor?: number;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const current: Mode = tenant.withdrawalReviewMode ?? "prior";
  const [saving, setSaving] = useState<Mode | null>(null);
  const savedHours = tenant.withdrawalReviewDeadlineHours ?? 48;
  const [hours, setHours] = useState(String(savedHours));
  const [savingHours, setSavingHours] = useState(false);
  const hoursNum = Number(hours);
  const hoursValid = Number.isInteger(hoursNum) && hoursNum >= 1 && hoursNum <= 720;

  const saveHours = async () => {
    if (!hoursValid || hoursNum === savedHours) return;
    setSavingHours(true);
    try {
      await onSaveDeadline(hoursNum);
      toast({ title: "Plazo actualizado", description: `Un retiro sin revisar por más de ${hoursNum} h se avisa a la jefatura.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "No se pudo guardar", description: err?.message || "Intenta nuevamente." });
    } finally {
      setSavingHours(false);
    }
  };

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

        {current === "post" && (
          <div className="sm:col-span-2 space-y-3 pt-2">
            <div className="rounded-xl border p-4 space-y-2">
              <p className="text-sm font-bold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Plazo para revisar</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Si un retiro sigue sin revisar pasado este plazo, se marca «vencido» y se avisa al Jefe de Operaciones.
                La bodega nunca se detiene por esto.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={1} max={720} inputMode="numeric" value={hours}
                  onChange={(e) => setHours(e.target.value)} disabled={disabled || savingHours}
                  className="h-10 w-24 rounded-xl" aria-label="Horas de plazo"
                />
                <span className="text-sm text-muted-foreground">horas</span>
                <Button size="sm" variant="outline" className="rounded-xl ml-auto"
                  disabled={disabled || savingHours || !hoursValid || hoursNum === savedHours} onClick={saveHours}>
                  {savingHours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
                </Button>
              </div>
            </div>
            {workersWithoutSupervisor > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning-subtle p-4 text-xs text-warning-subtle-foreground flex items-start gap-2">
                <UserX className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <b>{workersWithoutSupervisor}</b> trabajador{workersWithoutSupervisor !== 1 ? "es" : ""} sin supervisor responsable.
                  Sus retiros los revisan los supervisores del contrato, o administración si no hay. Se asigna en la ficha de cada persona (Usuarios).
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
