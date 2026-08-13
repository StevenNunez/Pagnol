import { NextResponse } from 'next/server';
import { requireAuth, hasPermission, type AuthContext } from '@/modules/core/lib/api-auth';
import {
    findBestMatch,
    verifyAgainst,
    MATCH_THRESHOLD,
    DESCRIPTOR_LENGTH,
    type CandidatoEnrolado,
} from '@/modules/data/mutations/matchMath';
import type { Permission } from '@/modules/core/lib/permissions';

/**
 * Comparación biométrica del lado del servidor.
 *
 * POR QUÉ EXISTE: hasta la migración `20260816000000` el descriptor facial
 * enrolado —128 floats, dato biométrico sensible bajo la Ley 21.719— viajaba al
 * navegador para poder compararlo ahí. Peor: `profiles_select_tenant` no
 * distingue roles y la RLS de Postgres es por fila, así que CUALQUIER miembro
 * del tenant podía pedirlo por REST y bajarse la cara de sus compañeros
 * (verificado el 2026-08-12 con un token real).
 *
 * Ahora el navegador sólo extrae con `face-api` el descriptor de quien está
 * FRENTE A LA CÁMARA en ese momento y lo manda acá. La bóveda se lee con service
 * role, la comparación ocurre en el servidor y lo que vuelve es un veredicto.
 * **El template enrolado no sale del servidor por ninguna vía.**
 *
 * Efecto secundario que también importa: el umbral pasa a ser del servidor.
 * Antes vivía en un `const` del bundle, donde cualquiera con las devtools
 * abiertas podía decidir a qué distancia aceptaba una cara.
 *
 * LÍMITE CONOCIDO, dicho en voz alta: la respuesta incluye la distancia, porque
 * la evidencia de cada verificación la guarda (`biometric_verifications`) y sin
 * ella no se puede calibrar el umbral. Eso convierte al endpoint en un oráculo
 * de distancias, y un oráculo de distancias EXACTAS no se cierra con límite de
 * frecuencia: con 128 dimensiones bastan ~130 consultas bien elegidas para
 * despejar el vector por álgebra. Por eso la distancia se redondea a tres
 * decimales antes de salir (`REDONDEO`) — es toda la precisión que la evidencia
 * y la calibración usan (los números medidos son 0,427 y 0,72), y le quita al
 * oráculo unos 40 bits por consulta.
 *
 * Con el redondeo más el límite de frecuencia, reconstruir un descriptor deja de
 * ser un puñado de llamadas y pasa a ser un ataque largo, ruidoso y que exige
 * credenciales de pañol. NO es "imposible": es incomparablemente más caro que lo
 * de antes, donde el mismo dato se bajaba con un solo GET a `/rest/v1/profiles`.
 *
 * ── El padrón es el de la gente VIVA ─────────────────────────────────────────
 *
 * Las dos consultas filtran `profiles.deleted_at IS NULL` con un embed `!inner`.
 * Sin eso, el servidor identificaba contra un padrón MÁS GRANDE que el que la
 * app muestra: la colección `users` filtra los borrados (`softDelete`), la
 * bóveda no. El resultado era un callejón sin salida — el servidor devolvía un
 * `userId` que la pantalla no podía resolver, y el escaneo giraba para siempre
 * (encontrado el 2026-08-13 con un perfil soft-deleted que seguía enrolado).
 *
 * Y no es sólo un desajuste de UI: alguien dado de baja seguía siendo
 * biométricamente identificable por el sistema. Un padrón de reconocimiento
 * facial que incluye a quien ya no está es exactamente lo que la Ley 21.719
 * mira con lupa.
 */

/** Quién puede pedir una comparación: las pantallas que la usan, y nadie más. */
const PERMISOS_HABILITADOS: Permission[] = [
    'material_requests:create',   // pañol: entrega y recepción de activos
    'material_requests:authorize', // ADC resolviendo en el mismo equipo
    'pagnol:enroll_personal',      // enrolamiento y verificación de hardware
];

/**
 * Decimales que se devuelven de la distancia. Tres es exactamente la precisión
 * que el proyecto usa para hablar de esto (intra-persona 0,427; inter-persona
 * 0,72) y la que necesita la evidencia para calibrar el umbral algún día. Cada
 * decimal de más es precisión regalada al oráculo descrito arriba.
 */
const REDONDEO = 1000;

/**
 * Límite de frecuencia por usuario.
 *
 * El techo legítimo lo marca `pagnol/hardware/biometric-verification`, que
 * escanea en bucle cada 1,8 s ≈ 33 consultas por minuto mientras la pantalla
 * está abierta. 120 deja ese flujo con holgura de sobra y aun así acota el
 * sondeo automatizado.
 *
 * ⚠️ Es memoria del proceso: con varias instancias el límite es por instancia.
 * Se asume a propósito, en vez de meter una dependencia de estado compartido:
 * lo que de verdad encarece el ataque es el redondeo, no este contador.
 */
const MAX_POR_MINUTO = 120;
const VENTANA_MS = 60_000;
const historial = new Map<string, number[]>();

function excedeLimite(userId: string): boolean {
    const ahora = Date.now();
    const previos = (historial.get(userId) ?? []).filter(t => ahora - t < VENTANA_MS);
    previos.push(ahora);
    historial.set(userId, previos);

    // Higiene: sin esto el Map crece con cada usuario que pasó alguna vez.
    if (historial.size > 500) {
        for (const [k, v] of historial) {
            if (v.every(t => ahora - t >= VENTANA_MS)) historial.delete(k);
        }
    }

    return previos.length > MAX_POR_MINUTO;
}

interface Body {
    mode?: '1:1' | '1:N';
    descriptor?: unknown;
    userId?: string;
}

/** Recorta la precisión de las distancias antes de que salgan del servidor. */
function redondearDistancias<T extends { distance: number | null; runnerUpDistance: number | null }>(r: T): T {
    return {
        ...r,
        distance: r.distance === null ? null : Math.round(r.distance * REDONDEO) / REDONDEO,
        runnerUpDistance:
            r.runnerUpDistance === null ? null : Math.round(r.runnerUpDistance * REDONDEO) / REDONDEO,
    };
}

/** Valida el descriptor vivo antes de gastar una consulta a la bóveda. */
function leerDescriptor(valor: unknown): number[] | null {
    if (!Array.isArray(valor) || valor.length !== DESCRIPTOR_LENGTH) return null;
    for (const n of valor) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    }
    return valor as number[];
}

export async function POST(req: Request) {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const ctx: AuthContext = auth.ctx;

    if (!PERMISOS_HABILITADOS.some(p => hasPermission(ctx, p))) {
        return NextResponse.json({ error: 'No autorizado para verificar identidad.' }, { status: 403 });
    }

    if (excedeLimite(ctx.userId)) {
        return NextResponse.json(
            { error: 'Demasiadas verificaciones seguidas. Espera un momento.' },
            { status: 429 },
        );
    }

    let body: Body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    const live = leerDescriptor(body.descriptor);
    if (!live) {
        return NextResponse.json(
            { error: `El descriptor debe ser un arreglo de ${DESCRIPTOR_LENGTH} números.` },
            { status: 400 },
        );
    }

    // El tenant SIEMPRE sale del perfil del llamante, nunca del cuerpo: es el
    // Artículo 1 del manifiesto y acá el dato en juego es la cara de la gente.
    const tenantId = ctx.tenantId;
    if (!tenantId && !ctx.isSuperAdmin) {
        return NextResponse.json({ error: 'Usuario sin empresa asignada.' }, { status: 403 });
    }

    try {
        if (body.mode === '1:1') {
            if (!body.userId) {
                return NextResponse.json({ error: 'Falta el usuario a verificar.' }, { status: 400 });
            }

            // El `eq('tenant_id')` es la puerta: sin él, conocer un uuid ajeno
            // —y los uuid del propio tenant son visibles— alcanzaría para
            // verificar contra el padrón de otra empresa.
            let q = ctx.admin
                .from('biometric_templates')
                .select('user_id, template, profiles!inner(deleted_at)')
                .eq('user_id', body.userId)
                .is('profiles.deleted_at', null);
            if (!ctx.isSuperAdmin) q = q.eq('tenant_id', tenantId);

            const { data, error } = await q.maybeSingle();
            if (error) {
                console.error('[biometric/match] 1:1', error.message);
                return NextResponse.json({ error: 'Error al verificar.' }, { status: 500 });
            }

            const resultado = verifyAgainst(live, data?.template ?? null, MATCH_THRESHOLD);
            return NextResponse.json(
                redondearDistancias({ ...resultado, userId: data ? body.userId : null }),
            );
        }

        let q = ctx.admin
            .from('biometric_templates')
            .select('user_id, template, profiles!inner(deleted_at)')
            .is('profiles.deleted_at', null);
        if (!ctx.isSuperAdmin) q = q.eq('tenant_id', tenantId);

        const { data, error } = await q;
        if (error) {
            console.error('[biometric/match] 1:N', error.message);
            return NextResponse.json({ error: 'Error al identificar.' }, { status: 500 });
        }

        const candidatos: CandidatoEnrolado[] = (data ?? []).map(r => ({
            userId: r.user_id as string,
            template: r.template as string,
        }));

        return NextResponse.json(redondearDistancias(findBestMatch(live, candidatos, MATCH_THRESHOLD)));
    } catch (err: any) {
        console.error('[biometric/match]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
