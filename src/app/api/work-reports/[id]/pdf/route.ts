import { NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';
import { mappers } from '@/modules/data/mappers';
import { construirDatosReporte } from '@/lib/report-engine/build-report-data';
import { generarReportePdf } from '@/lib/report-engine/generate-pdf';

// Genera el PDF del Reporte Diario (motor Handlebars + Puppeteer), lo guarda en
// el bucket privado work-report-pdfs y devuelve una URL firmada.
//
//   POST /api/work-reports/:id/pdf  ->  { url, path }

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BUCKET = 'work-report-pdfs';
const SIGNED_URL_TTL = 315360000; // ~10 años

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

    const path = `${row.tenant_id}/${id}.pdf`;
    const { error: uploadError } = await ctx.admin.storage
      .from(BUCKET)
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;

    const { data: signed, error: signError } = await ctx.admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (signError || !signed) throw signError || new Error('No se pudo firmar la URL.');

    return NextResponse.json({ url: signed.signedUrl, path });
  } catch (error: any) {
    console.error('[WorkReports] pdf error:', error);
    return NextResponse.json(
      { error: error?.message || 'No se pudo generar el PDF.' },
      { status: 500 },
    );
  }
}
