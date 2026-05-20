
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
} from "lucide-react";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

import type {
  MaterialRequest,
  PurchaseRequest,
  ReturnRequest,
  Material,
} from "@/modules/core/lib/data";
import { cn } from "@/lib/utils";

// ====================== TIPOS ======================
type ActivityItem = {
  id: string;
  originalId: string;
  type: "request" | "purchase" | "return";
  title: string;
  subtitle: string;
  time: Date;
  status: string;
  delivered?: boolean;
};

export default function SupervisorHubPage() {
  const { requests, purchaseRequests, returnRequests, materials } = useAppState();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState("all");

  // ==================================================
  // HELPERS
  // ==================================================
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

  // ==================================================
  // MÉTRICAS
  // ==================================================
  const metrics = useMemo(() => {
    if (!user)
      return { pending: 0, delivery: 0, returns: 0, lowStock: 0 };

    const reqs = (requests || []) as MaterialRequest[];
    const pr = (purchaseRequests || []) as PurchaseRequest[];
    const ret = (returnRequests || []) as ReturnRequest[];
    const mats = (materials || []) as Material[];

    const pending =
      reqs.filter((r) => r.supervisorId === user.id && r.status === "pending").length +
      pr.filter((r) => r.supervisorId === user.id && r.status === "pending").length;

    const delivery = reqs.filter(
      (r) => r.supervisorId === user.id && r.status === "approved" && !r.deliveryDate
    ).length;

    const returns = ret.filter(
      (r) => r.supervisorId === user.id && r.status === "pending"
    ).length;

    const lowStock = mats.filter((m) => !m.archived && m.stock <= 10).length;

    return { pending, delivery, returns, lowStock };
  }, [requests, purchaseRequests, returnRequests, materials, user]);

  // ==================================================
  // ACTIVIDAD UNIFICADA
  // ==================================================
  const allActivity = useMemo(() => {
    if (!user) return [];
    const list: ActivityItem[] = [];

    const mats = materials || [];

    // ---- Solicitudes Internas ----
    (requests || []).forEach((r: MaterialRequest) => {
      if (r.supervisorId !== user.id) return;

      const smartName = smartItemName(r.items || [], mats);

      const title =
        smartName
          ? `Solicitud: ${smartName}`
          : r.items?.length
          ? `${r.items.length} ítems solicitados`
          : "Solicitud de material";

      list.push({
        id: `req-${r.id}`,
        originalId: r.id,
        type: "request",
        title,
        subtitle: `Destino: ${r.area || "Obra"}`,
        time: toDate(r.createdAt),
        status: r.status,
        delivered: !!r.deliveryDate,
      });
    });

    // ---- Compras ----
    (purchaseRequests || []).forEach((r: PurchaseRequest) => {
      if (r.supervisorId !== user.id) return;

      list.push({
        id: `pur-${r.id}`,
        originalId: r.id,
        type: "purchase",
        title: r.materialName || "Solicitud de compra",
        subtitle: `Cantidad: ${r.quantity} ${r.unit}`,
        time: toDate(r.createdAt),
        status: r.status,
      });
    });

    // ---- Devoluciones ----
    (returnRequests || []).forEach((r: ReturnRequest) => {
        if (r.supervisorId !== user.id) return;

        const count = (r as any).items?.length ?? 1;

        list.push({
            id: `ret-${r.id}`,
            originalId: r.id,
            type: "return",
            title: count === 1 ? "Devolución de material" : `Devolución (${count} ítems)`,
            subtitle: `${count} ítem(s) devueltos`,
            time: toDate(r.createdAt),
            status: r.status,
        });
    });

    return list.sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [requests, purchaseRequests, returnRequests, materials, user]);

  const filteredActivity = useMemo(() => {
    if (activeTab === "all") return allActivity.slice(0, 20);
    return allActivity.filter((a) => a.type === activeTab).slice(0, 20);
  }, [activeTab, allActivity]);

  // ==================================================
  // CONFIGURADORES
  // ==================================================
  const getStatusConfig = (status: string, delivered = false) => {
    if (delivered)
      return {
        label: "Entregado",
        className: "bg-emerald-100 text-emerald-700 border-emerald-300",
      };

    const statusMap: any = {
      pending: "Pendiente",
      approved: "Aprobado",
      rejected: "Rechazado",
      completed: "Completado",
      ordered: "Ordenado",
      received: "Recibido",
      batched: "En Lote",
    };

    const colorMap: any = {
      pending: "bg-amber-100 text-amber-700 border-amber-300",
      approved: "bg-blue-100 text-blue-700 border-blue-300",
      rejected: "bg-red-100 text-red-700 border-red-300",
      completed: "bg-purple-100 text-purple-700 border-purple-300",
      ordered: "bg-indigo-100 text-indigo-700 border-indigo-300",
      received: "bg-green-100 text-green-700 border-green-300",
      batched: "bg-gray-200 text-gray-800 border-gray-400",
    };
    
    return {
      label: statusMap[status] || status,
      className: colorMap[status] || "bg-gray-100 text-gray-700 border-gray-300",
    };
  };

  const getTypeConfig = (t: string) => {
    switch (t) {
      case "request":
        return { icon: Package, color: "text-primary", label: "Bodega", bg: "bg-primary/10" };
      case "purchase":
        return { icon: ShoppingCart, color: "text-blue-600", label: "Compra", bg: "bg-blue-100" };
      case "return":
        return { icon: RotateCcw, color: "text-purple-600", label: "Devolución", bg: "bg-purple-100" };
      default:
        return { icon: FileText, color: "text-gray-600", label: "Otro", bg: "bg-gray-100" };
    }
  };

  // ==================================================
  // RENDER
  // ==================================================
  return (
    <div className="flex flex-col gap-8 pb-12 fade-in">
      <PageHeader
        title={`${getGreeting()}, ${user?.name.split(" ")[0] ?? "Supervisor"}`}
        description="Panel de control operativo."
      />

      {/* MÉTRICAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Pendientes Aprobación",
            value: metrics.pending,
            color: "amber",
            icon: Clock,
          },
          {
            label: "Por Recibir",
            value: metrics.delivery,
            color: "blue",
            icon: PackageCheck,
          },
          {
            label: "Devoluciones Pend.",
            value: metrics.returns,
            color: "purple",
            icon: RotateCcw,
          },
          {
            label: "Stock Crítico",
            value: metrics.lowStock,
            color: "red",
            icon: AlertTriangle,
          },
        ].map((m) => (
          <Card
            key={m.label}
            className={`border-l-4 border-l-${m.color}-500 shadow-sm hover:shadow-md transition`}
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{m.label}</p>
                <h3 className={`text-3xl font-bold text-${m.color}-600`}>
                  {m.value}
                </h3>
              </div>
              <div
                className={`h-12 w-12 rounded-full bg-${m.color}-100 flex items-center justify-center`}
              >
                <m.icon className={`h-6 w-6 text-${m.color}-600`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ACCIONES RÁPIDAS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <QuickAction
          href="/dashboard/supervisor/request"
          icon={Package}
          title="Solicitar a Bodega"
          desc="Material disponible"
          color="primary"
          arrow={ArrowUpRight}
        />

        <QuickAction
          href="/dashboard/purchasing/purchase-request-form"
          icon={ShoppingCart}
          title="Solicitar Compra"
          desc="Material sin stock"
          color="blue"
          arrow={ArrowUpRight}
        />

        <QuickAction
          href="/dashboard/supervisor/return-request"
          icon={RotateCcw}
          title="Devolver Material"
          desc="Retornar sobrantes"
          color="purple"
          arrow={ArrowDownLeft}
        />
      </div>

      {/* HISTORIAL */}
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <CardTitle className="text-xl">Historial de Actividad</CardTitle>
              <CardDescription>
                Últimos movimiento de solicitudes, compras y devoluciones.
              </CardDescription>
            </div>

            <Link href="/dashboard/supervisor/request">
              <Button size="sm" variant="outline">
                Ver historial completo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4 grid grid-cols-4 sm:flex">
              <TabsTrigger value="all">Todo</TabsTrigger>
              <TabsTrigger value="request" className="gap-2">
                <Package className="h-4 w-4" /> Bodega
              </TabsTrigger>
              <TabsTrigger value="purchase" className="gap-2">
                <ShoppingCart className="h-4 w-4" /> Compras
              </TabsTrigger>
              <TabsTrigger value="return" className="gap-2">
                <RotateCcw className="h-4 w-4" /> Devol.
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab}>
              {filteredActivity.length > 0 ? (
                <ScrollArea className="h-[400px] pr-3">
                  <div className="space-y-3">
                    {filteredActivity.map((act) => {
                      const t = getTypeConfig(act.type);
                      const s = getStatusConfig(act.status, act.delivered);
                      const Icon = t.icon;

                      return (
                        <div
                          key={act.id}
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg bg-card hover:bg-muted/40 transition cursor-pointer"
                        >
                          <div className="flex gap-4">
                            <div className={cn("p-2 rounded-full", t.bg)}>
                              <Icon className={cn("h-5 w-5", t.color)} />
                            </div>

                            <div>
                              <div className="flex gap-2 items-center">
                                <span className="font-semibold text-sm">{act.title}</span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] h-5 px-1.5 text-muted-foreground"
                                >
                                  {t.label}
                                </Badge>
                              </div>

                              <p className="text-xs text-muted-foreground">
                                {act.subtitle} •{" "}
                                <span className="capitalize">
                                  {formatDistanceToNow(act.time, {
                                    addSuffix: true,
                                    locale: es,
                                  })}
                                </span>
                              </p>
                            </div>
                          </div>

                          <Badge
                            variant="outline"
                            className={cn("whitespace-nowrap mt-2 sm:mt-0", s.className)}
                          >
                            {s.label}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
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

// ==================================================
// COMPONENTE PARA ACCIONES RÁPIDAS (REUTILIZABLE)
// ==================================================
function QuickAction({ href, icon: Icon, title, desc, color, arrow: Arrow }: {href: string, icon: React.ElementType, title: string, desc: string, color: string, arrow: React.ElementType}) {
  return (
    <Link href={href} className="block h-full">
      <Card
        className={cn(
          "h-full group cursor-pointer border-2 transition-all duration-300",
          `hover:border-${color}-500/50 hover:bg-${color}-50/25`
        )}
      >
        <CardHeader className="flex flex-row items-center gap-4 pb-2">
          <div className={cn("p-3 rounded-lg transition-transform group-hover:scale-110",
              `bg-${color}-100`
          )}>
            <Icon className={cn("h-6 w-6", `text-${color}-600`)} />
          </div>

          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pt-0 relative">
          <Arrow
            className={cn(
              "absolute right-4 bottom-4 h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100",
              `text-${color}-400`
            )}
          />
        </CardContent>
      </Card>
    </Link>
  );
}
