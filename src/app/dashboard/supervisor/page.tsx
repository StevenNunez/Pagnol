"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  Package,
  ShoppingCart,
  RotateCcw,
  Clock,
  AlertTriangle,
  Plus,
  PackageCheck,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  FileText,
  SearchX,
  KeyRound,
} from "lucide-react";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

import type {
  MaterialRequest,
  PurchaseRequest,
  ReturnRequest,
  RentalRequest,
  Material,
} from "@/modules/core/lib/data";
import { cn } from "@/lib/utils";

// ====================== TIPOS ======================
type ActivityItem = {
  id: string;
  originalId: string;
  type: "request" | "purchase" | "return" | "rental";
  title: string;
  subtitle: string;
  time: Date;
  status: string;
  delivered?: boolean;
};

// Mapas estáticos de acento (tokens semánticos → dark-mode safe; nunca clases dinámicas).
const ACCENT: Record<string, { border: string; iconBg: string; icon: string }> = {
  warning: { border: "border-l-warning", iconBg: "bg-warning-subtle", icon: "text-warning-subtle-foreground" },
  info: { border: "border-l-info", iconBg: "bg-info-subtle", icon: "text-info-subtle-foreground" },
  primary: { border: "border-l-primary", iconBg: "bg-primary/10", icon: "text-primary" },
  success: { border: "border-l-success", iconBg: "bg-success-subtle", icon: "text-success-subtle-foreground" },
  destructive: { border: "border-l-destructive", iconBg: "bg-destructive/10", icon: "text-destructive" },
};

export default function SupervisorHubPage() {
  const { requests, purchaseRequests, returnRequests, rentalRequests, materials } = useAppState();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState("all");

  const toDate = (d: any): Date => new Date(d);

  const getGreeting = () => {
    const h = new Date().getHours();
    return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  };

  const smartItemName = (items: any[], materials: Material[]) => {
    if (!items || items.length !== 1) return null;
    const mat = materials.find((m) => m.id === items[0].materialId);
    return mat?.name || null;
  };

  // ================= MÉTRICAS =================
  const metrics = useMemo(() => {
    if (!user) return { pending: 0, delivery: 0, returns: 0, rentals: 0, lowStock: 0 };

    const reqs = (requests || []) as MaterialRequest[];
    const pr = (purchaseRequests || []) as PurchaseRequest[];
    const ret = (returnRequests || []) as ReturnRequest[];
    const rr = (rentalRequests || []) as RentalRequest[];
    const mats = (materials || []) as Material[];

    const pending =
      reqs.filter((r) => r.supervisorId === user.id && r.status === "pending").length +
      pr.filter((r) => r.supervisorId === user.id && r.status === "pending").length;

    const delivery = reqs.filter(
      (r) => r.supervisorId === user.id && r.status === "approved" && !r.deliveryDate
    ).length;

    const returns = ret.filter((r) => r.supervisorId === user.id && r.status === "pending").length;

    const rentals = rr.filter(
      (r) => r.supervisorId === user.id && (r.status === "pending" || r.status === "quoting")
    ).length;

    const lowStock = mats.filter((m) => !m.archived && m.stock <= 10).length;

    return { pending, delivery, returns, rentals, lowStock };
  }, [requests, purchaseRequests, returnRequests, rentalRequests, materials, user]);

  // ================= ACTIVIDAD UNIFICADA =================
  const allActivity = useMemo(() => {
    if (!user) return [];
    const list: ActivityItem[] = [];
    const mats = materials || [];

    (requests || []).forEach((r: MaterialRequest) => {
      if (r.supervisorId !== user.id) return;
      const smartName = smartItemName(r.items || [], mats);
      const title = smartName
        ? `Solicitud: ${smartName}`
        : r.items?.length
        ? `${r.items.length} ítems solicitados`
        : "Solicitud de material";
      list.push({
        id: `req-${r.id}`, originalId: r.id, type: "request", title,
        subtitle: `Destino: ${r.area || "Faena"}`, time: toDate(r.createdAt),
        status: r.status, delivered: !!r.deliveryDate,
      });
    });

    (purchaseRequests || []).forEach((r: PurchaseRequest) => {
      if (r.supervisorId !== user.id) return;
      list.push({
        id: `pur-${r.id}`, originalId: r.id, type: "purchase",
        title: r.materialName || "Solicitud de compra",
        subtitle: `Cantidad: ${r.quantity} ${r.unit}`, time: toDate(r.createdAt), status: r.status,
      });
    });

    (returnRequests || []).forEach((r: ReturnRequest) => {
      if (r.supervisorId !== user.id) return;
      const count = (r as any).items?.length ?? 1;
      list.push({
        id: `ret-${r.id}`, originalId: r.id, type: "return",
        title: count === 1 ? "Devolución de material" : `Devolución (${count} ítems)`,
        subtitle: `${count} ítem(s) devueltos`, time: toDate(r.createdAt), status: r.status,
      });
    });

    (rentalRequests || []).forEach((r: RentalRequest) => {
      if (r.supervisorId !== user.id) return;
      list.push({
        id: `rent-${r.id}`, originalId: r.id, type: "rental",
        title: `Arriendo: ${r.equipmentName}`,
        subtitle: `${r.contractName || "Faena"} · ×${r.quantity}`,
        time: toDate(r.createdAt), status: r.status,
      });
    });

    return list.sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [requests, purchaseRequests, returnRequests, rentalRequests, materials, user]);

  const filteredActivity = useMemo(() => {
    if (activeTab === "all") return allActivity.slice(0, 25);
    return allActivity.filter((a) => a.type === activeTab).slice(0, 25);
  }, [activeTab, allActivity]);

  // ================= CONFIGURADORES (tokenizados) =================
  const getStatusConfig = (status: string, delivered = false) => {
    if (delivered) return { label: "Entregado", className: "badge-success" };
    const statusMap: Record<string, string> = {
      pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado", completed: "Completado",
      ordered: "Ordenado", received: "Recibido", batched: "En Lote",
      quoting: "En cotización", fulfilled: "Arriendo creado",
    };
    const classMap: Record<string, string> = {
      pending: "badge-warning", approved: "badge-info", rejected: "bg-destructive/10 text-destructive border-destructive/30",
      completed: "badge-success", ordered: "badge-info", received: "badge-success",
      batched: "bg-muted text-muted-foreground", quoting: "badge-info", fulfilled: "badge-success",
    };
    return { label: statusMap[status] || status, className: classMap[status] || "bg-muted text-muted-foreground" };
  };

  const getTypeConfig = (t: string) => {
    switch (t) {
      case "request": return { icon: Package, accent: "primary", label: "Pañol" };
      case "purchase": return { icon: ShoppingCart, accent: "info", label: "Compra" };
      case "return": return { icon: RotateCcw, accent: "success", label: "Devolución" };
      case "rental": return { icon: KeyRound, accent: "warning", label: "Arriendo" };
      default: return { icon: FileText, accent: "primary", label: "Otro" };
    }
  };

  const metricCards = [
    { label: "Pendientes", value: metrics.pending, icon: Clock, accent: "warning" },
    { label: "Por Recibir", value: metrics.delivery, icon: PackageCheck, accent: "info" },
    { label: "Arriendos", value: metrics.rentals, icon: KeyRound, accent: "primary" },
    { label: "Devoluciones", value: metrics.returns, icon: RotateCcw, accent: "success" },
    { label: "Stock Crítico", value: metrics.lowStock, icon: AlertTriangle, accent: "destructive" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <PageHeader
        title={`${getGreeting()}, ${user?.name.split(" ")[0] ?? "Supervisor"}`}
        description="Panel de control operativo del supervisor."
      />

      {/* MÉTRICAS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {metricCards.map((m) => {
          const a = ACCENT[m.accent];
          return (
            <Card key={m.label} className={cn("border-l-4 rounded-[1.5rem] shadow-sm hover:shadow-md transition", a.border)}>
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground truncate">{m.label}</p>
                  <h3 className="text-3xl font-black text-foreground">{m.value}</h3>
                </div>
                <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center shrink-0", a.iconBg)}>
                  <m.icon className={cn("h-6 w-6", a.icon)} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ACCIONES RÁPIDAS */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Acciones rápidas</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <QuickAction href="/dashboard/supervisor/request" icon={Package} title="Solicitar al Pañol" desc="Material disponible" accent="primary" arrow={ArrowUpRight} />
          <QuickAction href="/dashboard/purchasing/purchase-request-form" icon={ShoppingCart} title="Solicitar Compra" desc="Material sin stock" accent="info" arrow={ArrowUpRight} />
          <QuickAction href="/dashboard/supervisor/rental-request" icon={KeyRound} title="Solicitar Arriendo" desc="Equipos de terceros" accent="warning" arrow={ArrowUpRight} />
          <QuickAction href="/dashboard/supervisor/return-request" icon={RotateCcw} title="Devolver Material" desc="Retornar sobrantes" accent="success" arrow={ArrowDownLeft} />
        </div>
      </div>

      {/* HISTORIAL */}
      <Card className="rounded-[1.5rem] shadow-sm">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <CardTitle className="text-xl">Historial de Actividad</CardTitle>
              <CardDescription>Tus solicitudes, compras, arriendos y devoluciones recientes.</CardDescription>
            </div>
            <Link href="/dashboard/supervisor/request">
              <Button size="sm" variant="outline">Ver historial completo <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4 grid grid-cols-3 sm:grid-cols-5 sm:flex">
              <TabsTrigger value="all">Todo</TabsTrigger>
              <TabsTrigger value="request" className="gap-2"><Package className="h-4 w-4" /> Pañol</TabsTrigger>
              <TabsTrigger value="purchase" className="gap-2"><ShoppingCart className="h-4 w-4" /> Compras</TabsTrigger>
              <TabsTrigger value="rental" className="gap-2"><KeyRound className="h-4 w-4" /> Arriendos</TabsTrigger>
              <TabsTrigger value="return" className="gap-2"><RotateCcw className="h-4 w-4" /> Devol.</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab}>
              {filteredActivity.length > 0 ? (
                <ScrollArea className="h-[400px] pr-3">
                  <div className="space-y-3">
                    {filteredActivity.map((act) => {
                      const t = getTypeConfig(act.type);
                      const s = getStatusConfig(act.status, act.delivered);
                      const a = ACCENT[t.accent];
                      const Icon = t.icon;
                      return (
                        <div key={act.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-xl bg-card hover:bg-muted/40 transition">
                          <div className="flex gap-4">
                            <div className={cn("p-2 rounded-2xl shrink-0", a.iconBg)}>
                              <Icon className={cn("h-5 w-5", a.icon)} />
                            </div>
                            <div>
                              <div className="flex gap-2 items-center flex-wrap">
                                <span className="font-semibold text-sm">{act.title}</span>
                                <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground">{t.label}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {act.subtitle} • <span className="capitalize">{formatDistanceToNow(act.time, { addSuffix: true, locale: es })}</span>
                              </p>
                            </div>
                          </div>
                          <Badge variant="outline" className={cn("whitespace-nowrap mt-2 sm:mt-0", s.className)}>{s.label}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-xl">
                  <SearchX className="h-12 w-12 mb-3 opacity-20" />
                  <p>No hay movimientos en esta categoría.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* BOTÓN FLOTANTE */}
      <Link href="/dashboard/supervisor/request">
        <Button className="fixed bottom-6 right-6 rounded-full shadow-xl h-14 w-14 p-0 md:hidden z-50">
          <Plus className="h-7 w-7" />
        </Button>
      </Link>
    </div>
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
