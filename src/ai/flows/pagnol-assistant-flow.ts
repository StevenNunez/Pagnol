'use server';
/**
 * @fileOverview Pagnol AI — asistente conversacional con acceso real a los
 * datos del tenant vía tool-calling (ver src/ai/tools/). El modelo decide qué
 * consultar; el servidor ejecuta las consultas reales, acotadas por tenant y
 * por permiso.
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { withRetry } from '@/ai/lib/retry';
import { genkitPagnolTools, type PagnolAiContext } from '@/ai/tools/genkit-tools';

const MessageSchema = z.object({
    role: z.enum(['user', 'model']),
    content: z.string(),
});

const PagnolAssistantInputSchema = z.object({
    question: z.string(),
    history: z.array(MessageSchema).default([]),
    userName: z.string(),
    tenantId: z.string(),
    isSuperAdmin: z.boolean(),
    grantedPermissions: z.array(z.string()),
    role: z.string(),
});
export type PagnolAssistantInput = z.infer<typeof PagnolAssistantInputSchema>;

const PagnolAssistantOutputSchema = z.object({
    answer: z.string().describe('Respuesta en Markdown para el usuario.'),
});
export type PagnolAssistantOutput = z.infer<typeof PagnolAssistantOutputSchema>;

export async function askPagnol(input: PagnolAssistantInput): Promise<PagnolAssistantOutput> {
    return pagnolAssistantFlow(input);
}

const SYSTEM_PROMPT = `Eres **PAGNOL AI**, el asistente de operaciones de la faena para {{userName}}.

Tienes acceso a herramientas que consultan los datos REALES del tenant (stock, kardex, OT, solicitudes, mantenimientos, asistencia, arriendos, pagos, personal). SIEMPRE que la pregunta requiera datos concretos, usa la herramienta correspondiente antes de responder — nunca inventes cifras ni asumas que no hay información sin haber consultado.

========================
REGLAS FUNDAMENTALES
========================
1. Usa las herramientas para CUALQUIER pregunta sobre datos (stock, solicitudes, OT, mantenimiento, asistencia, arriendos, pagos, personal). No respondas de memoria.
2. Si una herramienta devuelve { error: "ACCESO_DENEGADO" }, dile al usuario claramente que no tiene permiso para esa información — no inventes un valor alternativo.
3. Si una herramienta no encuentra resultados, dilo explícitamente. No inventes datos para rellenar.
4. Respuesta breve (máximo 150 palabras salvo que listar datos requiera más), técnica, profesional, en Markdown con **negritas** para cifras y nombres clave.
5. Prioriza señalar riesgos: stock crítico, mantenimientos vencidos, pagos vencidos, OT atrasadas.
6. Tienes memoria de la conversación (mensajes previos) — úsala para preguntas de seguimiento ("¿y del contrato X?").`;

async function runAssistant(input: PagnolAssistantInput, model: string) {
    const context: PagnolAiContext = {
        tenantId: input.tenantId,
        isSuperAdmin: input.isSuperAdmin,
        grantedPermissions: input.grantedPermissions,
        role: input.role,
    };

    const messages = [
        ...input.history.map(m => ({ role: m.role, content: [{ text: m.content }] })),
        { role: 'user' as const, content: [{ text: input.question }] },
    ];

    // NOTA: Gemini no soporta combinar `tools` (function calling) con salida
    // estructurada (`output.schema` fuerza responseMimeType: application/json)
    // — devuelve 400 INVALID_ARGUMENT. Por eso se toma el texto plano.
    const response = await ai.generate({
        model,
        system: SYSTEM_PROMPT.replace('{{userName}}', input.userName),
        messages,
        tools: genkitPagnolTools,
        maxTurns: 6,
        context,
    });
    return { answer: response.text };
}

const pagnolAssistantFlow = ai.defineFlow(
    {
        name: 'pagnolAssistantFlow',
        inputSchema: PagnolAssistantInputSchema,
        outputSchema: PagnolAssistantOutputSchema,
    },
    async (input) => {
        try {
            return await withRetry(
                () => runAssistant(input, 'googleai/gemini-2.5-flash'),
                { label: 'PagnolAssistant', maxRetries: 3, baseDelayMs: 2000 }
            );
        } catch (err: any) {
            if (err?.status === 'UNAVAILABLE' || err?.code === 503) {
                console.warn('[PagnolAssistant] Fallback a gemini-2.0-flash por alta demanda.');
                return await runAssistant(input, 'googleai/gemini-2.0-flash');
            }
            throw err;
        }
    }
);
