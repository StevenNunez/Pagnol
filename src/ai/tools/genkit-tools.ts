import 'server-only';
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { pagnolTools, runTool, ToolAccessDeniedError, type ToolCtx } from './definitions';

/**
 * Contexto que el flow debe pasar en `ai.generate({ context })`. Se resuelve
 * UNA vez por request (server-side, autenticado) y viaja por el `context` de
 * Genkit — nunca por el input del modelo — así el tenant nunca depende de lo
 * que el modelo "decida" pasar.
 */
export interface PagnolAiContext {
    tenantId: string;
    isSuperAdmin: boolean;
    grantedPermissions: string[];
    role: string;
}

function toolCtxFromGenkitContext(context: unknown): ToolCtx {
    const c = context as PagnolAiContext | undefined;
    if (!c?.tenantId) throw new Error('Contexto de tenant no disponible para la herramienta.');
    return {
        tenantId: c.tenantId,
        admin: getSupabaseAdmin(),
        isSuperAdmin: !!c.isSuperAdmin,
        grantedPermissions: c.grantedPermissions ?? [],
        role: c.role ?? '',
    };
}

/** Registra las tools de `definitions.ts` como tools de Genkit (una sola vez, a nivel de módulo). */
export const genkitPagnolTools = pagnolTools.map(def =>
    ai.defineTool(
        { name: def.name, description: def.description, inputSchema: def.zodInput, outputSchema: z.any() },
        async (input, options) => {
            const ctx = toolCtxFromGenkitContext(options.context);
            try {
                return await runTool(def.name, input, ctx);
            } catch (err) {
                if (err instanceof ToolAccessDeniedError) {
                    return { error: 'ACCESO_DENEGADO', mensaje: err.message };
                }
                throw err;
            }
        }
    )
);
