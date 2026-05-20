'use server';
/**
 * @fileOverview Suggests a mining safety talk topic.
 */
import { ai } from '@/ai/genkit';
import { withRetry } from '@/ai/lib/retry';

export async function suggestMiningSafetyTalkTopic(): Promise<string> {
  const { output } = await withRetry(
    () => safetyTalkPrompt(),
    { label: 'SafetyTalk', maxRetries: 3, baseDelayMs: 2000 }
  );
  return (output || "No se pudo generar un tema.").replace(/"/g, '');
}

const safetyTalkPrompt = ai.definePrompt({
  name: 'safetyTalkPrompt',
  model: 'googleai/gemini-2.5-flash',
  prompt: `Eres un experto en prevención de riesgos para la minería en Chile. 
Sugiere un tema específico y conciso para una "charla de 5 minutos". 
El tema debe ser relevante para una faena minera y práctico para un equipo en terreno.
Dame solo el título del tema, sin explicaciones adicionales. Máximo 15 palabras.
Ejemplo: "Uso correcto de bloqueadores en equipos energizados" o "Riesgos de atropello en áreas de carguío".`,
});
