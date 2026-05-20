'use server';
/**
 * @fileOverview Generates a strategic inventory report using AI.
 */
import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { withRetry } from '@/ai/lib/retry';

const StrategicReportInputSchema = z.object({
  contextData: z.string(),
});
export type StrategicReportInput = z.infer<typeof StrategicReportInputSchema>;

export async function generateStrategicReportFlow(input: StrategicReportInput): Promise<string> {
  const { output } = await withRetry(
    () => strategicReportPrompt(input),
    { label: 'StrategicReport', maxRetries: 3, baseDelayMs: 2000 }
  );
  return output || "No se pudo generar el informe.";
}

const strategicReportPrompt = ai.definePrompt({
  name: 'strategicReportPrompt',
  model: 'googleai/gemini-2.0-flash',
  input: { schema: StrategicReportInputSchema },
  config: { maxOutputTokens: 1024 },
  prompt: `Eres un analista de operaciones mineras. Genera un informe estratégico conciso en Markdown basado en los siguientes datos de inventario.

DATOS:
{{{contextData}}}

Responde ÚNICAMENTE con estas 4 secciones en Markdown. Sé directo, sin introducción:

## 1. Resumen Ejecutivo
2-3 oraciones sobre la salud general del inventario y el valor total.

## 2. Activos Críticos (Clase A)
Lista los activos Clase A con su estado actual y el riesgo si no están disponibles.

## 3. Alertas de Stock
Lista activos con stock crítico o agotado y recomienda acción concreta (ej: "Generar OC para X").

## 4. Recomendaciones Operativas
3-5 acciones ejecutables basadas en los datos de mantenimiento y movimientos recientes.
`,
});
