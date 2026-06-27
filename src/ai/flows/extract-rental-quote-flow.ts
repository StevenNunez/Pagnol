'use server';
/**
 * @fileOverview Extrae los datos de una cotización de arriendo desde el PDF que
 * envía el arrendador, usando Gemini multimodal. Mapea cada precio del PDF al
 * ítem solicitado más parecido (por nombre) para precargar el comparador por ítem.
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { withRetry } from '@/ai/lib/retry';

const RequestedItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number(),
});

export const ExtractRentalQuoteInputSchema = z.object({
  pdfDataUri: z.string().describe('PDF de la cotización en data URI (base64).'),
  items: z.array(RequestedItemSchema).describe('Ítems solicitados en el RFQ, con su id.'),
  cycleLabel: z.string().describe('Etiqueta del ciclo de facturación (Mensual, Diario, etc.).'),
});
export type ExtractRentalQuoteInput = z.infer<typeof ExtractRentalQuoteInputSchema>;

const QuoteLineSchema = z.object({
  itemId: z.string().describe('id del ítem solicitado que mejor corresponde a esta línea del PDF. Si ninguno corresponde, usa "".'),
  matchedName: z.string().describe('Nombre del equipo tal como aparece en el PDF.'),
  pricePerPeriod: z.number().describe('Precio NETO por período (sin IVA, sin separadores de miles).'),
  quantity: z.number().describe('Cantidad cotizada para esta línea. Si no aparece, usa 1.'),
  periods: z.number().describe('Número de períodos. Si no aparece, usa 1.'),
  total: z.number().describe('Total NETO de la línea. Si no aparece, calcula pricePerPeriod * quantity * periods.'),
});

export const ExtractRentalQuoteOutputSchema = z.object({
  partyName: z.string().describe('Nombre / razón social del arrendador que emite la cotización. "" si no se detecta.'),
  availabilityDate: z.string().describe('Fecha de disponibilidad en formato YYYY-MM-DD, o "" si no aparece.'),
  validityDate: z.string().describe('Fecha de validez de la oferta en YYYY-MM-DD, o "" si no aparece.'),
  conditions: z.string().describe('Condiciones relevantes (incluye traslado/operador/combustible, etc.). "" si no hay.'),
  lines: z.array(QuoteLineSchema).describe('Una línea por cada precio de equipo encontrado en el PDF.'),
});
export type ExtractRentalQuoteOutput = z.infer<typeof ExtractRentalQuoteOutputSchema>;

export async function extractRentalQuoteFlow(
  input: ExtractRentalQuoteInput,
): Promise<ExtractRentalQuoteOutput> {
  const itemsList = input.items
    .map((it) => `- id="${it.id}" · "${it.name}" (cantidad solicitada: ${it.quantity})`)
    .join('\n');

  const promptText = `Eres un asistente de Abastecimiento. Recibirás el PDF de una cotización de ARRIENDO de equipos enviada por un arrendador, junto con la lista de equipos que solicitamos.

EQUIPOS SOLICITADOS (mapea cada precio del PDF al id más parecido por nombre):
${itemsList}

Ciclo de facturación de referencia: ${input.cycleLabel}.

INSTRUCCIONES:
- Extrae el nombre/razón social del arrendador.
- Por cada equipo cotizado en el PDF, crea una línea con: el itemId del equipo solicitado que mejor corresponde (por similitud de nombre), el nombre tal cual aparece en el PDF, el precio NETO por período, la cantidad, los períodos y el total NETO.
- Los montos son NÚMEROS sin símbolos ni separadores de miles (ej: 450000, no "$450.000"). Si el PDF muestra precios con IVA incluido, intenta usar el neto; si solo hay total con IVA, usa ese número e indícalo en conditions.
- Si un precio del PDF no corresponde a ningún equipo solicitado, igual inclúyelo con itemId="".
- Si un dato no aparece, usa "" (texto) o 1 (cantidad/períodos). NUNCA inventes precios.
- Responde SOLO con el JSON del esquema.`;

  const { output } = await withRetry(
    () => ai.generate({
      model: 'googleai/gemini-2.0-flash',
      prompt: [
        { text: promptText },
        { media: { url: input.pdfDataUri, contentType: 'application/pdf' } },
      ],
      output: { schema: ExtractRentalQuoteOutputSchema },
      config: { temperature: 0 },
    }),
    { label: 'ExtractRentalQuote', maxRetries: 2, baseDelayMs: 2000 },
  );

  if (!output) throw new Error('La IA no devolvió datos de la cotización.');
  return output;
}
