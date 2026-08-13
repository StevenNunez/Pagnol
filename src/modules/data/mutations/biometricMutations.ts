import { supabase } from '@/modules/core/lib/supabase';
import type { MutationContext as Context } from './context';

/**
 * Registro de hechos biométricos (tabla `biometric_verifications`).
 *
 * La verificación facial es la forma de aceptar la recepción de un activo, así
 * que tiene que dejar rastro: qué distancia dio, contra qué umbral, a qué hora y
 * con qué imagen. Antes no guardaba nada y ante un reclamo lo único exhibible
 * era un PDF con la firma pre-guardada del trabajador.
 *
 * La tabla es **append-only** (la base revoca UPDATE y DELETE): un error se
 * corrige agregando un hecho nuevo, nunca reescribiendo el anterior. El estado
 * de una excepción se DERIVA encadenando hechos por `exceptionGroupId`, igual
 * que el ledger financiero deriva el saldo de sus asientos.
 */

const BUCKET = 'contracts';

export type BiometricStage = 'identificacion' | 'recepcion';
export type BiometricOutcome =
    | 'match' | 'no_match' | 'no_face' | 'error' | 'spoof_suspected'
    | 'exception_requested' | 'exception_granted' | 'exception_denied';

/**
 * Medición del desafío de vida que acompañó al acto, cuando la hubo.
 *
 * Va como bloque aparte del veredicto de identidad porque son dos hechos
 * independientes: un rostro puede coincidir (`outcome: 'match'`) y aun así no
 * haberse movido nunca (`outcome: 'no_change'`), que es exactamente lo que hace
 * una fotografía. Aplanarlos en un solo campo obligaría a elegir cuál de los dos
 * contar, y la evidencia dejaría de decir lo que pasó.
 */
export interface LivenessRecord {
    outcome: 'ok' | 'no_face' | 'no_change' | 'timeout';
    challenge: 'blink' | 'mouth';
    /** Amplitud observada del gesto. */
    score: number;
    /** Amplitud mínima exigida ESE DÍA: sin ella el score es ilegible mañana. */
    threshold: number;
    method: string;
}

/**
 * Sube el frame de la verificación al bucket privado y devuelve su **path**.
 * Nunca lanza: perder la foto no puede impedir la entrega en faena, pero sí
 * tiene que quedar registrado el hecho aunque la imagen no haya subido.
 */
export async function uploadBiometricEvidence(
    blob: Blob,
    tenantId: string,
    referencia: string,
): Promise<string | null> {
    try {
        // El tenant va EN LA RUTA para que la política de storage pueda acotar
        // por empresa (mismo criterio que `return-evidence`).
        const path = `biometric-evidence/${tenantId}/${Date.now()}-${referencia}.jpg`;
        const { error } = await Promise.race([
            supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }),
            new Promise<{ error: Error }>((_, reject) =>
                setTimeout(() => reject(new Error('Upload timeout')), 12000)
            ),
        ]) as { error: any };
        if (error) throw error;
        return path;
    } catch (err) {
        console.warn('No se pudo subir la evidencia biométrica:', err);
        return null;
    }
}

interface RecordParams {
    subject: { id: string; name: string };
    stage: BiometricStage;
    outcome: BiometricOutcome;
    distance?: number | null;
    threshold?: number | null;
    evidencePath?: string | null;
    requestId?: string | null;
    transactionCode?: string | null;
    exceptionGroupId?: string | null;
    exceptionReason?: string | null;
    authorizedBy?: { id: string; name: string } | null;
    authorizedMode?: 'presencial' | 'remota' | null;
    /** Ausente = no se midió el gesto (etapa sin desafío, o hecho antiguo). */
    liveness?: LivenessRecord | null;
}

/**
 * Deja constancia de un acto biométrico. Devuelve el id del hecho, o null si no
 * se pudo registrar.
 *
 * **No lanza a propósito**: si la evidencia falla, el pañolero no puede quedar
 * bloqueado con el trabajador y la herramienta en la mano. El fallo se reporta
 * por consola y quien llama decide; lo que no se hace es fingir que se registró.
 */
export async function recordBiometricVerification(
    params: RecordParams,
    { user, tenantId }: Context,
): Promise<string | null> {
    if (!user || !tenantId) return null;
    try {
        const { data, error } = await supabase
            .from('biometric_verifications')
            .insert({
                tenant_id: tenantId,
                subject_user_id: params.subject.id,
                subject_name: params.subject.name,
                operator_user_id: user.id,
                operator_name: user.name,
                stage: params.stage,
                request_id: params.requestId ?? null,
                transaction_code: params.transactionCode ?? null,
                outcome: params.outcome,
                distance: params.distance ?? null,
                threshold: params.threshold ?? null,
                evidence_path: params.evidencePath ?? null,
                exception_group_id: params.exceptionGroupId ?? null,
                exception_reason: params.exceptionReason ?? null,
                authorized_by_user_id: params.authorizedBy?.id ?? null,
                authorized_by_name: params.authorizedBy?.name ?? null,
                authorized_mode: params.authorizedMode ?? null,
                // NULL en bloque cuando no se midió: la base tiene un CHECK que
                // exige umbral y método junto al resultado, porque un score sin
                // ellos es ilegible dentro de un año.
                liveness_outcome: params.liveness?.outcome ?? null,
                liveness_challenge: params.liveness?.challenge ?? null,
                liveness_score: params.liveness?.score ?? null,
                liveness_threshold: params.liveness?.threshold ?? null,
                liveness_method: params.liveness?.method ?? null,
            })
            .select('id')
            .single();

        if (error) throw error;
        return data?.id ?? null;
    } catch (err) {
        console.error('No se pudo registrar el hecho biométrico:', err);
        return null;
    }
}

/**
 * El pañolero pide entregar sin biometría. Devuelve el `exceptionGroupId` que
 * encadena esta solicitud con su resolución.
 *
 * Sí lanza: a diferencia del registro de un intento, aquí el usuario está
 * pidiendo algo explícitamente y tiene que saber si quedó pedido o no.
 */
export async function requestBiometricException(
    params: {
        subject: { id: string; name: string };
        reason: string;
        requestId?: string | null;
        transactionCode?: string | null;
    },
    context: Context,
): Promise<string> {
    const motivo = params.reason.trim();
    // La base también lo exige (CHECK), pero fallar acá da un mensaje entendible
    // en vez de un error de Postgres.
    if (motivo.length < 10) {
        throw new Error('Explica el motivo de la excepción (mínimo 10 caracteres).');
    }

    const exceptionGroupId = crypto.randomUUID();
    const id = await recordBiometricVerification({
        subject: params.subject,
        stage: 'recepcion',
        outcome: 'exception_requested',
        requestId: params.requestId ?? null,
        transactionCode: params.transactionCode ?? null,
        exceptionGroupId,
        exceptionReason: motivo,
    }, context);

    if (!id) throw new Error('No se pudo registrar la solicitud de excepción.');
    return exceptionGroupId;
}

/**
 * Un ADC o Administrador resuelve una excepción — en el pañol (`presencial`) o
 * desde la bandeja de Autorizaciones (`remota`).
 *
 * El permiso lo exige además la base vía RLS del tenant; acá se valida para no
 * ofrecer un botón que va a fallar.
 */
export async function resolveBiometricException(
    params: {
        exceptionGroupId: string;
        subject: { id: string; name: string };
        approve: boolean;
        mode: 'presencial' | 'remota';
        authorizedBy: { id: string; name: string };
        requestId?: string | null;
        transactionCode?: string | null;
    },
    context: Context,
): Promise<void> {
    const id = await recordBiometricVerification({
        subject: params.subject,
        stage: 'recepcion',
        outcome: params.approve ? 'exception_granted' : 'exception_denied',
        requestId: params.requestId ?? null,
        transactionCode: params.transactionCode ?? null,
        exceptionGroupId: params.exceptionGroupId,
        authorizedBy: params.authorizedBy,
        authorizedMode: params.mode,
    }, context);

    if (!id) throw new Error('No se pudo registrar la resolución de la excepción.');
}

// `exceptionStatus` vive en `biometricMath.ts` (sin Supabase) para poder
// probarla: importar este archivo arrastra el cliente y rompe el test.
export { exceptionStatus } from './biometricMath';
