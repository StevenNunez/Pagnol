import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/modules/core/lib/admin';
import { requireAuth, resolveTenant } from '@/modules/core/lib/api-auth';
import { encryptSecret } from '@/modules/core/lib/crypto';

export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request, { roles: ['administrador'] });
        if (!auth.ok) return auth.response;
        const { ctx } = auth;

        const body = await request.json();
        const { erp, credentials, tenantId: bodyTenantId } = body;

        // El tenant lo fija el perfil del llamante (super-admin puede cross-tenant).
        const tenantId = resolveTenant(ctx, bodyTenantId);

        if (!erp || !credentials || !tenantId) {
            return NextResponse.json({ error: 'Faltan parámetros obligatorios' }, { status: 400 });
        }

        let connectionResult;

        if (erp === 'defontana') {
            // 1. Authenticate with De Fontana
            // Note: In a real scenario, we might need more headers or specific body format
            const authResponse = await fetch('https://api.defontana.com/api/Token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: credentials.clientId,
                    password: credentials.clientSecret
                })
            });

            if (!authResponse.ok) {
                const errorData = await authResponse.json().catch(() => ({}));
                return NextResponse.json({
                    error: 'Credenciales de De Fontana inválidas o error de red',
                    details: errorData
                }, { status: 401 });
            }

            connectionResult = await authResponse.json();

            // 2. Guardar credenciales con los secretos CIFRADOS en reposo (AES-256-GCM).
            //    clientId no es secreto; clientSecret y accessToken sí → se cifran.
            let encryptedSecret: string;
            let encryptedToken: string | null;
            try {
                encryptedSecret = encryptSecret(credentials.clientSecret);
                encryptedToken = connectionResult.access_token
                    ? encryptSecret(connectionResult.access_token)
                    : null;
            } catch (encErr: any) {
                console.error('[erp-connect] cifrado no disponible:', encErr.message);
                return NextResponse.json(
                    { error: 'Cifrado de credenciales no configurado en el servidor.' },
                    { status: 500 }
                );
            }

            const { error: upsertError } = await supabaseAdmin
                .from('tenant_integrations')
                .upsert({
                    tenant_id: tenantId,
                    erp_provider: 'defontana',
                    credentials: {
                        clientId: credentials.clientId,
                        clientSecret: encryptedSecret,
                        accessToken: encryptedToken,
                        tokenExpiresAt: connectionResult.expires_at || new Date(Date.now() + 3600000).toISOString()
                    },
                    status: 'active',
                    last_sync_at: new Date().toISOString()
                }, { onConflict: 'tenant_id, erp_provider' });

            if (upsertError) {
                console.error("Supabase upsert error:", upsertError);
                return NextResponse.json({ error: 'Error al guardar la configuración en la base de datos' }, { status: 500 });
            }

        } else {
            // Mock success for other ERPs for now
            return NextResponse.json({ error: 'Proveedor ERP no soportado actualmente en producción' }, { status: 501 });
        }

        return NextResponse.json({
            success: true,
            message: 'Puente establecido correctamente',
            data: {
                provider: erp,
                status: 'active'
            }
        });

    } catch (error: any) {
        console.error("ERP Connect Error:", error);
        return NextResponse.json({ error: 'Error interno del servidor al procesar la integración' }, { status: 500 });
    }
}
