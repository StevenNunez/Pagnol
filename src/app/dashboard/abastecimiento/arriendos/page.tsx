"use client";

import React, { useState, useMemo } from "react";
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
  Clock, Building2, Truck, AlertCircle,
} from "lucide-react";
import type {
  RentalRequest, RentalQuoteRequest, RentalParty,
  RentalBillingCycle, RentalQuoteItem, RentalQuoteResponse,
} from "@/modules/core/lib/data";
import { rentalCategoryLabel } from "@/modules/core/lib/data";

const CYCLE_LABELS: Record<RentalBillingCycle, string> = {
  daily: "Diario", weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual", one_time: "Pago único",
};
const fmt = (d: any) => d ? new Date(d).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const money = (n: number) => "$" + (Number(n) || 0).toLocaleString("es-CL");

export default function AbastecimientoArriendosPage() {
  const {
    rentalRequests, rentalQuoteRequests, rentalParties,
    updateRentalRequestStatus, deleteRentalRequest,
    addRentalQuoteRequest, recordRentalQuoteResponse, awardRentalQuote, deleteRentalQuoteRequest, sendRentalQuoteRequest,
    can,
  } = useAppState();
  const { user } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const canManage = can("rentals:manage_quotes");

  const requests = (rentalRequests || []) as RentalRequest[];
  const rfqs = (rentalQuoteRequests || []) as RentalQuoteRequest[];
  const lessors = useMemo(
    () => ((rentalParties || []) as RentalParty[]).filter((p) => p.partyType === "lessor"),
    [rentalParties]
  );
  const partyMap = useMemo(() => new Map(lessors.map((p) => [p.id, p])), [lessors]);

  const pendingRequests = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const quotingRequests = useMemo(() => requests.filter((r) => r.status === "quoting"), [requests]);
  const closedRequests = useMemo(() => requests.filter((r) => ["approved", "fulfilled", "rejected"].includes(r.status)), [requests]);

  // ── Crear RFQ ────────────────────────────────────────────────────────────────
  const [selectedReqs, setSelectedReqs] = useState<Set<string>>(new Set());
  const [rfqDialogOpen, setRfqDialogOpen] = useState(false);
  const [rfqTitle, setRfqTitle] = useState("");
  const [rfqDeadline, setRfqDeadline] = useState("");
  const [rfqParties, setRfqParties] = useState<Set<string>>(new Set());

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
      toast({ title: "RFQ creado", description: "Se invitó a los arrendadores a cotizar." });
      setSelectedReqs(new Set());
      setRfqDialogOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo crear el RFQ." });
    } finally { setBusy(null); }
  };

  const handleRequestStatus = async (id: string, status: "approved" | "rejected") => {
    setBusy(id);
    try {
      await updateRentalRequestStatus(id, status, status === "rejected" ? "Rechazada por Abastecimiento" : undefined);
      toast({ title: status === "approved" ? "Solicitud aprobada" : "Solicitud rechazada" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo actualizar." });
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
          <TabsTrigger value="rfq">Cotizaciones / RFQ ({rfqs.filter((r) => r.status !== "awarded").length})</TabsTrigger>
          <TabsTrigger value="historial">Historial ({closedRequests.length})</TabsTrigger>
        </TabsList>

        {/* ── SOLICITUDES ───────────────────────────────────────────────────── */}
        <TabsContent value="solicitudes" className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-muted-foreground">
              Marca las solicitudes pendientes y crea un RFQ para cotizarlas a arrendadores.
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
                      <span><b>Obra:</b> {req.contractName || "—"}</span>
                      <span><b>Solicita:</b> {req.supervisorName}</span>
                    </div>
                    {req.justification && <div className="text-xs text-muted-foreground italic">"{req.justification}"</div>}
                    {req.status === "pending" && (
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" className="badge-success" disabled={!canManage || busy === req.id}
                          onClick={() => handleRequestStatus(req.id, "approved")}>
                          <Check className="h-3.5 w-3.5 mr-1" /> Aprobar
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive" disabled={!canManage || busy === req.id}
                          onClick={() => handleRequestStatus(req.id, "rejected")}>
                          <X className="h-3.5 w-3.5 mr-1" /> Rechazar
                        </Button>
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
            <DialogTitle>Crear cotización (RFQ)</DialogTitle>
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
              {lessors.length === 0 ? (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-warning/30 bg-warning-subtle text-warning-subtle-foreground text-xs">
                  <AlertCircle className="h-4 w-4" /> No hay arrendadores. Créalos en Arriendos → Arrendadores y Clientes.
                </div>
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
              {busy === "rfq" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-2 h-4 w-4" /> Crear RFQ</>}
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

// ── Tarjeta de un RFQ con respuestas + comparador + adjudicar ─────────────────
function RfqCard({
  rfq, lessors, partyMap, canManage, onRecordResponse, onAward, onSend, onDelete,
}: {
  rfq: RentalQuoteRequest;
  lessors: RentalParty[];
  partyMap: Map<string, RentalParty>;
  canManage: boolean;
  onRecordResponse: (id: string, r: Omit<RentalQuoteResponse, "id" | "createdAt"> & { id?: string }) => Promise<void>;
  onAward: (id: string, responseId: string, opts?: { currency?: string; paymentDay?: number | null; periods?: number }) => Promise<{ rentalContractId: string }>;
  onSend: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [respOpen, setRespOpen] = useState(false);

  const invited = useMemo(() => rfq.partyIds.map((id) => partyMap.get(id)).filter(Boolean) as RentalParty[], [rfq.partyIds, partyMap]);
  const bestId = useMemo(() => {
    if (!rfq.responses.length) return null;
    return [...rfq.responses].sort((a, b) =>
      (a.totalEstimate ?? a.pricePerPeriod) - (b.totalEstimate ?? b.pricePerPeriod))[0].id;
  }, [rfq.responses]);

  // Form respuesta
  const [partyId, setPartyId] = useState("");
  const [pricePerPeriod, setPricePerPeriod] = useState<number | string>("");
  const [periods, setPeriods] = useState<number | string>(1);
  const [availability, setAvailability] = useState("");
  const [conditions, setConditions] = useState("");
  const defaultCycle = rfq.items[0]?.billingCycle || "monthly";

  const handleSaveResponse = async () => {
    if (!partyId || !pricePerPeriod) {
      toast({ variant: "destructive", title: "Datos incompletos", description: "Elige el arrendador y el precio por período." });
      return;
    }
    setBusy(true);
    try {
      const price = Number(pricePerPeriod);
      const n = Number(periods) || 1;
      await onRecordResponse(rfq.id, {
        partyId, partyName: partyMap.get(partyId)?.name || "Arrendador",
        pricePerPeriod: price, billingCycle: defaultCycle, periods: n,
        totalEstimate: price * n, availabilityDate: availability || undefined,
        conditions: conditions || undefined,
      });
      toast({ title: "Cotización registrada" });
      setPartyId(""); setPricePerPeriod(""); setPeriods(1); setAvailability(""); setConditions("");
      setRespOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo registrar la cotización." });
    } finally { setBusy(false); }
  };

  const handleAward = async (responseId: string, periodsForAward?: number) => {
    setBusy(true);
    try {
      const res = await onAward(rfq.id, responseId, { periods: periodsForAward });
      toast({ title: "¡Arriendo adjudicado!", description: `Contrato de arriendo generado (${res.rentalContractId.slice(0, 8)}). Revisa el módulo Arriendos.` });
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
            <div className="flex gap-2">
              {rfq.status === "draft" && (
                <Button size="sm" variant="outline" onClick={() => onSend(rfq.id)} disabled={!canManage}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Marcar enviado
                </Button>
              )}
              <Dialog open={respOpen} onOpenChange={setRespOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" disabled={!canManage}><Plus className="h-3.5 w-3.5 mr-1" /> Cotización</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Registrar cotización</DialogTitle>
                    <DialogDescription>Ingresa la oferta de un arrendador para {rfq.title}.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Arrendador</Label>
                      <Select value={partyId} onValueChange={setPartyId}>
                        <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                        <SelectContent>
                          {invited.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Precio por período ({CYCLE_LABELS[defaultCycle]})</Label>
                        <Input type="number" value={pricePerPeriod} onChange={(e) => setPricePerPeriod(e.target.value)} placeholder="0" />
                      </div>
                      <div className="space-y-2">
                        <Label>N° de períodos</Label>
                        <Input type="number" min={1} value={periods} onChange={(e) => setPeriods(e.target.value)} />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Total estimado: <b>{money((Number(pricePerPeriod) || 0) * (Number(periods) || 1))}</b>
                    </div>
                    <div className="space-y-2">
                      <Label>Disponibilidad desde (opcional)</Label>
                      <Input type="date" value={availability} onChange={(e) => setAvailability(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Condiciones (opcional)</Label>
                      <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Incluye traslado / operador / combustible..." rows={2} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setRespOpen(false)}>Cancelar</Button>
                    <Button onClick={handleSaveResponse} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(rfq.id)} disabled={!canManage}>
                <Trash2 className="h-4 w-4" />
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

        {/* Comparador */}
        {rfq.responses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cotizaciones aún.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Comparador</p>
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
                        {money(r.pricePerPeriod)} / {CYCLE_LABELS[r.billingCycle]} · {r.periods || 1} período(s) · <b>Total {money(r.totalEstimate ?? r.pricePerPeriod)}</b>
                      </div>
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
    </Card>
  );
}
