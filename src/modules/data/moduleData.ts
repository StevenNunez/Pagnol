import type { AppDataState } from './types';

/**
 * RFC-005 F2 — Qué colecciones necesita cada módulo de `/dashboard`.
 *
 * Antes, entrar a cualquier página cargaba las 53 colecciones. Un pañolero que
 * abría Movimientos esperaba, entre otras cosas, por los finiquitos, los
 * protocolos de calidad y el catálogo de arriendos.
 *
 * ## Esto es una OPTIMIZACIÓN, no una garantía
 *
 * Si un módulo lee una colección que no está declarada aquí, **no se rompe**:
 * `useAppState()` detecta el acceso, la activa al vuelo y —en desarrollo— avisa
 * por consola con el nombre exacto que hay que agregar (ver `useData.ts`).
 *
 * Esa red de seguridad es deliberada y es la parte que no se puede quitar. Una
 * lista paralela al código se desincroniza tarde o temprano, y sin la red el
 * síntoma sería el peor posible: la página muestra **cero filas en silencio**,
 * sin error en consola. Es la forma exacta del drift de esquema que ya mordió
 * siete veces en este proyecto, pero sin el error que al menos delataba a aquél.
 *
 * ## Cómo mantenerlo
 *
 * Al agregar un `useAppState()` a una página, agregá su colección al módulo
 * correspondiente. Si te olvidás, la consola te lo va a decir en desarrollo.
 *
 * La lista original se **generó midiendo** el cierre transitivo de imports de
 * las 177 páginas de `/dashboard`, no se escribió a mano.
 */
export type CollectionName = Exclude<
    keyof AppDataState,
    'isLoading' | 'roles' | 'subscriptionPlans'
>;

/**
 * Todas las colecciones que existen, para el chequeo en runtime de la red de
 * seguridad.
 *
 * **No se deriva del manifiesto a propósito.** Si se derivara de
 * `Object.values(MODULE_DATA).flat()`, una colección que ningún módulo declare
 * quedaría fuera de la lista y por lo tanto **sin protección** — justo el caso
 * en que más falta hace. El `_exhaustive` de abajo hace que `tsc` falle si se
 * agrega una colección al estado y se olvida acá.
 */
export const ALL_COLLECTIONS = [
    'users', 'materials', 'requests', 'returnRequests', 'purchaseRequests',
    'suppliers', 'materialCategories', 'units', 'purchaseLots', 'purchaseOrders',
    'quoteRequests', 'goodsReceipts', 'costCenters', 'supplierPayments',
    'salaryAdvances', 'attendanceLogs', 'assignedChecklists', 'biometricVerifications', 'safetyInspections',
    'checklistTemplates', 'behaviorObservations', 'stockMovements', 'workItems',
    'progressLogs', 'paymentStates', 'dailyTalks', 'maintenanceOrders',
    'maintenanceLogs', 'eaDocuments', 'protocolTemplates', 'protocols',
    'shiftSchedules', 'clients', 'contracts', 'contractWorkers', 'rentalParties',
    'rentalContracts', 'rentalAssets', 'rentalPayments', 'rentalRequests',
    'rentalQuoteRequests', 'rentalCategories', 'workReports', 'leaveRequests',
    'hrDocuments', 'warehouses', 'warehouseContracts', 'materialStocks',
    'workReportAreas', 'workReportSpecialties', 'workReportMilestones',
    'workReportCatalogs', 'workOrders', 'workWeeklyReports',
] as const satisfies readonly CollectionName[];

// Falla la compilación si `AppDataState` gana una colección que no está arriba.
type _Missing = Exclude<CollectionName, (typeof ALL_COLLECTIONS)[number]>;
const _exhaustive: _Missing extends never ? true : ['Falta en ALL_COLLECTIONS:', _Missing] = true;
void _exhaustive;

/**
 * Clave = primer segmento de la ruta bajo `/dashboard`.
 *
 * Los módulos con lista vacía no consumen estado global y es correcto:
 * `bodega` son redirects a `pagnol` (fusión de 2026-07-02), y `dte`,
 * `super-admin`, `subscriptions`, `permissions` y `cphs` leen por su cuenta
 * (Supabase directo, `useAuth`, o constantes locales).
 */
export const MODULE_DATA: Record<string, readonly CollectionName[]> = {
    'abastecimiento': [
        'costCenters', 'goodsReceipts', 'materialCategories', 'materials',
        'purchaseLots', 'purchaseOrders', 'purchaseRequests', 'quoteRequests',
        'rentalQuoteRequests', 'rentalRequests', 'salaryAdvances',
        'supplierPayments', 'suppliers', 'units', 'users',
    ],
    'attendance': [
        'attendanceLogs', 'clients', 'contractWorkers', 'contracts',
        'costCenters', 'shiftSchedules', 'users',
    ],
    'authorizations': [
        'biometricVerifications',
        'materials', 'purchaseRequests', 'rentalRequests', 'requests', 'users',
    ],
    'bodega': [],
    'configuracion': [
        'clients', 'contractWorkers', 'contracts', 'costCenters',
    ],
    'construction-control': [
        'contracts', 'progressLogs', 'protocolTemplates', 'protocols', 'users',
        'workItems',
    ],
    'cphs': [],
    'dte': [],
    'estado-pago': [
        'paymentStates', 'progressLogs', 'workItems',
    ],
    'finanzas': [
        'attendanceLogs', 'contracts', 'users',
    ],
    'pagnol': [
        'biometricVerifications',
        'clients', 'contractWorkers', 'contracts', 'eaDocuments',
        'maintenanceLogs', 'maintenanceOrders', 'materialCategories',
        'materialStocks', 'materials', 'purchaseRequests', 'rentalRequests',
        'requests', 'returnRequests', 'shiftSchedules', 'suppliers', 'units',
        'users', 'warehouseContracts', 'warehouses',
    ],
    'payments': [
        'materialCategories', 'purchaseOrders', 'salaryAdvances',
        'supplierPayments', 'suppliers',
    ],
    'permissions': [],
    'profile': [
        'attendanceLogs', 'clients', 'contractWorkers', 'contracts',
        'shiftSchedules', 'users',
    ],
    'purchasing': [
        'clients', 'contractWorkers', 'contracts', 'materialCategories',
        'materials', 'purchaseLots', 'purchaseOrders', 'purchaseRequests',
        'rentalCategories', 'rentalRequests', 'supplierPayments', 'suppliers',
        'units', 'users',
    ],
    'rentals': [
        'contracts', 'materials', 'rentalAssets', 'rentalContracts',
        'rentalParties', 'rentalPayments', 'suppliers',
    ],
    'reports': [
        'clients', 'contracts', 'materialCategories', 'materialStocks',
        'materials', 'purchaseRequests', 'requests', 'returnRequests',
        'stockMovements', 'suppliers', 'units', 'users', 'warehouses',
    ],
    'rrhh': [
        'attendanceLogs', 'clients', 'contractWorkers', 'contracts',
        'costCenters', 'hrDocuments', 'leaveRequests', 'shiftSchedules', 'users',
    ],
    'safety': [
        'assignedChecklists', 'behaviorObservations', 'checklistTemplates',
        'dailyTalks', 'safetyInspections', 'users',
    ],
    'subscriptions': [],
    'super-admin': [],
    'supervisor': [
        'clients', 'contractWorkers', 'contracts', 'materialCategories',
        'materialStocks', 'materials', 'purchaseRequests', 'rentalCategories',
        'rentalRequests', 'requests', 'returnRequests', 'suppliers', 'users',
    ],
    'users': [
        'attendanceLogs', 'clients', 'contractWorkers', 'contracts',
        'shiftSchedules', 'users',
    ],
    'wallet': [
        'attendanceLogs', 'dailyTalks', 'salaryAdvances', 'users',
    ],
    'work-reports': [
        'materials', 'users', 'workOrders', 'workReportAreas',
        'workReportCatalogs', 'workReportMilestones', 'workReportSpecialties',
        'workReports', 'workWeeklyReports',
    ],
    'worker': [
        'dailyTalks',
    ],
};

/**
 * Módulo al que pertenece una ruta: el primer segmento bajo `/dashboard`.
 * `/dashboard` a secas (el hub) no consume estado global: sólo `useAuth()`.
 */
export function moduleOf(pathname: string | null | undefined): string | null {
    if (!pathname) return null;
    const m = pathname.match(/^\/dashboard\/([^/]+)/);
    return m ? m[1] : null;
}

/**
 * Colecciones que le tocan a una ruta. Una ruta desconocida devuelve la lista
 * vacía a propósito: si de verdad necesita datos, la red de seguridad los
 * activa al vuelo y lo reporta, en vez de que un módulo nuevo herede
 * silenciosamente la carga completa.
 */
export function collectionsFor(pathname: string | null | undefined): readonly CollectionName[] {
    const mod = moduleOf(pathname);
    return (mod && MODULE_DATA[mod]) || [];
}
