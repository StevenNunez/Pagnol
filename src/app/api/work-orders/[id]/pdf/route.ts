import { NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';
import { mappers } from '@/modules/data/mappers';
import { construirDatosOrden } from '@/lib/report-engine/build-order-data';
import { generarOrdenTrabajoPdf } from '@/lib/report-engine/generate-pdf';

// Genera el PDF de 1 página de una OT / Reporte de Trabajo y lo devuelve al vuelo
// (binario, sin persistir en Storage).
//
//   POST /api/work-orders/:id/pdf  ->  application/pdf (binario)

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
      .from('work_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: 'OT no encontrada.' }, { status: 404 });
    }
    if (!ctx.isSuperAdmin && row.tenant_id !== ctx.tenantId) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    let tenantName: string | null = null;
    try {
      const { data: t } = await ctx.admin.from('tenants').select('name').eq('id', row.tenant_id).single();
      tenantName = t?.name || null;
    } catch { /* nombre opcional */ }

    const order = mappers.work_orders(row);
    const datos = await construirDatosOrden(order, tenantName);
    const pdf = await generarOrdenTrabajoPdf(datos);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="OT-${id}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[WorkOrders] pdf error:', error);
    return NextResponse.json(
      { error: error?.message || 'No se pudo generar el PDF.' },
      { status: 500 },
    );
  }
}
