// Clase de un retiro (A/B/C) y quién puede aprobarla. Puro: no toca la base ni React, así que
// lo comparten la mutación (que decide), la bandeja (que muestra los botones) y el menú (que
// cuenta), y se prueba solo.
//
// POR QUÉ EXISTE: la clase de un retiro se fijaba con el valor que mandara la pantalla y, si no
// mandaba ninguno, valía 'A'. La pantalla de faena nunca la mandaba: todo retiro nacía clase A
// aunque pidiera una polera clase C, y el pañolero (que sólo aprueba B y C) no veía los botones.
// La clase es un hecho de los materiales pedidos: se calcula de ellos, nunca se recibe.

export type RequestClass = 'A' | 'B' | 'C';

const RANK: Record<RequestClass, number> = { A: 3, B: 2, C: 1 };

/** Una clase válida, o 'C' (la de menor exigencia) si el material no la tiene definida. */
export function asClass(value: unknown): RequestClass {
    return value === 'A' || value === 'B' || value === 'C' ? value : 'C';
}

/** La más exigente de las clases de los materiales pedidos. Sin ítems no hay nada que exigir: 'C'. */
export function highestClassOf(classes: readonly unknown[]): RequestClass {
    return classes.map(asClass).reduce<RequestClass>((acc, c) => (RANK[c] > RANK[acc] ? c : acc), 'C');
}

/**
 * ¿Puede esta persona aprobar un retiro de la clase dada? La A exige su permiso propio; la B la
 * aprueba quien tenga B o A; la C, cualquiera de las tres.
 */
export function canApproveClass(can: (permission: any) => boolean, cls: RequestClass): boolean {
    if (cls === 'A') return can('material_requests:approve_class_a');
    if (cls === 'B') return can('material_requests:approve_class_b') || can('material_requests:approve_class_a');
    return can('material_requests:approve_class_c') || can('material_requests:approve_class_b') || can('material_requests:approve_class_a');
}

/** Los permisos que habilitan aprobar la clase dada (para avisarle a quien corresponde). */
export function permissionsToApprove(cls: RequestClass): string[] {
    if (cls === 'A') return ['material_requests:approve_class_a'];
    if (cls === 'B') return ['material_requests:approve_class_b', 'material_requests:approve_class_a'];
    return ['material_requests:approve_class_c', 'material_requests:approve_class_b', 'material_requests:approve_class_a'];
}

/** Quién puede aprobar cada clase, en palabras, para decírselo a quien no puede. */
export const WHO_APPROVES: Record<RequestClass, string> = {
    A: 'administración o el ADC',
    B: 'el pañolero, administración o el ADC',
    C: 'el pañolero, administración o el ADC',
};
