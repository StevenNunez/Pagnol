'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import {
  FileText, ArrowDownLeft, ArrowUpRight, AlertTriangle, CalendarClock, Contact, ArrowRight,
} from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatMoney, derivePaymentStatus, DIRECTION_SHORT, DIRECTION_BADGE } from './_lib/helpers';

export default function RentalsDashboard() {
  const router = useRouter();
  const { rentalContracts, rentalPayments } = useAppState();

  // Sin `|| []`: las colecciones del estado global nunca son undefined, y el `||`
  // creaba un array nuevo por render que invalidaba los useMemo de abajo.
  const contracts = rentalContracts;
  const payments = rentalPayments;

  // Contrapartes distintas involucradas en contratos (arrendadores en `suppliers`,
  // clientes en `rentalParties`); se cuentan por su presencia en los contratos.
  const partyCount = useMemo(
    () => new Set(contracts.map((c) => c.partyId).filter(Boolean)).size,
    [contracts],
  );

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const activeContracts = contracts.filter((c) => c.status === 'active');

  // Costo mensual estimado (entrantes) e ingreso mensual estimado (salientes).
  const monthlyCost = useMemo(
    () => activeContracts.filter((c) => c.direction === 'incoming' && c.billingCycle === 'monthly')
      .reduce((s, c) => s + (c.currency === 'CLP' ? c.amount : 0), 0),
    [activeContracts],
  );
  const monthlyIncome = useMemo(
    () => activeContracts.filter((c) => c.direction === 'outgoing' && c.billingCycle === 'monthly')
      .reduce((s, c) => s + (c.currency === 'CLP' ? c.amount : 0), 0),
    [activeContracts],
  );

  const contractTitle = (id: string) => contracts.find((c) => c.id === id)?.title ?? 'Contrato';
  const contractOf = (id: string) => contracts.find((c) => c.id === id);

  const overdue = useMemo(
    () => payments.filter((p) => derivePaymentStatus(p) === 'overdue')
      .sort((a, b) => new Date(a.dueDate as any).getTime() - new Date(b.dueDate as any).getTime()),
    [payments],
  );

  const upcoming = useMemo(
    () => payments.filter((p) => {
      if (p.status === 'paid') return false;
      const d = differenceInCalendarDays(new Date(p.dueDate as any), today);
      return d >= 0 && d <= 7;
    }).sort((a, b) => new Date(a.dueDate as any).getTime() - new Date(b.dueDate as any).getTime()),
    [payments, today],
  );

  const expiringContracts = useMemo(
    () => activeContracts.filter((c) => {
      if (!c.endDate) return false;
      const d = differenceInCalendarDays(new Date(c.endDate as any), today);
      return d >= 0 && d <= 30;
    }).sort((a, b) => new Date(a.endDate as any).getTime() - new Date(b.endDate as any).getTime()),
    [activeContracts, today],
  );

  const hasData = contracts.length > 0 || partyCount > 0;

  return (
    <PageShell title="Panel de Arriendos" description="Resumen de contratos, contrapartes y vencimientos.">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<FileText className="h-5 w-5" />} label="Contratos activos" value={String(activeContracts.length)} href="/dashboard/rentals/contracts" />
        <KpiCard icon={<Contact className="h-5 w-5" />} label="Contrapartes" value={String(partyCount)} href="/dashboard/rentals/parties" />
        <KpiCard icon={<ArrowDownLeft className="h-5 w-5" />} label="Costo mensual (CLP)" value={formatMoney(monthlyCost)} tone="warning" />
        <KpiCard icon={<ArrowUpRight className="h-5 w-5" />} label="Ingreso mensual (CLP)" value={formatMoney(monthlyIncome)} tone="success" />
      </div>

      {!hasData && (
        <EmptyState
          icon={<FileText size={22} />}
          title="Aún no hay arriendos"
          description="Comienza creando una contraparte (arrendador o cliente) y su primer contrato."
        />
      )}

      {/* Alertas */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <AlertList
          title="Pagos vencidos"
          icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
          empty="Sin pagos vencidos."
          items={overdue.slice(0, 8).map((p) => ({
            id: p.id,
            href: `/dashboard/rentals/contracts/${p.contractId}`,
            primary: contractTitle(p.contractId),
            secondary: `Venció ${fmtDate(p.dueDate)}`,
            right: <span className="text-sm font-bold tabular-nums text-destructive">{formatMoney(p.amount, contractOf(p.contractId)?.currency)}</span>,
          }))}
        />
        <AlertList
          title="Pagos próximos (7 días)"
          icon={<CalendarClock className="h-5 w-5 text-warning-subtle-foreground" />}
          empty="Sin pagos en los próximos 7 días."
          items={upcoming.slice(0, 8).map((p) => ({
            id: p.id,
            href: `/dashboard/rentals/contracts/${p.contractId}`,
            primary: contractTitle(p.contractId),
            secondary: `Vence ${fmtDate(p.dueDate)}`,
            right: <span className="text-sm font-bold tabular-nums">{formatMoney(p.amount, contractOf(p.contractId)?.currency)}</span>,
          }))}
        />
        <AlertList
          title="Contratos por vencer (30 días)"
          icon={<FileText className="h-5 w-5 text-info" />}
          empty="Sin contratos próximos a vencer."
          items={expiringContracts.slice(0, 8).map((c) => ({
            id: c.id,
            href: `/dashboard/rentals/contracts/${c.id}`,
            primary: c.title,
            secondary: `Termina ${fmtDate(c.endDate as any)}`,
            right: <Badge variant="outline" className={DIRECTION_BADGE[c.direction]}>{DIRECTION_SHORT[c.direction]}</Badge>,
          }))}
        />
      </div>
    </PageShell>
  );
}

function KpiCard({ icon, label, value, href, tone }: {
  icon: React.ReactNode; label: string; value: string; href?: string; tone?: 'success' | 'warning';
}) {
  const toneClass = tone === 'success' ? 'text-success-subtle-foreground' : tone === 'warning' ? 'text-warning-subtle-foreground' : 'text-foreground';
  const body = (
    <Card className="rounded-[1.5rem] h-full hover:shadow-md transition-shadow">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">{icon}</div>
          {href && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className={`text-2xl font-black tabular-nums ${toneClass}`}>{value}</div>
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

interface AlertItem { id: string; href: string; primary: string; secondary: string; right: React.ReactNode; }

function AlertList({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: AlertItem[]; empty: string }) {
  return (
    <Card className="rounded-[1.5rem]">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-black uppercase tracking-widest text-foreground">{title}</h3>
          {items.length > 0 && <Badge variant="secondary" className="ml-auto rounded-lg">{items.length}</Badge>}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{empty}</p>
        ) : (
          <ul className="space-y-1">
            {items.map((it) => (
              <li key={it.id}>
                <Link href={it.href} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-foreground truncate">{it.primary}</div>
                    <div className="text-xs text-muted-foreground">{it.secondary}</div>
                  </div>
                  {it.right}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function fmtDate(d: Date | string): string {
  const date = new Date(d as any);
  if (isNaN(date.getTime())) return '—';
  return format(date, "d 'de' MMM", { locale: es });
}
