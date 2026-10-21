/**
 * Asistencia a las charlas diarias, DERIVADA de hechos (sin Supabase, testeable).
 *
 * `daily_talks.asistentes` es la lista de convocados. Quién firmó, quién faltó y
 * cómo se acreditó cada firma vive en `daily_talk_signatures` (append-only). Las
 * charlas anteriores a ese cambio traen su firma dentro del JSON: se leen como
 * «firma anterior» para no perder ninguna.
 */

export type AttendeeState = 'signed' | 'absent' | 'pending';
export type SignMethod = 'own_session' | 'face' | 'handwritten';

export const SIGN_METHOD_LABEL: Record<SignMethod | 'legacy', string> = {
    own_session: 'Desde su sesión',
    face: 'Reconocimiento facial',
    handwritten: 'Firma manuscrita',
    legacy: 'Firma anterior',
};

export interface TalkAttendeeInput {
    id: string;
    name: string;
    rut?: string;
    signed?: boolean;
    signedAt?: Date | string | null;
}

export interface TalkInput {
    id: string;
    asistentes: readonly TalkAttendeeInput[];
}

export interface SignatureFact {
    talkId: string;
    workerId: string;
    status: 'signed' | 'absent';
    method?: SignMethod | null;
    acknowledged?: boolean;
    signedAt?: Date | string | null;
    recordedByName?: string | null;
    note?: string | null;
}

export interface AttendeeView {
    id: string;
    name: string;
    rut: string;
    state: AttendeeState;
    method: SignMethod | 'legacy' | null;
    /** Confirmó expresamente que comprendió los temas (distinto de haber asistido). */
    acknowledged: boolean;
    at: Date | null;
    recordedByName: string | null;
    note: string | null;
}

export interface TalkAttendance {
    rows: AttendeeView[];
    signed: number;
    absent: number;
    pending: number;
    total: number;
}

const toDate = (v: Date | string | null | undefined) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** Agrupa los hechos por charla para no recorrer la lista entera por cada una. */
export function indexSignatures<T extends SignatureFact>(facts: readonly T[]): Map<string, T[]> {
    const by = new Map<string, T[]>();
    for (const f of facts) {
        const list = by.get(f.talkId);
        if (list) list.push(f);
        else by.set(f.talkId, [f]);
    }
    return by;
}

/**
 * Estado de cada convocado. La firma gana a la ausencia (quien faltó y llegó
 * tarde firma después); la firma anterior del JSON cuenta como firmada.
 */
export function attendanceOf(talk: TalkInput, facts: readonly SignatureFact[] = []): TalkAttendance {
    const signedBy = new Map<string, SignatureFact>();
    const absentBy = new Map<string, SignatureFact>();
    for (const f of facts) {
        if (f.talkId !== talk.id) continue;
        const target = f.status === 'signed' ? signedBy : absentBy;
        if (!target.has(f.workerId)) target.set(f.workerId, f);
    }

    const rows: AttendeeView[] = (talk.asistentes ?? []).map(a => {
        const sig = signedBy.get(a.id);
        const abs = absentBy.get(a.id);
        const base = { id: a.id, name: a.name, rut: a.rut ?? '' };
        if (sig) {
            return {
                ...base, state: 'signed', method: sig.method ?? 'legacy', acknowledged: !!sig.acknowledged,
                at: toDate(sig.signedAt), recordedByName: sig.recordedByName ?? null, note: sig.note ?? null,
            };
        }
        if (a.signed) {
            return {
                ...base, state: 'signed', method: 'legacy', acknowledged: false,
                at: toDate(a.signedAt), recordedByName: null, note: null,
            };
        }
        if (abs) {
            return {
                ...base, state: 'absent', method: null, acknowledged: false,
                at: toDate(abs.signedAt), recordedByName: abs.recordedByName ?? null, note: abs.note ?? null,
            };
        }
        return { ...base, state: 'pending', method: null, acknowledged: false, at: null, recordedByName: null, note: null };
    });

    const count = (s: AttendeeState) => rows.filter(r => r.state === s).length;
    return { rows, signed: count('signed'), absent: count('absent'), pending: count('pending'), total: rows.length };
}

/** ¿Este trabajador tiene la charla pendiente de firma? (ni firmó ni faltó) */
export function isPendingFor(talk: TalkInput, facts: readonly SignatureFact[], workerId: string): boolean {
    const mine = attendanceOf(talk, facts).rows.find(r => r.id === workerId);
    return !!mine && mine.state === 'pending';
}

/** Ids de los convocados que siguen pendientes: a quienes avisa «Notificar a los pendientes». */
export function pendingWorkerIds(talk: TalkInput, facts: readonly SignatureFact[] = []): string[] {
    return attendanceOf(talk, facts).rows.filter(r => r.state === 'pending').map(r => r.id);
}
