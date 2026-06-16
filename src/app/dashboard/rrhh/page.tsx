'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Users, ClipboardList, FileWarning, ArrowRight, ShieldOff, AlertTriangle } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { LEAVE_TYPE_LABEL } from '@/modules/core/lib/hr-labels';

export default function RrhhDashboard() {
  const { users, leaveRequests, hrDocuments, can } = useAppState();

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const activeEmployees = (users || []).filter((u) => (u.employmentStatus || 'active') === 'active');
  const pendingRequests = (leaveRequests || []).filter((r) => r.status === 'pending')
    .sort((a, b) => new Date(a.startDate as any).getTime() - new Date(b.startDate as any).getTime());

  const expiringDocs = useMemo(
    () => (hrDocuments || []).filter((d) => {
      if (!d.expiryDate) return false;
      const days = differenceInCalendarDays(new Date(d.expiryDate as any), today);
      return days <= 30;
    }).sort((a, b) => new Date(a.expiryDate as any).getTime() - new Date(b.expiryDate as any).getTime()),
    [hrDocuments, today],
  );

  if (!can('module_rrhh:view')) {
    return (
      <EmptyState
        icon={<ShieldOff size={22} />}
        title="Sin acceso"
        description="No tienes permisos para administrar Recursos Humanos."
      />
    );
  }

  return (
    <PageShell title="Panel de Recursos Humanos" description="Ficha de empleados, vacaciones/licencias y documentos.">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard icon={<Users className="h-5 w-5" />} label="Empleados activos" value={String(activeEmployees.length)} href="/dashboard/rrhh/empleados" />
        <KpiCard icon={<ClipboardList className="h-5 w-5" />} label="Solicitudes pendientes" value={String(pendingRequests.length)} href="/dashboard/rrhh/solicitudes" tone={pendingRequests.length > 0 ? 'warning' : undefined} />
        <KpiCard icon={<FileWarning className="h-5 w-5" />} label="Documentos por vencer" value={String(expiringDocs.length)} href="/dashboard/rrhh/documentos" tone={expiringDocs.length > 0 ? 'warning' : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <AlertList
          title="Solicitudes pendientes"
          icon={<ClipboardList className="h-5 w-5 text-warning-subtle-foreground" />}
          empty="Sin solicitudes pendientes."
          items={pendingRequests.slice(0, 8).map((r) => ({
            id: r.id,
            href: '/dashboard/rrhh/solicitudes',
            primary: `${r.userName} — ${LEAVE_TYPE_LABEL[r.type]}`,
            secondary: `${fmtDate(r.startDate)} → ${fmtDate(r.endDate)} (${r.daysCount} días)`,
          }))}
        />
        <AlertList
          title="Documentos por vencer (30 días)"
          icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
          empty="Sin documentos por vencer."
          items={expiringDocs.slice(0, 8).map((d) => ({
            id: d.id,
            href: '/dashboard/rrhh/documentos',
            primary: `${d.userName} — ${d.name}`,
            secondary: d.expiryDate ? `Vence ${fmtDate(d.expiryDate)}` : 'Sin fecha',
          }))}
        />
      </div>
    </PageShell>
  );
}

function KpiCard({ icon, label, value, href, tone }: {
  icon: React.ReactNode; label: string; value: string; href?: string; tone?: 'warning';
}) {
  const toneClass = tone === 'warning' ? 'text-warning-subtle-foreground' : 'text-foreground';
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

interface AlertItem { id: string; href: string; primary: string; secondary: string; }

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
