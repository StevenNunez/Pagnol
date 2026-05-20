'use server';
/**
 * @fileOverview Pagnol AI assistant for providing inventory insights.
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { withRetry } from '@/ai/lib/retry';

// Input Schema
const PagnolAssistantInputSchema = z.object({
  question: z.string(),
  contextData: z.string(),
});
export type PagnolAssistantInput = z.infer<typeof PagnolAssistantInputSchema>;

// Output Schema
export type PagnolDecision = z.infer<typeof PagnolDecisionSchema>;
const PagnolDecisionSchema = z.object({
  hasCriticalStock: z.boolean().describe("True si algún repuesto o material tiene stock <= 10."),
  criticalMaterials: z.array(z.object({
    name: z.string().describe("Nombre del material crítico."),
    stock: z.number().describe("Stock actual del material."),
    unit: z.string().nullable().optional().describe("Unidad de medida."),
  })).describe("SOLO materiales críticos."),
  recommendedActions: z.array(z.string()).describe("Acciones claras y ejecutables (ej: \"Generar orden de compra para Rodamientos 6204\")."),
});


const PagnolAssistantOutputSchema = z.object({
  answer: z.string().describe("Respuesta en formato Markdown para el usuario, sin incluir el bloque de decisión."),
  decisions: z.string().nullable().describe("Un objeto JSON como string que contiene el análisis estructurado, o null si no se aplica. El JSON debe seguir este esquema: { hasCriticalStock: boolean, criticalMaterials: [{ name: string, stock: number, unit: string | null }], recommendedActions: string[] }"),
});
export type PagnolAssistantOutput = z.infer<typeof PagnolAssistantOutputSchema>;

// The wrapper function to be called from server actions
export async function askPagnol(input: PagnolAssistantInput): Promise<PagnolAssistantOutput> {
  return pagnolAssistantFlow(input);
}

const pagnolAssistantPromptFallback = ai.definePrompt({
  name: 'pagnolAssistantPromptFallback',
  model: 'googleai/gemini-2.0-flash',
  input: { schema: PagnolAssistantInputSchema },
  output: { schema: PagnolAssistantOutputSchema },
  prompt: `Eres **PAGNOL**, un asistente experto en gestión de activos y operaciones mineras.

Tu función es:
1. Analizar el contexto de la faena (inventario, solicitudes, etc.).
2. Responder la pregunta del usuario de forma técnica, muy breve (máximo 120 palabras), profesional y concisa.
3. Usa formato Markdown y **negritas** para resaltar datos clave como nombres de materiales, cantidades o alertas importantes.
4. Generar una estructura de datos interna para la toma de decisiones.

========================
REGLAS FUNDAMENTALES
========================
1. Usa ÚNICAMENTE los datos entregados en el contexto. No inventes datos.
2. Si falta información, indícalo explícitamente en tu respuesta de texto.
3. Prioriza la detección de riesgos (ej: stock crítico, equipos en mantenimiento).
4. Tu respuesta debe ser estructurada. Debes proveer tanto la respuesta de texto (answer) como la estructura de datos de decisión (decisions).

========================
CONTEXTO DE LA OPERACIÓN
========================
{{{contextData}}}
========================

Pregunta del usuario:
"{{{question}}}"

Analiza la pregunta y el contexto, y genera la respuesta estructurada.`,
});

const pagnolAssistantPrompt = ai.definePrompt({
  name: 'pagnolAssistantPrompt',
  model: 'googleai/gemini-2.5-flash',
  input: { schema: PagnolAssistantInputSchema },
  output: { schema: PagnolAssistantOutputSchema },
  prompt: `Eres **PAGNOL**, un asistente experto en gestión de activos y operaciones mineras.

Tu función es:
1. Analizar el contexto de la faena (inventario, solicitudes, etc.).
2. Responder la pregunta del usuario de forma técnica, muy breve (máximo 120 palabras), profesional y concisa.
3. Usa formato Markdown y **negritas** para resaltar datos clave como nombres de materiales, cantidades o alertas importantes.
4. Generar una estructura de datos interna para la toma de decisiones.

========================
REGLAS FUNDAMENTALES
========================
1. Usa ÚNICAMENTE los datos entregados en el contexto. No inventes datos.
2. Si falta información, indícalo explícitamente en tu respuesta de texto.
3. Prioriza la detección de riesgos (ej: stock crítico, equipos en mantenimiento).
4. Tu respuesta debe ser estructurada. Debes proveer tanto la respuesta de texto (answer) como la estructura de datos de decisión (decisions).

========================
CONTEXTO DE LA OPERACIÓN
========================
{{{contextData}}}
========================

Pregunta del usuario:
"{{{question}}}"

Analiza la pregunta y el contexto, y genera la respuesta estructurada.`,
});

const pagnolAssistantFlow = ai.defineFlow(
  {
    name: 'pagnolAssistantFlow',
    inputSchema: PagnolAssistantInputSchema,
    outputSchema: PagnolAssistantOutputSchema,
  },
  async (input) => {
    try {
      const { output } = await withRetry(
        () => pagnolAssistantPrompt(input),
        { label: 'PagnolAssistant', maxRetries: 3, baseDelayMs: 2000 }
      );
      return output!;
    } catch (err: any) {
      if (err?.status === 'UNAVAILABLE' || err?.code === 503) {
        console.warn('[PagnolAssistant] Fallback a gemini-2.0-flash por alta demanda.');
        const { output } = await pagnolAssistantPromptFallback(input);
        return output!;
      }
      throw err;
    }
  }
);
