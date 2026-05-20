'use server';

import 'server-only';
import { askPagnol as askPagnolFlow } from '@/ai/flows/pagnol-assistant-flow';
import { suggestMiningSafetyTalkTopic as suggestMiningSafetyTalkTopicFlow } from '@/ai/flows/safety-talk-flow';
import { generateStrategicReportFlow } from '@/ai/flows/strategic-report-flow';


// The `ok` and `error` fields are added for robust error handling in the UI
export type PagnolResponse = {
  ok: boolean;
  error?: string;
  answer: string;
  decisions: any | null;
};

export async function askPagnol(
  question: string,
  contextData: string
): Promise<PagnolResponse> {
  try {
    if (!question?.trim()) {
      return {
        ok: false,
        error: 'La pregunta no puede estar vacía.',
        answer: '',
        decisions: null,
      };
    }

    // result from flow will have decisions as a string
    const result = await askPagnolFlow({ question, contextData });

    let parsedDecisions: any | null = null;
    if (result.decisions) {
      try {
        parsedDecisions = JSON.parse(result.decisions);
      } catch (parseError) {
        console.error("Error parsing AI decisions JSON:", parseError, "Raw string was:", result.decisions);
        // If parsing fails, we'll proceed with the text answer but null decisions.
      }
    }

    return {
      answer: result.answer,
      decisions: parsedDecisions,
      ok: true
    };

  } catch (error: any) {
    console.error('❌ Error en el flujo de askPagnol:', error);
    return {
      ok: false,
      error: error?.message || 'Ocurrió un error inesperado al procesar la solicitud con IA.',
      answer: '',
      decisions: null
    };
  }
}

export async function suggestMiningSafetyTalkTopic(): Promise<{ ok: boolean, answer?: string, error?: string }> {
  try {
    const topic = await suggestMiningSafetyTalkTopicFlow();
    return { ok: true, answer: topic };
  } catch (error: any) {
    console.error('❌ Error en el flujo de suggestMiningSafetyTalkTopic:', error);
    return { ok: false, error: error.message || "No se pudo generar un tema." };
  }
}

export async function generateStrategicReport(
  contextData: string
): Promise<{ ok: boolean; report?: string; error?: string }> {
  try {
    const result = await generateStrategicReportFlow({ contextData });
    return { ok: true, report: result };
  } catch (error: any) {
    console.error('❌ Error en el flujo de generateStrategicReport:', error);
    return {
      ok: false,
      error: error.message || 'Ocurrió un error al generar el informe estratégico.',
    };
  }
}
