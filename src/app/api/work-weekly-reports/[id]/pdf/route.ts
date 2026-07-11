import { NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';
import { mappers } from '@/modules/data/mappers';
import type { WorkOrder, WorkReport } from '@/modules/core/lib/data';
import { construirDatosSemanal } from '@/lib/report-engine/build-weekly-data';
import { generarSemanalPdf } from '@/lib/report-engine/generate-pdf';

// Genera el PDF del Reporte Semanal (consolida los diarios) y lo devuelve al
// vuelo (binario, sin persistir en Storage).
//
//   POST /api/work-weekly-reports/:id/pdf  ->  application/pdf (binario)

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireAuth(req, { permission: 'work_reports:download_pdf' });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  try {
    const { data: row, error } = await ctx.admin
      .from('work_weekly_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: 'Reporte semanal no encontrado.' }, { status: 404 });
    }
    if (!ctx.isSuperAdmin && row.tenant_id !== ctx.tenantId) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    let tenantName: string | null = null;
    try {
      const { data: t } = await ctx.admin.from('tenants').select('name').eq('id', row.tenant_id).single();
      tenantName = t?.name || null;
    } catch { /* nombre opcional */ }

    const weekly = mappers.work_weekly_reports(row);

    // Diarios consolidados + OT que esos diarios referencian (para derivar HH).
    // Si el Semanal ya se firmó, usa la copia congelada en ese momento
    // (consolidatedReportsSnapshot) en vez de los Diarios en vivo — el PDF de
    // un Semanal ya firmado no debe cambiar si alguien reabre un Diario después.
    let reports: WorkReport[] = [];
    let orders: WorkOrder[] = [];
    if (weekly.consolidatedReportsSnapshot?.length) {
      reports = weekly.consolidatedReportsSnapshot;
    } else if (weekly.consolidatedReportIds?.length) {
      const { data: reportRows } = await ctx.admin
        .from('work_reports')
        .select('*')
        .in('id', weekly.consolidatedReportIds);
      reports = (reportRows || []).map((r) => mappers.work_reports(r));
    }
    if (reports.length) {
      // Cada diario ya congeló su propia copia de OT al enviarse a revisión
      // (consolidatedOrdersSnapshot); solo se van a buscar en vivo las OT de
      // los diarios que todavía no tienen snapshot (borrador/observado).
      const snapshotOrders = reports.flatMap((r) => r.consolidatedOrdersSnapshot || []);
      const liveOrderIds = [...new Set(
        reports
          .filter((r) => !r.consolidatedOrdersSnapshot?.length)
          .flatMap((r) => r.consolidatedOrderIds || []),
      )];
      let liveOrders: WorkOrder[] = [];
      if (liveOrderIds.length) {
        const { data: orderRows } = await ctx.admin
          .from('work_orders')
          .select('*')
          .in('id', liveOrderIds);
        liveOrders = (orderRows || []).map((r) => mappers.work_orders(r));
      }
      const seen = new Set<string>();
      orders = [...snapshotOrders, ...liveOrders].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
    }

    const datos = await construirDatosSemanal(weekly, reports, orders, tenantName);
    const pdf = await generarSemanalPdf(datos);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Semanal-${id}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[WeeklyReports] pdf error:', error);
    return NextResponse.json(
      { error: error?.message || 'No se pudo generar el PDF.' },
      { status: 500 },
    );
  }
}
