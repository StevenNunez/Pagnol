import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';
import { extractRentalQuoteFlow } from '@/ai/flows/extract-rental-quote-flow';

async function verifySession(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error } = await client.auth.getUser(token);
  return error || !user ? null : user;
}

// Extrae con IA (Gemini) los datos de una cotización de arriendo desde su PDF,
// mapeando cada precio al ítem solicitado. El cliente revisa antes de guardar.
export async function POST(request: NextRequest) {
  try {
    const caller = await verifySession(request);
    if (!caller) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'La IA (GEMINI_API_KEY) no está configurada.' }, { status: 500 });
    }

    if (!(await rateLimitByIp(request, 'rentals-extract-quote', 40, 3600))) {
      return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 });
    }

    const { pdfBase64, items, cycleLabel } = await request.json();
    if (!pdfBase64 || !Array.isArray(items)) {
      return NextResponse.json({ error: 'PDF e ítems son obligatorios.' }, { status: 400 });
    }

    // Normaliza a data URI que Gemini acepta.
    const dataUri = String(pdfBase64).startsWith('data:')
      ? String(pdfBase64)
      : `data:application/pdf;base64,${pdfBase64}`;

    const result = await extractRentalQuoteFlow({
      pdfDataUri: dataUri,
      items: items.map((it: any) => ({ id: String(it.id), name: String(it.name), quantity: Number(it.quantity) || 1 })),
      cycleLabel: String(cycleLabel || 'Mensual'),
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[Rentals] extract-quote error:', error);
    return NextResponse.json({ error: error?.message || 'Error extrayendo la cotización.' }, { status: 500 });
  }
}
