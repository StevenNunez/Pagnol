import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';
import { askPagnol } from '@/ai/flows/pagnol-assistant-flow';

export const maxDuration = 60;

const MAX_HISTORY = 12; // últimos N mensajes (evita que el contexto crezca sin límite)
const MAX_QUESTION_LEN = 2000;

/**
 * Endpoint del asistente Pagnol AI. Requiere sesión (cualquier rol puede
 * conversar con el asistente); las herramientas individuales gatean datos
 * sensibles (pagos, arriendos) por permiso — ver src/ai/tools/definitions.ts.
 * El tenant SIEMPRE viene de la sesión autenticada, nunca del body.
 */
export async function POST(req: NextRequest) {
    try {
        const auth = await requireAuth(req);
        if (!auth.ok) return auth.response;
        const { ctx } = auth;

        const allowed = await rateLimitByIp(req, 'ai-assistant', 30, 3600);
        if (!allowed) {
            return NextResponse.json({ error: 'Demasiadas consultas. Intenta en unos minutos.' }, { status: 429 });
        }

        if (!ctx.tenantId) {
            return NextResponse.json({ error: 'Usuario sin tenant asignado.' }, { status: 403 });
        }

        const body = await req.json().catch(() => null);
        const question = typeof body?.question === 'string' ? body.question.trim() : '';
        if (!question) {
            return NextResponse.json({ error: 'La pregunta no puede estar vacía.' }, { status: 400 });
        }
        if (question.length > MAX_QUESTION_LEN) {
            return NextResponse.json({ error: 'Pregunta demasiado larga.' }, { status: 400 });
        }

        const rawHistory = Array.isArray(body?.history) ? body.history : [];
        const history = rawHistory
            .filter((m: any) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'model'))
            .slice(-MAX_HISTORY)
            .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_QUESTION_LEN) }));

        const { data: profile } = await ctx.admin.from('profiles').select('name').eq('id', ctx.userId).single();

        const result = await askPagnol({
            question,
            history,
            userName: profile?.name?.split(' ')[0] || 'Usuario',
            tenantId: ctx.tenantId,
            isSuperAdmin: ctx.isSuperAdmin,
            grantedPermissions: ctx.grantedPermissions,
            role: ctx.role,
        });

        return NextResponse.json({ answer: result.answer });
    } catch (error: any) {
        console.error('[api/ai/assistant] error:', error?.message || error);
        return NextResponse.json({ error: 'Ocurrió un error al consultar al asistente.' }, { status: 500 });
    }
}
