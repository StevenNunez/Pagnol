"use client";

import { useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  Send, Loader2, Undo2, PackageSearch, MapPin, Search, ChevronDown, Clock, Check, X as XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Material } from "@/modules/core/lib/data";
import { formatDateTime } from "@/components/pagnol-requests/request-shared";
import { computeReturnBalanceItems, balanceKey, ReturnBalanceItem } from "@/components/supervisor-returns/return-balance";
import { ReturnHistoryCard } from "@/components/supervisor-returns/return-history-card";

type HistoryFilter = 'all' | 'pending' | 'completed' | 'rejected';
const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'pending', label: 'Por revisar' },
  { key: 'completed', label: 'Completadas' },
  { key: 'rejected', label: 'Rechazadas' },
];
const PAGE_SIZE = 10;

export default function SupervisorReturnRequestPage() {
  const { materials, addReturnRequest, requests, returnRequests } = useAppState();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);

  // Saldo pendiente por (material, contrato) — sin filtro de fecha: lo que
  // retiraste ayer sigue apareciendo hoy. El servidor recalcula esto mismo
  // antes de aceptar el envío (nunca confiar solo en esta vista optimista).
  const balanceItems = useMemo(
    () => authUser ? computeReturnBalanceItems(authUser.id, requests, returnRequests, materialMap) : [],
    [authUser, requests, returnRequests, materialMap]
  );

  const handleQuantityChange = (key: string, value: string, max: number) => {
    const num = Number(value);
    if (value !== '' && (isNaN(num) || num < 0)) return;
    const clamped = value === '' ? '' : String(Math.min(num, max));
    setQuantities(prev => ({ ...prev, [key]: clamped }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;

    const itemsToReturn = balanceItems
      .map(item => {
        const key = balanceKey(item.materialId, item.contractId);
        const quantity = Number(quantities[key]) || 0;
        return { item, quantity };
      })
      .filter(({ quantity }) => quantity > 0);

    if (itemsToReturn.length === 0 || !justification.trim()) {
      toast({ variant: 'destructive', title: 'Faltan datos', description: 'Indica la cantidad a devolver de al menos un material y una justificación.' });
      return;
    }

    setIsSubmitting(true);
    try {
      await addReturnRequest(
        itemsToReturn.map(({ item, quantity }) => ({
          materialId: item.materialId,
          quantity,
          materialName: item.materialName,
          unit: item.unit,
          contractId: item.contractId,
          contractName: item.contractName,
        })),
        justification,
      );
      toast({ title: 'Devolución enviada', description: 'Sigue su avance en el historial de esta página.' });
      setQuantities({});
      setJustification('');
    } catch (error: any) {
      // Mensaje real del servidor (incluye el saldo real si intentaste devolver
      // más de lo pendiente) en vez de un genérico que oculta la causa.
      toast({ variant: 'destructive', title: 'No se pudo enviar la devolución', description: error?.message || 'Error inesperado.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const myReturns = useMemo(() =>
    ((returnRequests || []))
      .filter(r => r.supervisorId === authUser?.id)
      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()),
    [returnRequests, authUser]
  );

  const kpis = useMemo(() => {
    const acc = { pending: 0, completed: 0, rejected: 0 };
    myReturns.forEach(r => { acc[r.status]++; });
    return acc;
  }, [myReturns]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return myReturns.filter(r => {
      if (historyFilter !== 'all' && r.status !== historyFilter) return false;
      if (!q) return true;
      return (r.internalCode || '').toLowerCase().includes(q)
        || r.materialName.toLowerCase().includes(q)
        || (r.contractName || '').toLowerCase().includes(q);
    });
  }, [myReturns, historyFilter, search]);

  const setHistoryFilterReset = (f: HistoryFilter) => { setHistoryFilter(f); setVisible(PAGE_SIZE); };

  const KPI_ITEMS = [
    { key: 'pending' as HistoryFilter, label: 'Por revisar', value: kpis.pending, icon: Clock, iconCls: 'bg-warning-subtle text-warning' },
    { key: 'completed' as HistoryFilter, label: 'Completadas', value: kpis.completed, icon: Check, iconCls: 'bg-muted text-muted-foreground' },
    { key: 'rejected' as HistoryFilter, label: 'Rechazadas', value: kpis.rejected, icon: XIcon, iconCls: kpis.rejected > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground' },
  ];

  return (
    <PageShell
      title="Registrar Devolución de Materiales"
      description="Indica la cantidad sobrante de los materiales que retiraste para devolverlos al pañol."
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">

        {/* COLUMNA IZQUIERDA: FORMULARIO */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-card rounded-[2rem] border shadow-sm p-8 space-y-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-primary/10 text-primary shrink-0">
                <Undo2 size={20} />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight">Lista de Devolución</h3>
                <p className="text-xs text-muted-foreground font-medium">Materiales que tienes pendientes de devolver.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {balanceItems.length > 0 ? (
                <div className="space-y-3">
                  {balanceItems.map(item => {
                    const key = balanceKey(item.materialId, item.contractId);
                    return (
                      <div key={key} className="p-5 border rounded-2xl bg-muted/30 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-bold uppercase tracking-tight truncate">{item.materialName}</p>
                            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                              Pendiente: <span className="font-black text-foreground">{item.outstanding} {item.unit}</span> · desde {formatDateTime(item.since)}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1 shrink-0">
                            <MapPin className="h-3 w-3" /> {item.contractName || 'Pool central'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest shrink-0">Cantidad a devolver</Label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={quantities[key] || ''}
                            onChange={(e) => handleQuantityChange(key, e.target.value, item.outstanding)}
                            max={item.outstanding}
                            min={0}
                            disabled={isSubmitting}
                            className="h-10 rounded-xl text-right w-28 ml-auto"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={<PackageSearch size={24} />}
                  title="Sin materiales pendientes"
                  description="No tienes saldo pendiente de devolución. Aparecerá aquí apenas retires algo que deba devolverse."
                />
              )}

              <div className="space-y-1.5">
                <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                  Justificación general <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  placeholder="Ej: Material sobrante de faena en Torre Norte, Piso 5..."
                  value={justification}
                  onChange={e => setJustification(e.target.value)}
                  disabled={isSubmitting}
                  className="resize-none h-20 rounded-xl"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-xl text-sm font-black uppercase tracking-widest shadow-lg shadow-primary/10 gap-2"
                disabled={isSubmitting || balanceItems.length === 0}
              >
                {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : <><Send className="h-4 w-4" /> Enviar solicitud de devolución</>}
              </Button>
            </form>
          </div>
        </div>

        {/* COLUMNA DERECHA: HISTORIAL */}
        <div className="xl:col-span-7 space-y-5">
          <div className="grid grid-cols-3 gap-4">
            {KPI_ITEMS.map((k) => (
              <button key={k.key} onClick={() => setHistoryFilterReset(k.key)} className="text-left">
                <Card className="p-5 rounded-[1.5rem] border-none shadow-sm hover:shadow-lg transition-all h-full">
                  <div className={cn("p-2.5 rounded-xl w-fit shadow-sm mb-4", k.iconCls)}>
                    <k.icon size={16} />
                  </div>
                  <p className="text-2xl font-black font-outfit text-foreground">{k.value}</p>
                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mt-1">{k.label}</p>
                </Card>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1 bg-muted/50 border rounded-xl p-1 w-fit max-w-full">
              {HISTORY_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setHistoryFilterReset(key)}
                  className={cn(
                    "px-3.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                    historyFilter === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
              <Input
                value={search}
                onChange={e => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
                placeholder="Buscar código, material o contrato…"
                className="h-10 rounded-xl pl-10 text-xs bg-card"
              />
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <EmptyState
              icon={<Search size={24} />}
              title={search ? 'Sin resultados' : 'No se encontraron devoluciones'}
              description={search ? `No se encontró "${search}".` : 'Tus devoluciones aparecerán aquí una vez enviadas.'}
            />
          ) : (
            <>
              <div className="space-y-4">
                {filteredHistory.slice(0, visible).map((req) => (
                  <ReturnHistoryCard key={req.id} req={req} />
                ))}
              </div>
              {filteredHistory.length > visible && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" onClick={() => setVisible(v => v + PAGE_SIZE)} className="rounded-[1.5rem] px-8 h-11 text-xs font-black uppercase tracking-widest gap-2">
                    Mostrar más ({filteredHistory.length - visible}) <ChevronDown size={16} />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
