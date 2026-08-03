'use server';

import 'server-only';
import { suggestMiningSafetyTalkTopic as suggestMiningSafetyTalkTopicFlow } from '@/ai/flows/safety-talk-flow';
import { generateStrategicReportFlow } from '@/ai/flows/strategic-report-flow';

// NOTA: el asistente conversacional (Pagnol AI) ya NO pasa por un server
// action abierto — vive en /api/ai/assistant (requireAuth + resolveTenant +
// rate limit). Ver src/components/assistant/inventory-assistant.tsx.

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
