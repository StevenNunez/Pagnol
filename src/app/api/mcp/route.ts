import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';
import { pagnolTools, runTool, ToolAccessDeniedError, type ToolCtx } from '@/ai/tools/definitions';

export const maxDuration = 30;

/**
 * Servidor MCP de Pagnol (transporte "Streamable HTTP", modo stateless: cada
 * request es independiente, responde `application/json` en vez de abrir un
 * stream SSE — suficiente para exponer herramientas de solo-lectura sin
 * necesidad de servidor→cliente push).
 *
 * Auth: Bearer token propio (`api_tokens`, ver migración 20260715000000), NO
 * la sesión Supabase — un cliente MCP externo (Claude Desktop, Claude Code)
 * no tiene sesión de navegador. El token se hashea y se busca por hash; NUNCA
 * se guarda en texto plano. Las herramientas ejecutadas son EXACTAMENTE las
 * mismas (`src/ai/tools/definitions.ts`) que usa el asistente interno, con el
 * mismo gate de tenant/permiso — un token nunca da más acceso del que ya
 * tiene el usuario que lo generó en la app.
 */

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'pagnol-mcp', version: '1.0.0' };

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: any;
}

function rpcResult(id: any, result: any) {
    return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function rpcError(id: any, code: number, message: string, status = 200) {
    return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status });
}

async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function resolveTokenCtx(req: NextRequest): Promise<ToolCtx | null> {
    const token = req.headers.get('authorization')?.replace('Bearer ', '').trim();
    if (!token) return null;

    const admin = getSupabaseAdmin();
    const hash = await sha256Hex(token);
    const { data: tokenRow } = await admin
        .from('api_tokens').select('id, tenant_id, owner_id, revoked_at')
        .eq('token_hash', hash).is('revoked_at', null).maybeSingle();
    if (!tokenRow) return null;

    const { data: profile } = await admin
        .from('profiles').select('role, granted_permissions, tenant_id')
        .eq('id', tokenRow.owner_id).single();
    if (!profile) return null;

    admin.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tokenRow.id).then();

    return {
        tenantId: tokenRow.tenant_id,
        admin,
        isSuperAdmin: profile.role === 'super-admin',
        grantedPermissions: profile.granted_permissions ?? [],
        role: profile.role,
    };
}

export async function POST(req: NextRequest) {
    const allowed = await rateLimitByIp(req, 'mcp', 120, 3600);
    if (!allowed) return rpcError(null, -32000, 'Demasiadas solicitudes.', 429);

    let body: JsonRpcRequest;
    try {
        body = await req.json();
    } catch {
        return rpcError(null, -32700, 'Parse error');
    }

    const { id, method, params } = body;

    // Notificaciones (sin id): el cliente no espera respuesta con contenido.
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
        return new NextResponse(null, { status: 202 });
    }

    if (method === 'initialize') {
        return rpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
        });
    }

    // Todo lo demás requiere un token válido.
    const ctx = await resolveTokenCtx(req);
    if (!ctx) return rpcError(id, -32001, 'Token inválido, revocado o ausente (Authorization: Bearer <token>).', 401);

    if (method === 'tools/list') {
        return rpcResult(id, {
            tools: pagnolTools.map(t => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema })),
        });
    }

    if (method === 'tools/call') {
        const toolName = params?.name;
        try {
            const result = await runTool(toolName, params?.arguments, ctx);
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (err) {
            if (err instanceof ToolAccessDeniedError) {
                return rpcResult(id, { content: [{ type: 'text', text: err.message }], isError: true });
            }
            const message = err instanceof Error ? err.message : 'Error ejecutando la herramienta.';
            return rpcResult(id, { content: [{ type: 'text', text: message }], isError: true });
        }
    }

    return rpcError(id, -32601, `Método no soportado: ${method}`);
}

export async function GET() {
    return NextResponse.json({ error: 'Este endpoint MCP solo acepta POST (Streamable HTTP, modo stateless).' }, { status: 405 });
}
