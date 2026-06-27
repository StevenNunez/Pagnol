"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/modules/core/hooks/use-toast";
import { supabase } from "@/modules/core/lib/supabase";
import { getInitials } from "@/modules/core/lib/sequence-utils";
import { Building2, Hash, ImageIcon, Loader2, Save, Trash2, UploadCloud, Lock, Plus, X } from "lucide-react";

const MICRO_LABEL = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";

// Todos los tipos de documento que generan correlativo vía `next_internal_code`.
// `semanticDefault` = prefijo fijo que el sistema pasa en código (hoy solo arriendo
// usa 'SOLPED'); el resto hereda el prefijo base de la empresa si no se sobrescribe.
const DOCUMENT_TYPES: { type: string; label: string; semanticDefault?: string }[] = [
  { type: "TX", label: "Solicitud de material" },
  { type: "RET", label: "Retiro / devolución de material" },
  { type: "PRQ", label: "Solicitud de compra" },
  { type: "PUR", label: "Orden de compra" },
  { type: "RFQ", label: "Cotización de compra" },
  { type: "ARR", label: "Solicitud de arriendo", semanticDefault: "SOLPED" },
  { type: "RFA", label: "Cotización de arriendo" },
  { type: "OCA", label: "Orden de compra (arriendo)" },
  { type: "REC", label: "Recepción" },
  { type: "ACT", label: "Activo" },
  { type: "MOV", label: "Movimiento de activo" },
  { type: "CC", label: "Centro de costo" },
];

const sanitizePrefix = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

export default function ConfiguracionPage() {
  const { currentTenant, updateTenant, can } = useAppState();
  const { toast } = useToast();
  const canManage = can("module_settings:view");

  // ── Estado del formulario (espejo editable del tenant) ──────────────────────
  const [name, setName] = useState("");
  const [rut, setRut] = useState("");
  const [legalRep, setLegalRep] = useState("");
  const [legalRepRut, setLegalRepRut] = useState("");
  const [address, setAddress] = useState("");
  const [faenas, setFaenas] = useState<string[]>([]);
  const [newFaena, setNewFaena] = useState("");
  const [codePrefix, setCodePrefix] = useState("");
  const [codePrefixes, setCodePrefixes] = useState<Record<string, string>>({});
  const [codeTypes, setCodeTypes] = useState<Record<string, string>>({});
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);

  const [savingCompany, setSavingCompany] = useState(false);
  const [savingPrefix, setSavingPrefix] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Sincroniza el formulario cuando carga/cambia el tenant.
  useEffect(() => {
    if (!currentTenant) return;
    setName(currentTenant.name || "");
    setRut(currentTenant.rut || "");
    setLegalRep(currentTenant.legalRepresentative || "");
    setLegalRepRut(currentTenant.legalRepresentativeRut || "");
    setAddress(currentTenant.address || "");
    setFaenas(currentTenant.faenas || []);
    setCodePrefix(currentTenant.codePrefix || "");
    setCodePrefixes(currentTenant.codePrefixes || {});
    setCodeTypes(currentTenant.codeTypes || {});
    setLogoUrl(currentTenant.logoUrl);
  }, [currentTenant]);

  // Prefijo base efectivo: el configurado, o las iniciales del nombre.
  const effectiveBasePrefix = useMemo(() => {
    return codePrefix.trim().toUpperCase() || getInitials(name || "PAG");
  }, [codePrefix, name]);


  if (!canManage) {
    return (
      <PageShell title="Configuración" description="Ajustes de la aplicación para tu empresa.">
        <EmptyState icon={<Lock size={22} />} title="Sin acceso" description="No tienes permisos para ver la configuración de la app." />
      </PageShell>
    );
  }

  const handleSaveCompany = async () => {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Falta el nombre", description: "El nombre de la empresa es obligatorio." });
      return;
    }
    setSavingCompany(true);
    try {
      await updateTenant(currentTenant!.id, {
        name: name.trim(),
        rut: rut.trim() || undefined,
        legalRepresentative: legalRep.trim() || undefined,
        legalRepresentativeRut: legalRepRut.trim() || undefined,
        address: address.trim() || undefined,
        faenas,
      });
      toast({ title: "Datos guardados", description: "La información de la empresa se actualizó." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error al guardar", description: e?.message || "Intenta nuevamente." });
    } finally {
      setSavingCompany(false);
    }
  };

  const handleSavePrefix = async () => {
    setSavingPrefix(true);
    try {
      // Solo persistimos overrides con valor; los vacíos heredan (base / clave interna).
      const clean = (src: Record<string, string>) => {
        const out: Record<string, string> = {};
        for (const [type, val] of Object.entries(src)) {
          const v = (val || "").trim().toUpperCase();
          if (v) out[type] = v;
        }
        return out;
      };
      await updateTenant(currentTenant!.id, {
        codePrefix: codePrefix.trim(),
        codePrefixes: clean(codePrefixes),
        codeTypes: clean(codeTypes),
      });
      toast({
        title: "Correlativos actualizados",
        description: "Los nuevos documentos usarán los prefijos configurados.",
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error al guardar", description: e?.message || "Intenta nuevamente." });
    } finally {
      setSavingPrefix(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentTenant?.id) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "Archivo inválido", description: "Selecciona una imagen (PNG, JPG, SVG)." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Archivo muy grande", description: "El logo no debe superar 2 MB." });
      return;
    }
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${currentTenant.id}/logo.${ext}`;
      const { error: upErr } = await supabase.storage.from("tenant-logos").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("tenant-logos").getPublicUrl(path);
      // Guarda la URL limpia; el cache-bust se usa solo en la vista previa local.
      await updateTenant(currentTenant.id, { logoUrl: publicUrl });
      setLogoUrl(`${publicUrl}?v=${Date.now()}`);
      toast({ title: "Logo guardado", description: "Se aplicará en los PDFs y encabezados." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error al subir logo", description: err?.message || "Intenta nuevamente." });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = async () => {
    if (!currentTenant?.id) return;
    setUploadingLogo(true);
    try {
      await updateTenant(currentTenant.id, { logoUrl: "" });
      setLogoUrl(undefined);
      toast({ title: "Logo eliminado", description: "Los PDFs usarán el logo predeterminado." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message || "Intenta nuevamente." });
    } finally {
      setUploadingLogo(false);
    }
  };

  const addFaena = () => {
    const f = newFaena.trim();
    if (!f || faenas.some((x) => x.toLowerCase() === f.toLowerCase())) { setNewFaena(""); return; }
    setFaenas((prev) => [...prev, f]);
    setNewFaena("");
  };

  return (
    <PageShell title="Configuración" description="Datos de tu empresa, logo y formato de correlativos.">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Datos de la empresa ───────────────────────────────────────── */}
        <Card className="rounded-[1.5rem]">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Datos de la empresa
            </CardTitle>
            <CardDescription>Se usan en los encabezados de cotizaciones, OC y reportes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className={MICRO_LABEL}>Nombre / Razón social *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className={MICRO_LABEL}>RUT</Label>
                <Input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76.123.456-7" className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label className={MICRO_LABEL}>RUT representante</Label>
                <Input value={legalRepRut} onChange={(e) => setLegalRepRut(e.target.value)} placeholder="12.345.678-9" className="rounded-xl" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className={MICRO_LABEL}>Representante legal</Label>
              <Input value={legalRep} onChange={(e) => setLegalRep(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label className={MICRO_LABEL}>Dirección</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label className={MICRO_LABEL}>Faenas / Sectores</Label>
              <div className="flex gap-2">
                <Input value={newFaena} onChange={(e) => setNewFaena(e.target.value)} placeholder="Ej: Faena Norte"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFaena(); } }} className="rounded-xl" />
                <Button type="button" variant="outline" className="shrink-0 rounded-xl" onClick={addFaena}><Plus className="h-4 w-4" /></Button>
              </div>
              {faenas.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {faenas.map((f) => (
                    <Badge key={f} variant="secondary" className="rounded-xl gap-1">
                      {f}
                      <button type="button" onClick={() => setFaenas((prev) => prev.filter((x) => x !== f))} className="hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <Button onClick={handleSaveCompany} disabled={savingCompany} className="w-full rounded-xl gap-2">
              {savingCompany ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar datos
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* ── Logo ────────────────────────────────────────────────────── */}
          <Card className="rounded-[1.5rem]">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-primary" /> Logo de la empresa
              </CardTitle>
              <CardDescription>PNG, JPG o SVG, hasta 2 MB. Aparece en los PDFs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-xl border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
                  {logoUrl
                    ? <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
                    : <ImageIcon className="h-7 w-7 text-muted-foreground" />}
                </div>
                <div className="flex flex-col gap-2">
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  <Button type="button" variant="outline" className="rounded-xl gap-2" disabled={uploadingLogo} onClick={() => logoInputRef.current?.click()}>
                    {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Subir logo
                  </Button>
                  {logoUrl && (
                    <Button type="button" variant="ghost" className="rounded-xl gap-2 text-destructive hover:text-destructive" disabled={uploadingLogo} onClick={handleRemoveLogo}>
                      <Trash2 className="h-4 w-4" /> Quitar
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Correlativos ────────────────────────────────────────────── */}
          <Card className="rounded-[1.5rem]">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Hash className="h-5 w-5 text-primary" /> Formato de correlativos
              </CardTitle>
              <CardDescription>
                Formato <span className="font-mono">PREFIJO-TIPO-NÚMERO</span>. Define el prefijo base
                y, si quieres, sobrescribe el de cada documento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Prefijo base de la empresa: lo heredan los documentos sin override. */}
              <div className="space-y-2">
                <Label className={MICRO_LABEL}>Prefijo base de la empresa</Label>
                <Input value={codePrefix} onChange={(e) => setCodePrefix(sanitizePrefix(e.target.value))}
                  placeholder="Vacío = iniciales del nombre" maxLength={8} className="rounded-xl uppercase" />
                <p className="text-xs text-muted-foreground">
                  Base efectiva: <span className="font-mono font-semibold text-foreground">{effectiveBasePrefix}</span>
                  {!codePrefix.trim() && <> · (derivado de <strong>{name || "el nombre"}</strong>)</>}
                </p>
              </div>

              {/* Override por documento: prefijo y tipo editables inline. */}
              <div className="space-y-2">
                <Label className={MICRO_LABEL}>Código por documento</Label>
                <div className="rounded-xl border divide-y">
                  {DOCUMENT_TYPES.map(({ type, label, semanticDefault }) => {
                    const inheritedPrefix = semanticDefault || effectiveBasePrefix;
                    return (
                      <div key={type} className="p-2.5 space-y-1.5">
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        <div className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
                          <Input
                            value={codePrefixes[type] ?? ""}
                            onChange={(e) =>
                              setCodePrefixes((prev) => ({ ...prev, [type]: sanitizePrefix(e.target.value) }))
                            }
                            placeholder={inheritedPrefix}
                            maxLength={10}
                            aria-label={`Prefijo de ${label}`}
                            className="rounded-lg uppercase w-24 h-8 text-center"
                          />
                          <span>-</span>
                          <Input
                            value={codeTypes[type] ?? ""}
                            onChange={(e) =>
                              setCodeTypes((prev) => ({ ...prev, [type]: sanitizePrefix(e.target.value) }))
                            }
                            placeholder={type}
                            maxLength={8}
                            aria-label={`Tipo de ${label}`}
                            className="rounded-lg uppercase w-20 h-8 text-center"
                          />
                          <span>-0001</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  El texto gris es el valor heredado (vacío = se usa ese). Cambiarlo solo afecta los
                  {" "}<strong>nuevos</strong> documentos; los ya emitidos conservan su número y la
                  {" "}numeración no se reinicia.
                </p>
              </div>

              <Button onClick={handleSavePrefix} disabled={savingPrefix} className="w-full rounded-xl gap-2">
                {savingPrefix ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar correlativos
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
