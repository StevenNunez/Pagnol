"use client";

import React, { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { QuoteRequest, QuoteResponse } from "@/modules/core/lib/data";
import { ListChecks, Award, TrendingDown, Truck, ShieldCheck, CalendarClock, Trophy, CheckCircle2, Paperclip } from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fmtDate = (iso?: string | Date) =>
    iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

export default function ComparadorPage() {
    return (
        <Suspense fallback={<PageShell title="Comparador de Cotizaciones"><LoadingState /></PageShell>}>
            <ComparadorInner />
        </Suspense>
    );
}

function ComparadorInner() {
    const params = useSearchParams();
    const router = useRouter();
    const { quoteRequests } = useAppState();
    const [picked, setPicked] = useState<string>(params.get("rfq") || "");

    // RFQs con al menos una cotización (las que tiene sentido comparar).
    const comparable = useMemo(
        () => (quoteRequests || []).filter((r) => r.responses.length > 0),
        [quoteRequests],
    );

    const rfq = useMemo(
        () => (quoteRequests || []).find((r) => r.id === picked) ?? null,
        [quoteRequests, picked],
    );

    return (
        <PageShell
            title="Comparador de Cotizaciones"
            description="Compara ofertas lado a lado, identifica la más conveniente y adjudica para generar la Orden de Compra."
            toolbar={
                <div className="w-full xl:w-96">
                    <Select value={picked} onValueChange={(v) => { setPicked(v); router.replace(`/dashboard/abastecimiento/comparador?rfq=${v}`); }}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecciona una RFQ para comparar…" /></SelectTrigger>
                        <SelectContent>
                            {comparable.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-muted-foreground">No hay RFQ con cotizaciones.</div>
                            ) : comparable.map((r) => (
                                <SelectItem key={r.id} value={r.id}>{r.internalCode} — {r.title} ({r.responses.length})</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            }
        >
            {!rfq ? (
                <EmptyState
                    icon={<ListChecks size={24} />}
                    title="Elige una RFQ"
                    description="Selecciona arriba una cotización con ofertas para comparar las propuestas de los proveedores."
                />
            ) : rfq.responses.length === 0 ? (
                <EmptyState icon={<ListChecks size={24} />} title="Sin ofertas" description="Esta RFQ aún no tiene cotizaciones registradas." />
            ) : (
                <Comparison rfq={rfq} />
            )}
        </PageShell>
    );
}

function Comparison({ rfq }: { rfq: QuoteRequest }) {
    const router = useRouter();
    const { awardQuote, can } = useAppState();
    const { toast } = useToast();
    const [awardingId, setAwardingId] = useState<string | null>(null);

    const responses = rfq.responses;
    const prices = responses.map((r) => r.totalPrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const minDelivery = Math.min(...responses.map((r) => r.deliveryDays));

    // Score compuesto: 70% precio + 30% plazo (menor es mejor → invertimos).
    const scored = useMemo(() => {
        const maxDelivery = Math.max(...responses.map((r) => r.deliveryDays));
        return responses.map((r) => {
            const priceScore = maxPrice === minPrice ? 1 : (maxPrice - r.totalPrice) / (maxPrice - minPrice);
            const delivScore = maxDelivery === minDelivery ? 1 : (maxDelivery - r.deliveryDays) / (maxDelivery - minDelivery);
            return { id: r.id, score: priceScore * 0.7 + delivScore * 0.3 };
        });
    }, [responses, minPrice, maxPrice, minDelivery]);

    const bestScoreId = useMemo(
        () => scored.slice().sort((a, b) => b.score - a.score)[0]?.id,
        [scored],
    );
    const scoreOf = (id: string) => scored.find((s) => s.id === id)?.score ?? 0;

    const isAwarded = rfq.status === "awarded";
    const canAward = can("finance:manage_purchase_orders") && !isAwarded;

    const doAward = async (resp: QuoteResponse) => {
        setAwardingId(resp.id);
        try {
            await awardQuote(rfq.id, resp.id);
            toast({ title: "RFQ adjudicada", description: `Se generó la Orden de Compra con ${resp.supplierName}.` });
            router.push(`/dashboard/abastecimiento/ordenes`);
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error al adjudicar", description: e?.message || "No se pudo adjudicar." });
        } finally {
            setAwardingId(null);
        }
    };

    const allDetailed = responses.every((r) => r.itemPrices && r.itemPrices.length === rfq.items.length);

    return (
        <div className="space-y-6">
            {/* KPIs de ahorro */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card className="rounded-[1.5rem]"><CardContent className="p-5"><MicroLabel>Mejor precio</MicroLabel><p className="text-2xl font-black mt-1 text-success">{CLP.format(minPrice)}</p></CardContent></Card>
                <Card className="rounded-[1.5rem]"><CardContent className="p-5"><MicroLabel>Oferta más alta</MicroLabel><p className="text-2xl font-black mt-1">{CLP.format(maxPrice)}</p></CardContent></Card>
                <Card className="rounded-[1.5rem]"><CardContent className="p-5"><MicroLabel>Ahorro potencial</MicroLabel><p className="text-2xl font-black mt-1 text-success flex items-center gap-1"><TrendingDown className="h-5 w-5" /> {CLP.format(maxPrice - minPrice)}</p></CardContent></Card>
                <Card className="rounded-[1.5rem]"><CardContent className="p-5"><MicroLabel>Promedio ofertas</MicroLabel><p className="text-2xl font-black mt-1">{CLP.format(Math.round(avgPrice))}</p></CardContent></Card>
            </div>

            {isAwarded && (
                <Card className="rounded-[1.5rem] border-success/40 bg-success-subtle">
                    <CardContent className="p-4 flex items-center gap-2 text-success-subtle-foreground">
                        <CheckCircle2 className="h-5 w-5" />
                        <p className="text-sm font-semibold">RFQ adjudicada — la Orden de Compra ya fue generada.</p>
                    </CardContent>
                </Card>
            )}

            {/* Comparación lado a lado */}
            <div className="overflow-x-auto no-scrollbar">
                <div className="flex gap-4 min-w-min pb-2">
                    {responses.map((r) => {
                        const isCheapest = r.totalPrice === minPrice;
                        const isFastest = r.deliveryDays === minDelivery;
                        const isBest = r.id === bestScoreId;
                        const isThisAwarded = rfq.awardedQuoteId === r.id;
                        const savingVsAvg = avgPrice - r.totalPrice;
                        return (
                            <Card
                                key={r.id}
                                className={cn(
                                    "rounded-[1.5rem] w-72 shrink-0 flex flex-col",
                                    isBest && !isAwarded && "ring-2 ring-primary",
                                    isThisAwarded && "ring-2 ring-success",
                                )}
                            >
                                <CardContent className="p-5 space-y-4 flex-1 flex flex-col">
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="font-bold text-foreground truncate">{r.supplierName}</p>
                                            {isBest && !isAwarded && <Badge className="badge-info rounded-xl text-[10px] shrink-0"><Trophy className="h-3 w-3 mr-1" /> Mejor</Badge>}
                                            {isThisAwarded && <Badge className="badge-success rounded-xl text-[10px] shrink-0"><Award className="h-3 w-3 mr-1" /> Adjudicado</Badge>}
                                        </div>
                                        <p className="text-xs text-muted-foreground">Puntaje: {(scoreOf(r.id) * 100).toFixed(0)}/100</p>
                                    </div>

                                    <div>
                                        <p className={cn("text-3xl font-black tracking-tight", isCheapest ? "text-success" : "text-foreground")}>{CLP.format(r.totalPrice)}</p>
                                        {savingVsAvg > 0 && <p className="text-xs text-success">{CLP.format(savingVsAvg)} bajo el promedio</p>}
                                    </div>

                                    <div className="space-y-2.5 text-sm flex-1">
                                        <Row icon={<Truck className="h-4 w-4" />} label="Entrega" highlight={isFastest}>{r.deliveryDays} días</Row>
                                        <Row icon={<ShieldCheck className="h-4 w-4" />} label="Garantía">{r.warranty || "—"}</Row>
                                        <Row icon={<CalendarClock className="h-4 w-4" />} label="Validez">{fmtDate(r.validityDate)}</Row>
                                        <div className="pt-1">
                                            <MicroLabel>Condiciones</MicroLabel>
                                            <p className="text-sm text-foreground/90 mt-0.5">{r.commercialConditions || "—"}</p>
                                        </div>
                                        {r.attachmentUrl && (
                                            <a href={r.attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 hover:underline">
                                                <Paperclip className="h-3 w-3" /> {r.attachmentName || "Ver adjunto"}
                                            </a>
                                        )}
                                    </div>

                                    {canAward && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button className="rounded-xl w-full" disabled={!!awardingId}>
                                                    <Award className="h-4 w-4 mr-2" /> Adjudicar
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>¿Adjudicar a {r.supplierName}?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Se generará una Orden de Compra por {CLP.format(r.totalPrice)} y las solicitudes incluidas pasarán a "ordenadas". Esta acción cierra la RFQ.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => doAward(r)}>Sí, adjudicar y generar OC</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {/* Detalle por ítem (si todas las ofertas lo tienen) */}
            {allDetailed && (
                <Card className="rounded-[1.5rem]">
                    <CardContent className="p-5 space-y-3">
                        <MicroLabel>Comparación por ítem (precio unitario)</MicroLabel>
                        <div className="overflow-x-auto no-scrollbar">
                            <table className="w-full text-sm min-w-[600px]">
                                <thead>
                                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b">
                                        <th className="py-2 pr-4">Ítem</th>
                                        {responses.map((r) => <th key={r.id} className="py-2 px-3 text-right">{r.supplierName}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rfq.items.map((it) => {
                                        const unitVals = responses.map((r) => r.itemPrices?.find((ip) => ip.itemId === it.id)?.unitPrice ?? 0);
                                        const minUnit = Math.min(...unitVals.filter((v) => v > 0));
                                        return (
                                            <tr key={it.id} className="border-b last:border-0">
                                                <td className="py-2 pr-4">
                                                    <p className="font-medium">{it.name}</p>
                                                    <p className="text-xs text-muted-foreground">{it.quantity} {it.unit}</p>
                                                </td>
                                                {responses.map((r, i) => (
                                                    <td key={r.id} className={cn("py-2 px-3 text-right", unitVals[i] === minUnit && unitVals[i] > 0 && "text-success font-bold")}>
                                                        {unitVals[i] > 0 ? CLP.format(unitVals[i]) : "—"}
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function Row({ icon, label, children, highlight }: { icon: React.ReactNode; label: string; children: React.ReactNode; highlight?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground"><span className="text-muted-foreground/70">{icon}</span>{label}</span>
            <span className={cn("font-medium", highlight && "text-success font-bold")}>{children}</span>
        </div>
    );
}
