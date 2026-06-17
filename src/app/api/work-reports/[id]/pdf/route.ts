import { NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';
import { mappers } from '@/modules/data/mappers';
import { construirDatosReporte } from '@/lib/report-engine/build-report-data';
import { generarReportePdf } from '@/lib/report-engine/generate-pdf';

// Genera el PDF del Reporte Diario (motor Handlebars + Puppeteer) y lo devuelve
// al vuelo como binario, SIN persistirlo en Storage. El PDF siempre refleja el
// estado actual del reporte; no ocupa espacio en Supabase.
//
//   POST /api/work-reports/:id/pdf  ->  application/pdf (binario)

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
      .from('work_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: 'Informe no encontrado.' }, { status: 404 });
    }
    if (!ctx.isSuperAdmin && row.tenant_id !== ctx.tenantId) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    const report = mappers.work_reports(row);
    const datos = await construirDatosReporte(report);
    const pdf = await generarReportePdf(datos);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${id}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[WorkReports] pdf error:', error);
    return NextResponse.json(
      { error: error?.message || 'No se pudo generar el PDF.' },
      { status: 500 },
    );
  }
}
