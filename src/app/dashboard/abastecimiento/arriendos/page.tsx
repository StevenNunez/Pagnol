"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  KeyRound, Check, X, Search, Send, Trophy, Loader2, Plus, FileText, Trash2,
  Clock, Building2, Truck, AlertCircle, Download, Mail, Sparkles, UploadCloud,
} from "lucide-react";
import type {
  RentalRequest, RentalQuoteRequest, Supplier,
  RentalBillingCycle, RentalQuoteItem, RentalQuoteResponse, RentalQuoteLine,
} from "@/modules/core/lib/data";

/** Fila editable de cotización por ítem (estado del formulario). */
type LineRow = { price: string; qty: string; periods: string };
import { rentalCategoryLabel } from "@/modules/core/lib/data";
import { generateRentalQuoteRequestPDF, type RentalCompanyInfo } from "@/lib/pdf-rental";
import { supabase } from "@/modules/core/lib/supabase";

const IVA_RATE = 0.19;
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const CYCLE_LABELS: Record<RentalBillingCycle, string> = {
  daily: "Diario", weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual", one_time: "Pago único",
};
const fmt = (d: any) => d ? new Date(d).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const money = (n: number) => "$" + (Number(n) || 0).toLocaleString("es-CL");

export default function AbastecimientoArriendosPage() {
  const {
    rentalRequests, rentalQuoteRequests, suppliers, currentTenant,
    deleteRentalRequest, addSupplier,
    addRentalQuoteRequest, recordRentalQuoteResponse, awardRentalQuote, deleteRentalQuoteRequest, sendRentalQuoteRequest,
    can,
  } = useAppState();

  const company: RentalCompanyInfo = {
    name: currentTenant?.name || "PAGNOL",
    rut: currentTenant?.rut,
    address: currentTenant?.address,
    logoUrl: currentTenant?.logoUrl,
  };
  const { user } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const canManage = can("rentals:manage_quotes");

  const requests = (rentalRequests || []) as RentalRequest[];
  const rfqs = (rentalQuoteRequests || []) as RentalQuoteRequest[];
  // Un arrendador ES un proveedor: la fuente única son los `suppliers`.
  const lessors = useMemo(() => (suppliers || []) as Supplier[], [suppliers]);
  const partyMap = useMemo(() => new Map(lessors.map((p) => [p.id, p])), [lessors]);

  // Gate ADC: Abastecimiento solo ve solicitudes ya AUTORIZADAS por el ADC.
  // Las pendientes sin autorizar viven en /dashboard/authorizations.
  const pendingRequests = useMemo(() => requests.filter((r) => r.status === "pending" && r.adcAuthorizedAt), [requests]);
  const quotingRequests = useMemo(() => requests.filter((r) => r.status === "quoting"), [requests]);
  const closedRequests = useMemo(() => requests.filter((r) => ["approved", "fulfilled", "rejected"].includes(r.status)), [requests]);

  // ── Crear RFQ ────────────────────────────────────────────────────────────────
  const [selectedReqs, setSelectedReqs] = useState<Set<string>>(new Set());
  const [rfqDialogOpen, setRfqDialogOpen] = useState(false);
  const [rfqTitle, setRfqTitle] = useState("");
  const [rfqDeadline, setRfqDeadline] = useState("");
  const [rfqParties, setRfqParties] = useState<Set<string>>(new Set());
  const [newLessorName, setNewLessorName] = useState("");
  const [addingLessor, setAddingLessor] = useState(false);

  // Alta rápida de arrendador SIN salir del flujo de cotización (queda invitado).
  const handleAddLessor = async () => {
    const name = newLessorName.trim();
    if (!name) return;
    setAddingLessor(true);
    try {
      const created = await addSupplier({ name, categories: ["Arriendo"] });
      setRfqParties((prev) => { const n = new Set(prev); n.add(created.id); return n; });
      setNewLessorName("");
      toast({ title: "Arrendador agregado", description: `${name} quedó como proveedor e invitado a cotizar.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message || "No se pudo agregar el arrendador." });
    } finally {
      setAddingLessor(false);
    }
  };

  const toggleReq = (id: string) => {
    setSelectedReqs((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleParty = (id: string) => {
    setRfqParties((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const openRfqDialog = () => {
    if (selectedReqs.size === 0) {
      toast({ variant: "destructive", title: "Selecciona solicitudes", description: "Marca al menos una solicitud para cotizar." });
      return;
    }
    const sel = requests.filter((r) => selectedReqs.has(r.id));
    const totalItems = sel.reduce((n, r) => n + (r.items?.length || 1), 0);
    setRfqTitle(`Arriendo ${sel[0]?.equipmentName || ""} (${totalItems} equipo/s)`.trim());
    setRfqParties(new Set());
    setRfqDeadline("");
    setRfqDialogOpen(true);
  };

  const handleCreateRfq = async () => {
    if (rfqParties.size === 0) {
      toast({ variant: "destructive", title: "Sin arrendadores", description: "Invita al menos un arrendador a cotizar." });
      return;
    }
    setBusy("rfq");
    try {
      // Cada solicitud puede traer varios equipos (carrito) → se expanden a ítems del RFQ.
      const items: RentalQuoteItem[] = requests
        .filter((r) => selectedReqs.has(r.id))
        .flatMap((r) => r.items.map((it, idx) => ({
          id: `${r.id}:${idx}`, name: it.name, category: it.category, quantity: it.quantity,
          startDate: r.startDate, endDate: r.endDate, billingCycle: r.billingCycleEstimate,
        })));
      await addRentalQuoteRequest({
        title: rfqTitle.trim() || "Cotización de arriendo",
        requestIds: Array.from(selectedReqs),
        items,
        partyIds: Array.from(rfqParties),
        deadline: rfqDeadline || undefined,
      });
      toast({ title: "Cotización creada", description: "Se invitó a los arrendadores a cotizar." });
      setSelectedReqs(new Set());
      setRfqDialogOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo crear la cotización." });
    } finally { setBusy(null); }
  };

  const reqStatusBadge = (s: RentalRequest["status"]) => {
    const map: Record<string, string> = { pending: "badge-warning", quoting: "badge-info", approved: "badge-success", fulfilled: "badge-success" };
    if (s === "rejected") return <Badge variant="destructive">Rechazada</Badge>;
    const labels: Record<string, string> = { pending: "Pendiente", quoting: "En cotización", approved: "Aprobada", fulfilled: "Arriendo creado" };
    return <Badge className={map[s]}>{labels[s] || s}</Badge>;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <PageHeader
        title="Arriendos — Abastecimiento"
        description="Gestiona las solicitudes de arriendo de terreno: cotiza a arrendadores, compara y adjudica."
      />

      {!canManage && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-warning/30 bg-warning-subtle text-warning-subtle-foreground text-sm">
          <AlertCircle className="h-4 w-4" /> No tienes permiso para gestionar cotizaciones de arriendo.
        </div>
      )}

      <Tabs defaultValue="solicitudes" className="space-y-6">
        <TabsList>
          <TabsTrigger value="solicitudes">Solicitudes ({pendingRequests.length + quotingRequests.length})</TabsTrigger>
          <TabsTrigger value="rfq">Cotizaciones ({rfqs.filter((r) => r.status !== "awarded").length})</TabsTrigger>
          <TabsTrigger value="historial">Historial ({closedRequests.length})</TabsTrigger>
        </TabsList>

        {/* ── SOLICITUDES ───────────────────────────────────────────────────── */}
        <TabsContent value="solicitudes" className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-muted-foreground">
              Marca las solicitudes pendientes y crea una solicitud de cotización para enviarla a los arrendadores.
            </p>
            <Button onClick={openRfqDialog} disabled={!canManage || selectedReqs.size === 0}>
              <Search className="mr-2 h-4 w-4" /> Cotizar seleccionadas ({selectedReqs.size})
            </Button>
          </div>

          {pendingRequests.length === 0 && quotingRequests.length === 0 ? (
            <EmptyBox icon={KeyRound} text="No hay solicitudes de arriendo pendientes." />
          ) : (
            [...pendingRequests, ...quotingRequests].map((req) => (
              <Card key={req.id} className="rounded-[1.5rem]">
                <CardContent className="p-4 flex items-start gap-3">
                  {req.status === "pending" && (
                    <input type="checkbox" className="mt-1.5 h-4 w-4 accent-primary"
                      checked={selectedReqs.has(req.id)} onChange={() => toggleReq(req.id)} disabled={!canManage} />
                  )}
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {reqStatusBadge(req.status)}
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{req.internalCode}</span>
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center"><Clock className="h-3 w-3 mr-1" />{fmt(req.createdAt)}</span>
                    </div>
                    <div className="space-y-0.5">
                      {req.items.map((it, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm font-semibold">
                          <Truck className="h-3.5 w-3.5 text-primary shrink-0" />
                          {it.name} <span className="text-muted-foreground font-normal">×{it.quantity}</span>
                          <span className="text-[10px] font-normal text-muted-foreground">({rentalCategoryLabel(it.category)})</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{fmt(req.startDate)} → {fmt(req.endDate)}</span>
                      <span>{CYCLE_LABELS[req.billingCycleEstimate]}</span>
                      <span><b>Contrato:</b> {req.contractName || "—"}</span>
                      <span><b>Solicita:</b> {req.supervisorName}</span>
                    </div>
                    {req.justification && <div className="text-xs text-muted-foreground italic">"{req.justification}"</div>}
                    {req.status === "pending" && (
                      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-success-subtle-foreground">
                        <Check className="h-3.5 w-3.5" /> Autorizada por el ADC · marca la casilla para cotizar
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ── RFQ ───────────────────────────────────────────────────────────── */}
        <TabsContent value="rfq" className="space-y-4">
          {rfqs.length === 0 ? (
            <EmptyBox icon={FileText} text="Aún no hay cotizaciones de arriendo." />
          ) : (
            rfqs.map((rfq) => (
              <RfqCard
                key={rfq.id}
                rfq={rfq}
                lessors={lessors}
                partyMap={partyMap}
                canManage={canManage}
                company={company}
                requestedByName={user?.name || ""}
                sender={{ name: user?.name || "", email: user?.email || "", phone: user?.phone, role: user?.cargo }}
                onRecordResponse={recordRentalQuoteResponse}
                onAward={awardRentalQuote}
                onSend={sendRentalQuoteRequest}
                onDelete={deleteRentalQuoteRequest}
              />
            ))
          )}
        </TabsContent>

        {/* ── HISTORIAL ─────────────────────────────────────────────────────── */}
        <TabsContent value="historial" className="space-y-4">
          {closedRequests.length === 0 ? (
            <EmptyBox icon={Clock} text="Sin historial todavía." />
          ) : (
            closedRequests.map((req) => (
              <Card key={req.id} className="rounded-[1.5rem]">
                <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">{reqStatusBadge(req.status)}
                      <span className="font-semibold">
                        {req.items.map((it) => `${it.name} ×${it.quantity}`).join(", ")}
                      </span></div>
                    <div className="text-xs text-muted-foreground">{req.contractName || "—"} · {fmt(req.startDate)} → {fmt(req.endDate)}</div>
                  </div>
                  <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive"
                    onClick={() => deleteRentalRequest(req.id)} disabled={!canManage}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog crear RFQ */}
      <Dialog open={rfqDialogOpen} onOpenChange={setRfqDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear solicitud de cotización</DialogTitle>
            <DialogDescription>Invita arrendadores a cotizar las {selectedReqs.size} solicitud(es) seleccionadas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={rfqTitle} onChange={(e) => setRfqTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Fecha límite de respuesta (opcional)</Label>
              <Input type="date" value={rfqDeadline} onChange={(e) => setRfqDeadline(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Arrendadores invitados</Label>
              {/* Alta rápida inline: crea e invita al arrendador sin salir del flujo. */}
              <div className="flex gap-2">
                <Input
                  value={newLessorName}
                  onChange={(e) => setNewLessorName(e.target.value)}
                  placeholder="Nombre del arrendador…"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddLessor(); } }}
                />
                <Button type="button" variant="outline" className="shrink-0" disabled={addingLessor || !newLessorName.trim()} onClick={handleAddLessor}>
                  {addingLessor ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Agregar</>}
                </Button>
              </div>
              {lessors.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aún no hay proveedores. Agrega el primero arriba — quedará invitado automáticamente. (También puedes gestionarlos en Abastecimiento → Proveedores.)
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-xl p-2">
                  {lessors.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={rfqParties.has(p.id)} onChange={() => toggleParty(p.id)} />
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRfqDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateRfq} disabled={busy === "rfq" || rfqParties.size === 0}>
              {busy === "rfq" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-2 h-4 w-4" /> Crear cotización</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyBox({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="text-center py-12 bg-muted/20 rounded-[1.5rem] border-2 border-dashed">
      <Icon className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}

// ── Matriz comparativa por ítem (equipo × arrendador) ─────────────────────────
function ItemMatrix({ rfq, responses }: { rfq: RentalQuoteRequest; responses: RentalQuoteResponse[] }) {
  const linePrice = (resp: RentalQuoteResponse, itemId: string) =>
    resp.lines?.find((l) => l.itemId === itemId)?.pricePerPeriod;

  // Mejor (menor) precio por ítem, para resaltar la celda ganadora.
  const bestByItem = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of rfq.items) {
      const prices = responses.map((r) => linePrice(r, it.id)).filter((p): p is number => p != null && p > 0);
      if (prices.length) m[it.id] = Math.min(...prices);
    }
    return m;
  }, [rfq.items, responses]);

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Comparador por ítem · mejor precio resaltado</p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-muted/50 min-w-[160px]">Equipo</th>
              {responses.map((r) => (
                <th key={r.id} className="text-right font-semibold px-3 py-2 whitespace-nowrap min-w-[120px]">{r.partyName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rfq.items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-3 py-2 sticky left-0 bg-card whitespace-nowrap">{it.name} <span className="text-muted-foreground">×{it.quantity}</span></td>
                {responses.map((r) => {
                  const p = linePrice(r, it.id);
                  const isBest = p != null && p > 0 && p === bestByItem[it.id];
                  return (
                    <td key={r.id} className={`px-3 py-2 text-right tabular-nums ${isBest ? "bg-success-subtle font-bold text-success-subtle-foreground" : "text-muted-foreground"}`}>
                      {p != null && p > 0 ? money(p) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t bg-muted/30">
              <td className="px-3 py-2 sticky left-0 bg-muted/30 font-semibold">Total / período</td>
              {responses.map((r) => {
                const totals = responses.map((x) => x.pricePerPeriod || 0).filter((n) => n > 0);
                const minTotal = totals.length ? Math.min(...totals) : 0;
                const isBest = (r.pricePerPeriod || 0) > 0 && r.pricePerPeriod === minTotal;
                return (
                  <td key={r.id} className={`px-3 py-2 text-right tabular-nums font-semibold ${isBest ? "text-success-subtle-foreground" : ""}`}>{money(r.pricePerPeriod || 0)}</td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tarjeta de un RFQ con respuestas + comparador + adjudicar ─────────────────
function RfqCard({
  rfq, lessors, partyMap, canManage, company, requestedByName, sender, onRecordResponse, onAward, onSend, onDelete,
}: {
  rfq: RentalQuoteRequest;
  lessors: Supplier[];
  partyMap: Map<string, Supplier>;
  canManage: boolean;
  company: RentalCompanyInfo;
  requestedByName: string;
  sender: { name: string; email: string; phone?: string; role?: string };
  onRecordResponse: (id: string, r: Omit<RentalQuoteResponse, "id" | "createdAt"> & { id?: string }) => Promise<void>;
  onAward: (id: string, responseId: string, opts?: { currency?: string; paymentDay?: number | null; periods?: number }) => Promise<{ rentalContractId: string; ocNumber: string }>;
  onSend: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [respOpen, setRespOpen] = useState(false);

  const invited = useMemo(() => rfq.partyIds.map((id) => partyMap.get(id)).filter(Boolean) as Supplier[], [rfq.partyIds, partyMap]);

  // Construye los ítems del PDF a partir del RFQ.
  const pdfItems = useMemo(() => rfq.items.map((it) => ({
    name: it.name, category: it.category, quantity: it.quantity,
    startDate: it.startDate, endDate: it.endDate, billingCycle: it.billingCycle,
  })), [rfq.items]);

  // Descarga el PDF de solicitud de cotización (genérico o dirigido a un arrendador).
  const handleDownloadPdf = async (lessor?: Supplier) => {
    try {
      const { blob, filename } = await generateRentalQuoteRequestPDF({
        company,
        code: rfq.internalCode || rfq.id.slice(0, 8),
        deadline: rfq.deadline,
        requestedBy: requestedByName,
        items: pdfItems,
        notes: rfq.notes,
        lessor: lessor ? {
          name: lessor.name, rut: lessor.rut, address: lessor.address,
          contactName: lessor.contacts?.[0]?.name, email: lessor.email, phone: lessor.phone,
        } : undefined,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      document.body.removeChild(a); window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error al generar PDF", description: e?.message || "No se pudo crear el documento." });
    }
  };

  // Envío por correo del PDF de solicitud de cotización.
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [sending, setSending] = useState(false);

  const openEmail = () => {
    setEmailTo(invited.map((p) => p.email).filter(Boolean).join(", "));
    setEmailMsg("");
    setEmailOpen(true);
  };

  const handleSendEmail = async () => {
    const recipients = emailTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) {
      toast({ variant: "destructive", title: "Falta el correo", description: "Indica al menos un destinatario." });
      return;
    }
    setSending(true);
    try {
      // Si todos los destinatarios son de un mismo arrendador invitado, personaliza el PDF.
      const target = invited.find((p) => p.email && recipients.includes(p.email.trim()));
      const { blob, filename } = await generateRentalQuoteRequestPDF({
        company, code: rfq.internalCode || rfq.id.slice(0, 8), deadline: rfq.deadline,
        requestedBy: requestedByName, items: pdfItems, notes: rfq.notes,
        lessor: target ? {
          name: target.name, rut: target.rut, address: target.address,
          contactName: target.contacts?.[0]?.name, email: target.email, phone: target.phone,
        } : undefined,
      });
      const pdfBase64 = await blobToBase64(blob);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sesión no disponible.");
      const res = await fetch("/api/purchasing/send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: recipients,
          subject: `Solicitud de cotización de arriendo ${rfq.internalCode || ""}`.trim(),
          message: emailMsg.trim() || undefined,
          pdfBase64, filename, orderCode: rfq.internalCode || "",
          docLabel: "Solicitud de cotización de arriendo",
          companyName: company.name, companyLogoUrl: company.logoUrl,
          senderName: sender.name, senderEmail: sender.email, senderPhone: sender.phone, senderRole: sender.role,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ title: "Solicitud enviada", description: `Se envió a ${recipients.join(", ")}.` });
      setEmailOpen(false);
      if (rfq.status === "draft") await onSend(rfq.id);
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo enviar", description: e?.message || "Error desconocido." });
    } finally {
      setSending(false);
    }
  };
  const bestId = useMemo(() => {
    if (!rfq.responses.length) return null;
    return [...rfq.responses].sort((a, b) =>
      (a.totalEstimate ?? a.pricePerPeriod) - (b.totalEstimate ?? b.pricePerPeriod))[0].id;
  }, [rfq.responses]);

  // Form respuesta — una línea por cada ítem del RFQ (comparación por ítem)
  const defaultCycle = rfq.items[0]?.billingCycle || "monthly";
  const blankRows = (): Record<string, LineRow> =>
    Object.fromEntries(rfq.items.map((it) => [it.id, { price: "", qty: String(it.quantity || 1), periods: "1" }]));

  const [partyId, setPartyId] = useState("");
  const [lineRows, setLineRows] = useState<Record<string, LineRow>>(blankRows);
  const [availability, setAvailability] = useState("");
  const [conditions, setConditions] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);

  const setCell = (itemId: string, field: keyof LineRow, val: string) => {
    // Solo valores ≥ 0: descarta signos negativos escritos a mano.
    const clean = val.replace(/-/g, "");
    setLineRows((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] || { price: "", qty: "1", periods: "1" }), [field]: clean } }));
  };

  const lineTotalOf = (r?: LineRow) => (Number(r?.price) || 0) * (Number(r?.qty) || 1) * (Number(r?.periods) || 1);
  const grandTotal = rfq.items.reduce((s, it) => s + lineTotalOf(lineRows[it.id]), 0);

  const resetForm = () => { setPartyId(""); setLineRows(blankRows()); setAvailability(""); setConditions(""); setAiUsed(false); };

  // Sube el PDF del arrendador → IA extrae precios por ítem → precarga (revisar antes de guardar).
  const handleExtractPdf = async (file: File) => {
    setExtracting(true);
    try {
      const dataUrl = await blobToBase64(file);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sesión no disponible.");
      const res = await fetch("/api/rentals/extract-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pdfBase64: dataUrl,
          cycleLabel: CYCLE_LABELS[defaultCycle],
          items: rfq.items.map((it) => ({ id: it.id, name: it.name, quantity: it.quantity })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const data = json.data as { partyName?: string; availabilityDate?: string; conditions?: string; lines?: any[] };

      const next = blankRows();
      for (const ln of data.lines || []) {
        if (ln.itemId && next[ln.itemId]) {
          next[ln.itemId] = {
            price: ln.pricePerPeriod != null ? String(ln.pricePerPeriod) : "",
            qty: ln.quantity != null ? String(ln.quantity) : next[ln.itemId].qty,
            periods: ln.periods != null ? String(ln.periods) : "1",
          };
        }
      }
      setLineRows(next);
      if (data.availabilityDate) setAvailability(data.availabilityDate);
      if (data.conditions) setConditions(data.conditions);
      // Sugiere el arrendador invitado cuyo nombre se parezca al detectado.
      if (data.partyName && !partyId) {
        const dn = data.partyName.toLowerCase();
        const match = invited.find((p) => dn.includes(p.name.toLowerCase().slice(0, 6)) || p.name.toLowerCase().includes(dn.slice(0, 6)));
        if (match) setPartyId(match.id);
      }
      setAiUsed(true);
      const matched = (data.lines || []).filter((l: any) => l.itemId).length;
      toast({ title: "Cotización extraída con IA", description: `${matched} de ${rfq.items.length} ítem(s) mapeado(s). Revisa y corrige antes de guardar.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo extraer", description: e?.message || "Error procesando el PDF con IA." });
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveResponse = async () => {
    if (!partyId) {
      toast({ variant: "destructive", title: "Falta el arrendador", description: "Elige a qué arrendador corresponde esta cotización." });
      return;
    }
    const lines: RentalQuoteLine[] = rfq.items.map((it) => {
      const r = lineRows[it.id] || { price: "", qty: String(it.quantity || 1), periods: "1" };
      const price = Number(r.price) || 0, qty = Number(r.qty) || 1, per = Number(r.periods) || 1;
      return { itemId: it.id, matchedName: it.name, pricePerPeriod: price, quantity: qty, periods: per, total: price * qty * per };
    });
    if (lines.every((l) => l.pricePerPeriod === 0)) {
      toast({ variant: "destructive", title: "Sin precios", description: "Ingresa al menos un precio (sube el PDF o complétalo a mano)." });
      return;
    }
    setBusy(true);
    try {
      const ppSum = lines.reduce((s, l) => s + l.pricePerPeriod * (l.quantity || 1), 0);
      const totalEst = lines.reduce((s, l) => s + (l.total || 0), 0);
      const maxPeriods = Math.max(1, ...lines.map((l) => l.periods || 1));
      await onRecordResponse(rfq.id, {
        partyId, partyName: partyMap.get(partyId)?.name || "Arrendador",
        pricePerPeriod: ppSum, billingCycle: defaultCycle, periods: maxPeriods,
        totalEstimate: totalEst, availabilityDate: availability || undefined,
        conditions: conditions || undefined, lines, extractedByAi: aiUsed,
      });
      toast({ title: "Cotización registrada" });
      resetForm();
      setRespOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo registrar la cotización." });
    } finally { setBusy(false); }
  };

  const handleAward = async (responseId: string, periodsForAward?: number) => {
    setBusy(true);
    try {
      const res = await onAward(rfq.id, responseId, { periods: periodsForAward });
      toast({ title: "¡Arriendo adjudicado!", description: `Orden de Compra ${res.ocNumber} lista para emitir. Pulsa "Emitir OC →" para generarla y confirmarla.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error al adjudicar", description: e?.message || "No se pudo generar el contrato." });
    } finally { setBusy(false); }
  };

  const awarded = rfq.status === "awarded";

  return (
    <Card className={`rounded-[1.5rem] ${awarded ? "border-success/40" : ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> {rfq.title}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-black uppercase tracking-widest">{rfq.internalCode}</span>
              {awarded
                ? <Badge className="badge-success"><Trophy className="h-3 w-3 mr-1" /> Adjudicado</Badge>
                : <Badge className="badge-info">{rfq.status === "sent" ? "Enviado" : "Borrador"}</Badge>}
              <span>· {invited.length} arrendador(es) · {rfq.responses.length} cotización(es)</span>
            </CardDescription>
          </div>
          {!awarded && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => handleDownloadPdf()} disabled={!canManage}>
                <Download className="h-3.5 w-3.5 mr-1" /> Solicitud PDF
              </Button>
              <Button size="sm" variant="outline" onClick={openEmail} disabled={!canManage}>
                <Mail className="h-3.5 w-3.5 mr-1" /> Enviar por correo
              </Button>
              {rfq.status === "draft" && (
                <Button size="sm" variant="ghost" onClick={() => onSend(rfq.id)} disabled={!canManage}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Marcar enviado
                </Button>
              )}
              <Dialog open={respOpen} onOpenChange={setRespOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" disabled={!canManage}><Plus className="h-3.5 w-3.5 mr-1" /> Cotización</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Registrar cotización</DialogTitle>
                    <DialogDescription>Sube el PDF del arrendador y la IA precarga los precios por ítem, o complétalos a mano. Revisa antes de guardar.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    {/* Subir PDF → extraer con IA */}
                    <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 text-sm">
                        <Sparkles className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-muted-foreground">¿Tienes el PDF del proveedor? Súbelo y la IA llena los precios.</span>
                      </div>
                      <label className="shrink-0">
                        <input
                          type="file" accept="application/pdf" className="hidden" disabled={extracting}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleExtractPdf(f); e.target.value = ""; }}
                        />
                        <span className={`inline-flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm font-medium cursor-pointer hover:bg-muted ${extracting ? "opacity-60 pointer-events-none" : ""}`}>
                          {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                          {extracting ? "Analizando…" : "Subir PDF"}
                        </span>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <Label>Arrendador</Label>
                      <Select value={partyId} onValueChange={setPartyId}>
                        <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                        <SelectContent>
                          {invited.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {aiUsed && <p className="text-[11px] text-info-subtle-foreground flex items-center gap-1"><Sparkles className="h-3 w-3" /> Precargado por IA — verifica los montos.</p>}
                    </div>

                    {/* Tabla de líneas por ítem */}
                    <div className="space-y-1.5">
                      <Label>Precios por ítem ({CYCLE_LABELS[defaultCycle]})</Label>
                      <div className="rounded-xl border overflow-hidden">
                        <div className="grid grid-cols-[1fr_88px_56px_64px_92px] gap-2 px-3 py-2 bg-muted/50 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          <span>Equipo</span><span className="text-right">Precio</span><span className="text-right">Cant.</span><span className="text-right">Per.</span><span className="text-right">Total</span>
                        </div>
                        <div className="max-h-64 overflow-y-auto divide-y">
                          {rfq.items.map((it) => {
                            const r = lineRows[it.id] || { price: "", qty: String(it.quantity || 1), periods: "1" };
                            return (
                              <div key={it.id} className="grid grid-cols-[1fr_88px_56px_64px_92px] gap-2 px-3 py-2 items-center">
                                <span className="text-sm truncate" title={it.name}>{it.name}</span>
                                <Input type="number" min={0} step="any" className="h-8 text-right text-sm" placeholder="0" value={r.price} onChange={(e) => setCell(it.id, "price", e.target.value)} />
                                <Input type="number" min={1} step={1} className="h-8 text-right text-sm" value={r.qty} onChange={(e) => setCell(it.id, "qty", e.target.value)} />
                                <Input type="number" min={1} step={1} className="h-8 text-right text-sm" value={r.periods} onChange={(e) => setCell(it.id, "periods", e.target.value)} />
                                <span className="text-sm text-right tabular-nums text-muted-foreground">{money(lineTotalOf(r))}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/30 text-sm font-semibold">
                          <span>Total cotización</span><span className="tabular-nums">{money(grandTotal)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Disponibilidad desde (opcional)</Label>
                        <Input type="date" value={availability} onChange={(e) => setAvailability(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Condiciones (opcional)</Label>
                      <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Incluye traslado / operador / combustible..." rows={2} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { resetForm(); setRespOpen(false); }}>Cancelar</Button>
                    <Button onClick={handleSaveResponse} disabled={busy || extracting}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(rfq.id)} disabled={!canManage}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
          {awarded && rfq.rentalContractId && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={() => router.push(`/dashboard/rentals/contracts/${rfq.rentalContractId}`)}>
                <FileText className="h-3.5 w-3.5 mr-1" /> Emitir OC →
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Ítems del RFQ */}
        <div className="flex flex-wrap gap-2">
          {rfq.items.map((it) => (
            <Badge key={it.id} variant="outline" className="gap-1">
              <Truck className="h-3 w-3" /> {it.name} ×{it.quantity}
            </Badge>
          ))}
        </div>

        {/* Comparador por ítem (matriz equipo × proveedor) */}
        {rfq.responses.some((r) => r.lines?.length) && (
          <ItemMatrix rfq={rfq} responses={rfq.responses} />
        )}

        {/* Comparador */}
        {rfq.responses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cotizaciones aún.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Comparador (totales)</p>
            {[...rfq.responses]
              .sort((a, b) => (a.totalEstimate ?? a.pricePerPeriod) - (b.totalEstimate ?? b.pricePerPeriod))
              .map((r) => {
                const isBest = r.id === bestId;
                const isWinner = awarded && rfq.awardedQuoteId === r.id;
                return (
                  <div key={r.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${isWinner ? "border-success bg-success-subtle" : isBest ? "border-primary/40" : ""}`}>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{r.partyName}</span>
                        {isBest && !awarded && <Badge className="badge-success text-[9px]">Mejor precio</Badge>}
                        {isWinner && <Badge className="badge-success text-[9px]"><Trophy className="h-3 w-3 mr-0.5" /> Adjudicado</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {money(r.pricePerPeriod)} / {CYCLE_LABELS[r.billingCycle]} · {r.periods || 1} período(s)
                      </div>
                      {(() => {
                        const net = r.totalEstimate ?? r.pricePerPeriod * (r.periods || 1);
                        const iva = net * IVA_RATE;
                        return (
                          <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3">
                            <span>Neto {money(net)}</span>
                            <span>IVA {money(iva)}</span>
                            <span className="font-semibold text-foreground">Total {money(net + iva)}</span>
                          </div>
                        );
                      })()}
                      {r.conditions && <div className="text-[11px] text-muted-foreground italic">{r.conditions}</div>}
                    </div>
                    {!awarded && (
                      <Button size="sm" disabled={!canManage || busy} onClick={() => handleAward(r.id, r.periods)}>
                        <Trophy className="h-3.5 w-3.5 mr-1" /> Adjudicar
                      </Button>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </CardContent>

      {/* Dialog enviar solicitud de cotización por correo */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar solicitud de cotización</DialogTitle>
            <DialogDescription>Se adjunta el PDF de la solicitud {rfq.internalCode || ""} a los arrendadores.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Destinatarios (separados por coma)</Label>
              <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="arrendador@correo.cl, otro@correo.cl" />
              {invited.some((p) => !p.email) && (
                <p className="text-[11px] text-warning-subtle-foreground">
                  Algún arrendador invitado no tiene email cargado. Puedes escribirlo a mano o agregarlo en Arrendadores y Clientes.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Mensaje (opcional)</Label>
              <Textarea value={emailMsg} onChange={(e) => setEmailMsg(e.target.value)} rows={3} placeholder="Estimado proveedor, agradeceremos cotizar el siguiente arriendo…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancelar</Button>
            <Button onClick={handleSendEmail} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Mail className="mr-2 h-4 w-4" /> Enviar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
