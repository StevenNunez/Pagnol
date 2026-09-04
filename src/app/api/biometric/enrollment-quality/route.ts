import { NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';
import { parseDescriptor, euclideanDistance, MATCH_THRESHOLD } from '@/modules/data/mutations/matchMath';
import { evaluarSeparacion } from '@/lib/enrollment-quality';

/**
 * ¿El rostro registrado de QUIEN PREGUNTA se puede confundir con el de otra
 * persona de su empresa?
 *
 * Para qué: hasta ahora, registrar el rostro guardaba la primera foto que
 * saliera, sin exigir tamaño ni varias tomas. Eso dejó registros pobres —en
 * Valar, dos personas quedaron a 0,500 de distancia, o sea confundibles entre
 * sí—. Pedirle a TODA la faena que se vuelva a registrar es carísimo; esto
 * permite pedírselo sólo a quien lo necesita.
 *
 * QUÉ DEVUELVE, Y QUÉ NO: sólo el nivel ('confundible' | 'margen_estrecho' |
 * 'bien' | 'sin_enrolar') **del propio usuario**. No devuelve la distancia ni el
 * nombre de la persona parecida, a propósito, por dos razones:
 *
 *   1. La ruta `/api/biometric/match` ya documenta que un endpoint que entrega
 *      distancias exactas es un oráculo: con 128 dimensiones bastan ~130
 *      consultas bien elegidas para despejar el vector. Un nivel de tres
 *      valores no despeja nada.
 *   2. Decirle a alguien "te pareces a Ramiro" no le sirve para nada y expone
 *      un dato de otra persona.
 *
 * Los descriptores se leen con la llave de servicio y no salen del servidor,
 * igual que en la comparación.
 */
export async function GET(req: Request) {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const tenantId = ctx.tenantId;
    if (!tenantId) {
        return NextResponse.json({ nivel: 'sin_enrolar' as const });
    }

    // El rostro registrado de quien pregunta.
    const { data: mio, error: errMio } = await ctx.admin
        .from('biometric_templates')
        .select('template')
        .eq('user_id', ctx.userId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
    if (errMio) return NextResponse.json({ error: 'No se pudo leer el registro' }, { status: 500 });

    const propio = parseDescriptor(mio?.template);
    if (!propio) return NextResponse.json({ nivel: 'sin_enrolar' as const });

    // Los del resto de su empresa, para ver a qué distancia queda del más parecido.
    const { data: otros, error: errOtros } = await ctx.admin
        .from('biometric_templates')
        .select('user_id, template')
        .eq('tenant_id', tenantId)
        .neq('user_id', ctx.userId);
    if (errOtros) return NextResponse.json({ error: 'No se pudo comparar' }, { status: 500 });

    let masCerca = Infinity;
    for (const o of otros ?? []) {
        const d = parseDescriptor(o.template);
        if (!d) continue;
        const dist = euclideanDistance(propio, d);
        if (dist < masCerca) masCerca = dist;
    }

    // Con una sola persona enrolada no hay con quién confundirse.
    if (!Number.isFinite(masCerca)) return NextResponse.json({ nivel: 'bien' as const });

    return NextResponse.json({ nivel: evaluarSeparacion(masCerca, MATCH_THRESHOLD) });
}
