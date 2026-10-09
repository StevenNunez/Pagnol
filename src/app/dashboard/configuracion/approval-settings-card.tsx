"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Loader2, Save, Signature } from "lucide-react";
import type { ApprovalSettings, Tenant } from "@/modules/core/lib/data";
import { resolveApprovalSettings } from "@/modules/data/mutations/approvalMath";

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/**
 * RFC-006: quién firma según el monto. Hasta el tope firma el ADC del contrato;
 * sobre el tope, sólo el Gerente General. Todo con IVA.
 */
export function ApprovalSettingsCard({
  tenant,
  onSave,
  disabled,
}: {
  tenant: Tenant;
  onSave: (settings: ApprovalSettings) => Promise<void>;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const current = resolveApprovalSettings(tenant.approvalSettings);
  const [adcMax, setAdcMax] = useState(String(current.adcMaxGross));
  const [vatPct, setVatPct] = useState(String(Math.round(current.vatRate * 100)));
  const [enforced, setEnforced] = useState(!!current.enforced);
  const [saving, setSaving] = useState(false);

  const adcNum = Math.round(Number(adcMax));
  const vatNum = Number(vatPct);
  const valid = Number.isFinite(adcNum) && adcNum >= 0 && Number.isFinite(vatNum) && vatNum >= 0 && vatNum < 100;
  const dirty = adcNum !== current.adcMaxGross || vatNum / 100 !== current.vatRate || enforced !== !!current.enforced;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onSave({ adcMaxGross: adcNum, vatRate: vatNum / 100, enforced });
      toast({ title: "Montos guardados", description: `Hasta ${clp(adcNum)} con IVA firma el ADC; sobre eso, el Gerente General.` });
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
          <Signature className="h-5 w-5 text-primary" /> Quién firma según el monto
        </CardTitle>
        <CardDescription>
          Compras, arriendos (valor mensual) y retiros del pañol. Los montos son con IVA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <div className="space-y-1.5">
            <Label htmlFor="adc-max">El ADC del contrato firma hasta (con IVA)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="adc-max"
                type="number"
                inputMode="numeric"
                min={0}
                step={10000}
                value={adcMax}
                disabled={disabled}
                onChange={(e) => setAdcMax(e.target.value)}
                className="pl-7 rounded-xl"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vat">IVA (%)</Label>
            <Input
              id="vat"
              type="number"
              inputMode="decimal"
              min={0}
              max={99}
              value={vatPct}
              disabled={disabled}
              onChange={(e) => setVatPct(e.target.value)}
              className="rounded-xl"
            />
          </div>
        </div>

        {valid && (
          <div className="grid gap-2 sm:grid-cols-2 text-sm">
            <div className="rounded-xl border p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Hasta {clp(adcNum)}</p>
              <p className="font-semibold mt-1">Firma el ADC de cada contrato</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sobre {clp(adcNum)}</p>
              <p className="font-semibold mt-1">Firma sólo el Gerente General</p>
            </div>
          </div>
        )}
        <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
          <div>
            <p className="text-sm font-semibold">Exigir firma antes de emitir la OC</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enforced
                ? "Ninguna OC sale sin una propuesta firmada: lo controla el sistema, no sólo la pantalla."
                : "Enciéndelo cuando cada contrato tenga su ADC asignado. Mientras esté apagado, el sistema no bloquea OC sin firma."}
            </p>
          </div>
          <Switch checked={enforced} onCheckedChange={setEnforced} disabled={disabled} aria-label="Exigir firma antes de emitir la OC" />
        </div>

        <p className="text-xs text-muted-foreground">
          Abastecimiento puede mandarle una compra al Gerente aunque no pase el monto (por ejemplo, por las cantidades),
          explicando por qué. Cada contrato necesita su ADC asignado en Clientes y Contratos.
        </p>

        <Button onClick={save} disabled={disabled || saving || !valid || !dirty} className="w-full rounded-xl gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
        </Button>
      </CardContent>
    </Card>
  );
}
