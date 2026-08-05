"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

import {
  Package, ShoppingCart, RotateCcw, Clock, Plus, PackageCheck,
  ArrowUpRight, ArrowDownLeft, SearchX, KeyRound,
} from "lucide-react";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

import type { MaterialRequest, PurchaseRequest, ReturnRequest, RentalRequest, Material } from "@/modules/core/lib/data";
import { cn } from "@/lib/utils";
import { CompatibleMaterialRequest, requestItems, ReturnStatusBadge, ConditionBadge } from "@/components/pagnol-requests/request-shared";
import { resolveSupervisorStage } from "@/components/supervisor-requests/request-pipeline";
import { StageBadge } from "@/components/supervisor-requests/stage-badge";
import { resolvePurchaseStage, groupKey, PurchaseStage } from "@/components/supervisor-purchases/purchase-pipeline";
import { PurchaseStageBadge } from "@/components/supervisor-purchases/purchase-stage-badge";
import { computeReturnBalanceItems } from "@/components/supervisor-returns/return-balance";

// ====================== TIPOS ======================
type ActivityEntry =
  | { kind: "request"; time: Date; req: CompatibleMaterialRequest }
  | { kind: "purchase"; time: Date; items: PurchaseRequest[] }
  | { kind: "return"; time: Date; ret: ReturnRequest }
  | { kind: "rental"; time: Date; rental: RentalRequest };

type ActivityKind = ActivityEntry["kind"];

// Un pedido de compra multi-ítem no tiene un único estado real (cada ítem
// avanza por su cuenta) — se representa por el ítem MENOS avanzado del grupo,
// para no anunciar "Recibida" mientras falte llegar uno solo.
const PURCHASE_STAGE_PRIORITY: PurchaseStage[] = ["waiting_adc", "in_review", "approved", "ordered", "rejected", "received"];
function representativePurchaseStage(items: PurchaseRequest[]): PurchaseStage {
  const stages = items.map(resolvePurchaseStage);
  for (const s of PURCHASE_STAGE_PRIORITY) if (stages.includes(s)) return s;
  return stages[0];
}

const RENTAL_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "badge-warning" },
  quoting: { label: "En cotización", cls: "badge-info" },
  approved: { label: "Aprobado", cls: "badge-info" },
  fulfilled: { label: "Arriendo creado", cls: "badge-success" },
  rejected: { label: "Rechazado", cls: "bg-destructive/10 text-destructive border-destructive/30" },
};

// Mapa estático de acento por tipo de actividad (tokens semánticos, dark-mode safe).
const TYPE_ACCENT: Record<ActivityKind, { iconBg: string; icon: string; icon_cmp: React.ElementType; label: string; href: string }> = {
  request: { iconBg: "bg-primary/10", icon: "text-primary", icon_cmp: Package, label: "Pañol", href: "/dashboard/supervisor/request" },
  purchase: { iconBg: "bg-info-subtle", icon: "text-info-subtle-foreground", icon_cmp: ShoppingCart, label: "Compra", href: "/dashboard/purchasing/purchase-request-form" },
  return: { iconBg: "bg-success-subtle", icon: "text-success-subtle-foreground", icon_cmp: RotateCcw, label: "Devolución", href: "/dashboard/supervisor/return-request" },
  rental: { iconBg: "bg-warning-subtle", icon: "text-warning-subtle-foreground", icon_cmp: KeyRound, label: "Arriendo", href: "/dashboard/purchasing/purchase-request-form?tipo=arriendo" },
};

const FEED_FILTERS: { key: "all" | ActivityKind; label: string }[] = [
  { key: "all", label: "Todo" },
  { key: "request", label: "Pañol" },
  { key: "purchase", label: "Compras" },
  { key: "rental", label: "Arriendos" },
  { key: "return", label: "Devol." },
];

export default function SupervisorHubPage() {
  const { requests, purchaseRequests, returnRequests, rentalRequests, materials } = useAppState();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<"all" | ActivityKind>("all");

  const toDate = (d: any): Date => new Date(d);

  const getGreeting = () => {
    const h = new Date().getHours();
    return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  };

  const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);

  const myMaterialRequests = useMemo(
    () => ((requests || []) as CompatibleMaterialRequest[]).filter((r) => r.supervisorId === user?.id),
    [requests, user]
  );
  const myPurchaseRequests = useMemo(
    () => ((purchaseRequests || []) as PurchaseRequest[]).filter((r) => r.supervisorId === user?.id),
    [purchaseRequests, user]
  );
  const myReturnRequests = useMemo(
    () => ((returnRequests || []) as ReturnRequest[]).filter((r) => r.supervisorId === user?.id),
    [returnRequests, user]
  );
  const myRentalRequests = useMemo(
    () => ((rentalRequests || []) as RentalRequest[]).filter((r) => r.supervisorId === user?.id),
    [rentalRequests, user]
  );

  // Saldo REAL de devolución (mismo cálculo de supervisor/return-request):
  // cuántos (material, contrato) tienen tomado > devuelto. Reemplaza al viejo
  // "Devoluciones: N" que contaba la cola del pañolero (nada accionable para
  // el supervisor) por lo que sí lo es: qué le falta devolver a ÉL.
  const returnBalanceItems = useMemo(
    () => (user ? computeReturnBalanceItems(user.id, requests, returnRequests, materialMap) : []),
    [user, requests, returnRequests, materialMap]
  );

  // ================= KPIs (honestos y clickeables — cada uno navega a su página) =================
  const kpis = useMemo(() => {
    let materialInProgress = 0;
    let materialReady = 0;
    myMaterialRequests.forEach((r) => {
      const stage = resolveSupervisorStage(r);
      if (stage === "waiting_adc" || stage === "queued") materialInProgress++;
      else if (stage === "ready_pickup") materialReady++;
    });

    let purchaseInProgress = 0;
    myPurchaseRequests.forEach((r) => {
      const stage = resolvePurchaseStage(r);
      if (stage === "waiting_adc" || stage === "in_review") purchaseInProgress++;
    });

    const rentalsActive = myRentalRequests.filter((r) => r.status === "pending" || r.status === "quoting").length;

    return { materialInProgress, materialReady, purchaseInProgress, rentalsActive, returnPending: returnBalanceItems.length };
  }, [myMaterialRequests, myPurchaseRequests, myRentalRequests, returnBalanceItems]);

  const KPI_ITEMS = [
    { label: "Pañol en trámite", value: kpis.materialInProgress, icon: Clock, iconCls: "bg-info-subtle text-info", href: "/dashboard/supervisor/request" },
    { label: "Listas para retiro", value: kpis.materialReady, icon: PackageCheck, iconCls: kpis.materialReady > 0 ? "bg-success-subtle text-success-subtle-foreground" : "bg-muted text-muted-foreground", href: "/dashboard/supervisor/request" },
    { label: "Compras en trámite", value: kpis.purchaseInProgress, icon: ShoppingCart, iconCls: "bg-info-subtle text-info", href: "/dashboard/purchasing/purchase-request-form" },
    { label: "Por devolver", value: kpis.returnPending, icon: RotateCcw, iconCls: kpis.returnPending > 0 ? "bg-warning-subtle text-warning" : "bg-muted text-muted-foreground", href: "/dashboard/supervisor/return-request" },
    { label: "Arriendos en curso", value: kpis.rentalsActive, icon: KeyRound, iconCls: "bg-primary/10 text-primary", href: "/dashboard/rentals/contracts" },
  ];

  // ================= ACTIVIDAD UNIFICADA (con la etapa REAL de cada tipo) =================
  const allActivity = useMemo<ActivityEntry[]>(() => {
    if (!user) return [];
    const list: ActivityEntry[] = [];

    myMaterialRequests.forEach((r) => list.push({ kind: "request", time: toDate(r.createdAt), req: r }));

    // Un mismo carrito de compra (batchId) es UN pedido, no N filas sueltas.
    const purchaseGroups = new Map<string, PurchaseRequest[]>();
    myPurchaseRequests.forEach((r) => {
      const key = groupKey(r);
      const arr = purchaseGroups.get(key) || [];
      arr.push(r);
      purchaseGroups.set(key, arr);
    });
    purchaseGroups.forEach((items) => {
      const time = new Date(Math.max(...items.map((i) => new Date(i.createdAt as any).getTime())));
      list.push({ kind: "purchase", time, items });
    });

    myReturnRequests.forEach((r) => list.push({ kind: "return", time: toDate(r.createdAt), ret: r }));
    myRentalRequests.forEach((r) => list.push({ kind: "rental", time: toDate(r.createdAt), rental: r }));

    return list.sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [myMaterialRequests, myPurchaseRequests, myReturnRequests, myRentalRequests, user]);

  const filteredActivity = useMemo(() => {
    const list = activeTab === "all" ? allActivity : allActivity.filter((a) => a.kind === activeTab);
    return list.slice(0, 25);
  }, [activeTab, allActivity]);

  const requestTitle = (req: CompatibleMaterialRequest) => {
    const items = requestItems(req);
    if (items.length === 1) {
      const mat = materialMap.get(items[0].materialId);
      return mat ? mat.name : "Solicitud de material";
    }
    return items.length > 0 ? `${items.length} ítems solicitados` : "Solicitud de material";
  };

  return (
    <PageShell
      title={`${getGreeting()}, ${user?.name.split(" ")[0] ?? "Supervisor"}`}
      description="Panel de control operativo del supervisor."
      className="pb-12"
    >
      {/* KPIs — cada uno navega directo a la página donde se resuelve */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {KPI_ITEMS.map((k) => (
          <Link key={k.label} href={k.href} className="block h-full">
            <Card className="p-5 rounded-[1.5rem] border-none shadow-sm hover:shadow-lg transition-all h-full">
              <div className={cn("p-2.5 rounded-xl w-fit shadow-sm mb-4", k.iconCls)}>
                <k.icon size={16} />
              </div>
              <p className="text-2xl font-black font-outfit text-foreground">{k.value}</p>
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mt-1">{k.label}</p>
            </Card>
          </Link>
        ))}
      </div>

      {/* ACCIONES RÁPIDAS */}
      <div className="mt-8">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Acciones rápidas</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <QuickAction href="/dashboard/supervisor/request" icon={Package} title="Solicitar al Pañol" desc="Material disponible" accent="primary" arrow={ArrowUpRight} />
          <QuickAction href="/dashboard/purchasing/purchase-request-form" icon={ShoppingCart} title="Solicitar Compra" desc="Material sin stock" accent="info" arrow={ArrowUpRight} />
          <QuickAction href="/dashboard/purchasing/purchase-request-form?tipo=arriendo" icon={KeyRound} title="Solicitar Arriendo" desc="Equipos de terceros" accent="warning" arrow={ArrowUpRight} />
          <QuickAction href="/dashboard/supervisor/return-request" icon={RotateCcw} title="Devolver Material" desc="Retornar sobrantes" accent="success" arrow={ArrowDownLeft} />
        </div>
      </div>

      {/* HISTORIAL */}
      <Card className="rounded-[2rem] shadow-sm border mt-8 p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight">Historial de Actividad</h3>
            <p className="text-xs text-muted-foreground font-medium mt-1">Tus solicitudes, compras, arriendos y devoluciones recientes.</p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-muted/50 border rounded-xl p-1 w-fit max-w-full overflow-x-auto no-scrollbar mb-6">
          {FEED_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                activeTab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {filteredActivity.length > 0 ? (
          <div className="space-y-3">
            {filteredActivity.map((act) => (
              <ActivityRow key={activityKey(act)} entry={act} materialMap={materialMap} requestTitle={requestTitle} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<SearchX size={24} />}
            title="Sin movimientos"
            description="No hay movimientos en esta categoría todavía."
          />
        )}
      </Card>

      {/* BOTÓN FLOTANTE */}
      <Link href="/dashboard/supervisor/request">
        <Button className="fixed bottom-6 right-6 rounded-full shadow-xl h-14 w-14 p-0 md:hidden z-50">
          <Plus className="h-7 w-7" />
        </Button>
      </Link>
    </PageShell>
  );
}

function activityKey(a: ActivityEntry): string {
  if (a.kind === "request") return `req-${a.req.id}`;
  if (a.kind === "purchase") return `pur-${groupKey(a.items[0])}`;
  if (a.kind === "return") return `ret-${a.ret.id}`;
  return `rent-${a.rental.id}`;
}

// ============ FILA DE ACTIVIDAD (etapa real por tipo, clickeable) ============
function ActivityRow({ entry, materialMap, requestTitle }: {
  entry: ActivityEntry;
  materialMap: Map<string, Material>;
  requestTitle: (req: CompatibleMaterialRequest) => string;
}) {
  const accent = TYPE_ACCENT[entry.kind];
  const Icon = accent.icon_cmp;

  let title = "";
  let subtitle = "";
  let time: Date;
  let badge: React.ReactNode;

  if (entry.kind === "request") {
    title = requestTitle(entry.req);
    subtitle = entry.req.contractName || entry.req.area || "Faena";
    time = entry.time;
    badge = <StageBadge stage={resolveSupervisorStage(entry.req)} />;
  } else if (entry.kind === "purchase") {
    const first = entry.items[0];
    title = entry.items.length === 1 ? first.materialName : `Pedido de compra (${entry.items.length} ítems)`;
    subtitle = first.contractName || "—";
    time = entry.time;
    badge = <PurchaseStageBadge stage={representativePurchaseStage(entry.items)} />;
  } else if (entry.kind === "return") {
    title = `Devolución: ${entry.ret.materialName}`;
    subtitle = `${entry.ret.quantity} ${entry.ret.unit} · ${entry.ret.contractName || "Pool central"}`;
    time = entry.time;
    badge = (
      <div className="flex flex-col items-end gap-1.5">
        <ReturnStatusBadge status={entry.ret.status} />
        <ConditionBadge condition={entry.ret.returnCondition} />
      </div>
    );
  } else {
    const rental = entry.rental;
    const meta = RENTAL_STATUS_META[rental.status] || { label: rental.status, cls: "bg-muted text-muted-foreground" };
    title = `Arriendo: ${rental.equipmentName}${rental.items?.length > 1 ? ` (+${rental.items.length - 1} más)` : ""}`;
    subtitle = `${rental.contractName || "Faena"} · ×${rental.quantity}`;
    time = entry.time;
    badge = <Badge className={cn("border-none text-[9px] font-black uppercase tracking-widest", meta.cls)}>{meta.label}</Badge>;
  }

  return (
    <Link href={accent.href} className="block">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-[1.25rem] bg-card border hover:shadow-lg hover:border-primary/20 transition-all">
        <div className="flex gap-4 min-w-0">
          <div className={cn("p-2.5 rounded-2xl shrink-0", accent.iconBg)}>
            <Icon className={cn("h-5 w-5", accent.icon)} />
          </div>
          <div className="min-w-0">
            <div className="flex gap-2 items-center flex-wrap">
              <span className="font-bold text-sm truncate">{title}</span>
              <Badge variant="outline" className="text-[9px] h-5 px-1.5 text-muted-foreground font-black uppercase tracking-widest shrink-0">{accent.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground font-medium truncate">
              {subtitle} · <span className="capitalize">{formatDistanceToNow(time, { addSuffix: true, locale: es })}</span>
            </p>
          </div>
        </div>
        <div className="shrink-0">{badge}</div>
      </div>
    </Link>
  );
}

// ============ ACCIÓN RÁPIDA (tokenizada) ============
const QUICK_ACTION_ACCENT: Record<string, { hover: string; bg: string; text: string; arrow: string }> = {
  primary: { hover: "hover:border-primary/50 hover:bg-primary/5", bg: "bg-primary/10", text: "text-primary", arrow: "text-primary/40" },
  info: { hover: "hover:border-info/50 hover:bg-info-subtle", bg: "bg-info-subtle", text: "text-info-subtle-foreground", arrow: "text-info/40" },
  warning: { hover: "hover:border-warning/50 hover:bg-warning-subtle", bg: "bg-warning-subtle", text: "text-warning-subtle-foreground", arrow: "text-warning/40" },
  success: { hover: "hover:border-success/50 hover:bg-success-subtle", bg: "bg-success-subtle", text: "text-success-subtle-foreground", arrow: "text-success/40" },
};

function QuickAction({ href, icon: Icon, title, desc, accent, arrow: Arrow }: { href: string; icon: React.ElementType; title: string; desc: string; accent: string; arrow: React.ElementType }) {
  const c = QUICK_ACTION_ACCENT[accent] ?? QUICK_ACTION_ACCENT.primary;
  return (
    <Link href={href} className="block h-full">
      <Card className={cn("h-full group cursor-pointer border-2 rounded-[1.5rem] transition-all duration-300", c.hover)}>
        <CardHeader className="flex flex-row items-center gap-4 pb-2">
          <div className={cn("p-3 rounded-2xl transition-transform group-hover:scale-110", c.bg)}>
            <Icon className={cn("h-6 w-6", c.text)} />
          </div>
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-0 relative">
          <Arrow className={cn("absolute right-4 bottom-4 h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100", c.arrow)} />
        </CardContent>
      </Card>
    </Link>
  );
}
