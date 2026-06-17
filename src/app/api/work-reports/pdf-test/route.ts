import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { generarReportePdf } from '@/lib/report-engine/generate-pdf';

// Endpoint de PRUEBA: valida que el motor PDF (puppeteer-core + @sparticuz/chromium)
// corre en local y en Vercel usando el data.json de ejemplo. No toca la base de
// datos. Una vez validado, se reemplaza por POST /api/work-reports/[id]/pdf que
// arma los datos desde el reporte real.
//
//   GET /api/work-reports/pdf-test         -> PDF inline en el navegador

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sample = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'report-engine', 'sample-data.json'), 'utf8'),
    );
    const pdf = await generarReportePdf(sample);
    return new NextResponse(pdf as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="reporte-prueba.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'No se pudo generar el PDF de prueba.', stack: error?.stack },
      { status: 500 },
    );
  }
}
