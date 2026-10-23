"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/modules/core/hooks/use-toast";
import { KeyRound, Loader2 } from "lucide-react";
import type { Tenant } from "@/modules/core/lib/data";

/**
 * PIN personal en la entrega por carnet. Apagado por defecto: mientras esté así,
 * pasar el carnet (o escribir el RUT) sigue valiendo como hasta ahora (marcha
 * blanca). Encendido, el trabajador digita su PIN para aceptar lo que recibe; si
 * aún no tiene, lo crea en su primera entrega.
 */
export function CarnetPinCard({
  tenant, onSave, disabled,
}: {
  tenant: Tenant;
  onSave: (required: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const on = tenant.carnetPinRequired === true;
  const [saving, setSaving] = useState(false);

  const toggle = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(next);
      toast({
        title: next ? "PIN exigido" : "PIN desactivado",
        description: next
          ? "Desde ahora, quien se identifique con carnet digita su PIN para confirmar lo que recibe."
          : "La entrega con carnet vuelve a funcionar como antes, sin PIN.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "No se pudo guardar", description: err?.message || "Intenta nuevamente." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="rounded-[1.5rem]">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> PIN en la entrega con carnet
        </CardTitle>
        <CardDescription>
          El carnet dice quién es; el PIN prueba que esa persona está presente y aceptó lo que recibe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
          <div className="space-y-1">
            <p className="text-sm font-bold flex items-center gap-2">
              Exigir PIN personal
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span className={`text-[10px] font-black uppercase tracking-widest ${on ? "text-primary" : "text-muted-foreground"}`}>
                {on ? "Activo" : "Apagado"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Son 4 números que el trabajador elige y digita él mismo, idealmente en un teclado numérico frente a él.
              Tras 5 errores se bloquea 15 minutos. Quien se identifica con el rostro no lo necesita.
            </p>
          </div>
          <Switch checked={on} disabled={disabled || saving} onCheckedChange={toggle} aria-label="Exigir PIN personal" />
        </div>
        {!on && (
          <p className="text-xs text-muted-foreground">
            Mientras esté apagado todo sigue como hasta ahora. Puedes encenderlo cuando termine la marcha blanca.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
