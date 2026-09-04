

"use client";
import React, {
    useReducer,
    useCallback,
    useEffect,
    useState,
    useMemo,
} from 'react';
import { createContainer } from 'react-tracked';
import { supabase } from '@/modules/core/lib/supabase';
import {
    User,
    UserRole,
    Tenant,
    SubscriptionPlan,
    ProgressLog,
    PaymentState,
    DailyTalk,
} from '@/modules/core/lib/data';
import {
    ROLES as ROLES_DEFAULT,
    Permission,
    PLANS,
} from '@/modules/core/lib/permissions';

import { useAuth } from "@/modules/auth/useAuth";
import { useToast } from "@/modules/core/hooks/use-toast";
import { useSupabaseCollection } from "@/modules/core/hooks/use-supabase-collection";
import { mappers } from "./mappers";
import { AppDataState, AppStateAction, AppStateContextType } from './types';
import { CollectionGateProvider, useCollectionGate } from './CollectionGate';
import { type CollectionName } from './moduleData';
import * as materialRequestMutations from './mutations/materialRequestMutations';
import * as purchaseRequestMutations from './mutations/purchaseRequestMutations';
import * as genericMutations from './mutations/genericMutations';
import * as paymentStateMutations from './mutations/paymentStateMutations';
import * as budgetMutations from './mutations/budgetMutations';
import * as periodMutations from './mutations/periodMutations';
import * as payrollMutations from './mutations/payrollMutations';
import * as payrollRunMutations from './mutations/payrollRunMutations';
import * as severanceMutations from './mutations/severanceMutations';
import * as rfqMutations from './mutations/rfqMutations';
import * as receptionMutations from './mutations/receptionMutations';
import * as costCenterMutations from './mutations/costCenterMutations';
import * as safetyMutations from './mutations/safetyMutations';
import * as attendanceMutations from './mutations/attendanceMutations';
import * as paymentMutations from './mutations/paymentMutations';
import * as maintenanceMutations from './mutations/maintenanceMutations';
import * as eaMutations from './mutations/eaMutations';
import * as protocolMutations from './mutations/protocolMutations';
import * as contractMutations from './mutations/contractMutations';
import * as warehouseMutations from './mutations/warehouseMutations';
import * as workProjectMutations from './mutations/workProjectMutations';
import type { MutationContext } from './mutations/context';
import * as rentalMutations from './mutations/rentalMutations';
import * as rentalRequestMutations from './mutations/rentalRequestMutations';
import * as workReportMutations from './mutations/workReportMutations';
import * as workReportCatalogMutations from './mutations/workReportCatalogMutations';
import * as workOrderMutations from './mutations/workOrderMutations';
import * as workWeeklyReportMutations from './mutations/workWeeklyReportMutations';
import * as hrMutations from './mutations/hrMutations';
import * as biometricMutations from './mutations/biometricMutations';

/**
 * Columnas de `profiles` que consume `mappers.profiles`, listadas a mano.
 *
 * La lista explícita nació para poder excluir `biometric_template` de los
 * módulos que no hacen reconocimiento facial. Esa columna ya no existe: el
 * descriptor vive en la bóveda `biometric_templates` y no sale del servidor
 * (migración 20260816000000). Lo que viaja ahora es `biometric_enrolled`, un
 * booleano — así que la distinción por módulo dejó de tener sentido y se retiró.
 * La lista explícita se conserva porque sigue evitando el `select=*`.
 *
 * `deleted_at` no hace falta: el `softDelete` del hook filtra server-side.
 *
 * 🔴 `signature` NO va acá, y no es un olvido. Es un PNG en base64 y domina el
 * peso de la colección: medido contra la base real, **89,4% del promedio de
 * todas las filas** y **41% del payload del tenant con más gente** (donde no
 * todos están enrolados todavía — la proporción sube a medida que enrolan).
 * Y `users` se carga en casi todos los módulos, así que cada carga de página
 * arrastra las firmas de toda la empresa para dibujar, como mucho, una.
 * Quien la necesita la pide por fila con `useRecordFields` / `fetchRecordFields`
 * (`src/modules/core/hooks/use-record-fields.ts`) — que existe exactamente para
 * esto. Si aparece un consumidor nuevo, el camino es ése, no volver a meterla
 * en la lista.
 *
 * ⚠️ Si se agrega un campo nuevo a `mappers.profiles`, hay que agregarlo aquí o
 * llegará `undefined` **en silencio** — `tsc` no lo detecta. (`signature` es la
 * excepción deliberada de arriba: llega `undefined` a propósito.)
 */
const PROFILE_COLUMNS = [
    'id', 'name', 'email', 'role', 'qr_code', 'tenant_id', 'rut', 'internal_id',
    'cargo', 'phone', 'fecha_ingreso', 'base_salary', 'afp', 'tipo_salud',
    'cargas_familiares', 'enrolled_by', 'enrolled_at',
    'onboarding_completed', 'granted_permissions', 'address', 'birth_date',
    'emergency_contact_name', 'emergency_contact_phone', 'employment_status',
    'biometric_enrolled',
].join(', ');

/**
 * Columnas de `materials`, explícitas por el mismo motivo que PROFILE_COLUMNS:
 * es la colección más pesada del sistema (medido: 5.000 filas ≈ 4,78 MB en el
 * tenant más grande) y `select=*` traía además `tenant_id`, `created_at`,
 * `updated_at` y `deleted_at`, que ningún consumidor lee — el mapper de
 * `mappers.materials` no los toca.
 *
 * En una tabla de 39 columnas eso no es sólo el dato: PostgREST repite el
 * nombre de cada columna en cada objeto del JSON, y esos nombres son ~55% del
 * peso transferido.
 *
 * ⚠️ Misma regla que profiles: campo nuevo en `mappers.materials` ⇒ campo nuevo
 * acá, o llega `undefined` en silencio y `tsc` no lo ve.
 */
const MATERIAL_COLUMNS = [
    'id', 'name', 'stock', 'in_use', 'min_stock', 'unit', 'category',
    'supplier_id', 'archived', 'criticality', 'usage_type', 'description',
    'unit_cost', 'acquisition_date', 'serial_number', 'status', 'photos',
    'requires_maintenance', 'next_maintenance_date', 'is_it_asset',
    'internal_code', 'location', 'brand', 'technical_sheet_url',
    'technical_sheet_name', 'condition_score', 'failure_probability',
    'failure_impact', 'parent_id', 'ownership', 'rental_contract_id',
    'rental_asset_id', 'client_id',
].join(', ');

const initialState: AppDataState = {
    isLoading: true,
    roles: ROLES_DEFAULT,
    subscriptionPlans: PLANS,
    users: [],
    materials: [],
    requests: [],
    returnRequests: [],
    purchaseRequests: [],
    suppliers: [],
    materialCategories: [],
    units: [],
    purchaseLots: [],
    purchaseOrders: [],
    quoteRequests: [],
    goodsReceipts: [],
    costCenters: [],
    supplierPayments: [],
    salaryAdvances: [],
    attendanceLogs: [],
    assignedChecklists: [],
    biometricVerifications: [],
    safetyInspections: [],
    checklistTemplates: [],
    behaviorObservations: [],
    stockMovements: [],
    workProjects: [],
    workItems: [],
    progressLogs: [],
    paymentStates: [],
    dailyTalks: [],
    maintenanceOrders: [],
    maintenanceLogs: [],
    eaDocuments: [],
    protocolTemplates: [],
    protocols: [],
    shiftSchedules: [],
    clients: [],
    contracts: [],
    contractWorkers: [],
    rentalParties: [],
    rentalContracts: [],
    rentalAssets: [],
    rentalPayments: [],
    rentalRequests: [],
    rentalQuoteRequests: [],
    rentalCategories: [],
    workReports: [],
    leaveRequests: [],
    hrDocuments: [],
    warehouses: [],
    warehouseContracts: [],
    materialStocks: [],
    workReportAreas: [],
    workReportSpecialties: [],
    workReportMilestones: [],
    workReportCatalogs: [],
    workOrders: [],
    workWeeklyReports: [],
};


const appReducer = (state: AppDataState, action: AppStateAction): AppDataState => {
    switch (action.type) {
        case 'SET_DATA':
            return { ...state, [action.payload.collection]: action.payload.data };
        case 'SET_ALL':
            // Batch update: una sola transición de estado para muchas colecciones.
            // Conserva las referencias de los arrays no modificados, de modo que el
            // tracking por propiedad (react-tracked) solo re-renderice los consumidores
            // de las colecciones que realmente cambiaron.
            return { ...state, ...action.payload };
        case 'SET_ROLES':
            return { ...state, roles: action.payload };
        case 'SET_PLANS':
            return { ...state, subscriptionPlans: action.payload };
        case 'SET_LOADING':
            return { ...state, isLoading: action.payload };
        default:
            return state;
    }
};

// --- Provider value (custom hook consumed by react-tracked container) ---

function useAppValue(): readonly [AppStateContextType, React.Dispatch<AppStateAction>] {
    const { user, getTenantId, can, authLoading, setDynamicRoles } = useAuth();
    const [state, dispatch] = useReducer(appReducer, initialState);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
    const { toast } = useToast();

    const tenantId = getTenantId();

    // RFC-005 F2 — carga selectiva. `active` trae las colecciones del módulo en
    // el que estamos (más las que se hayan pedido al vuelo). Sin el gate —por
    // ejemplo en un test que monte el provider suelto— `on()` devuelve true para
    // todo y el comportamiento es el de siempre: cargarlo todo.
    const gate = useCollectionGate();
    const active = gate?.active;
    const on = useCallback(
        (name: CollectionName) => !active || active.has(name),
        [active]
    );

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sin empresa seleccionada hay que limpiar la actual: conservarla dejaría datos del tenant anterior a la vista
        if (!tenantId) { setCurrentTenant(null); return; }

        const mapTenant = (t: any) => ({
            id: t.id,
            name: t.name,
            tenantId: t.tenant_id,
            plan: t.plan,
            criticalitySettings: t.criticality_settings,
            faenas: t.faenas || [],
            rut: t.rut,
            legalRepresentative: t.legal_representative,
            legalRepresentativeRut: t.legal_representative_rut,
            address: t.address,
            logoUrl: t.logo_url ?? undefined,
            codePrefix: t.code_prefix ?? undefined,
            codePrefixes: t.code_prefixes ?? {},
            codeTypes: t.code_types ?? {},
            laborCostFactor: t.labor_cost_factor != null ? Number(t.labor_cost_factor) : undefined,
        });

        supabase.from('tenants').select('*').eq('id', tenantId).single().then(({ data: t }) => {
            if (t) setCurrentTenant(mapTenant(t));
        });

        const channel = supabase
            .channel(`tenant-${tenantId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'tenants',
                filter: `id=eq.${tenantId}`,
            }, ({ new: t }) => {
                if (t) setCurrentTenant(mapTenant(t));
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [tenantId, refreshVersion]);

    const materialsData = useSupabaseCollection('materials', { tenantId, enabled: on('materials'), mapper: mappers.materials, softDelete: true, columns: MATERIAL_COLUMNS });
    const usersData = useSupabaseCollection('profiles', { tenantId, enabled: on('users'), mapper: mappers.profiles, softDelete: true, columns: PROFILE_COLUMNS });
    const requestsData = useSupabaseCollection('material_requests', { tenantId, enabled: on('requests'), mapper: mappers.material_requests, orderBy: { column: 'created_at', ascending: false }, version: refreshVersion });
    const returnRequestsData = useSupabaseCollection('return_requests', { tenantId, enabled: on('returnRequests'), mapper: mappers.return_requests, orderBy: { column: 'created_at', ascending: false }, version: refreshVersion });
    const purchaseRequestsData = useSupabaseCollection('purchase_requests', { tenantId, enabled: on('purchaseRequests'), mapper: mappers.purchase_requests, orderBy: { column: 'created_at', ascending: false } });
    const suppliersData = useSupabaseCollection('suppliers', { tenantId, enabled: on('suppliers'), mapper: mappers.suppliers });
    const materialCategoriesData = useSupabaseCollection('material_categories', { tenantId, enabled: on('materialCategories'), mapper: mappers.material_categories });
    const unitsData = useSupabaseCollection('units', { tenantId, enabled: on('units') });
    const purchaseLotsData = useSupabaseCollection('purchase_lots', { tenantId, enabled: on('purchaseLots'), mapper: mappers.purchase_lots });
    const purchaseOrdersData = useSupabaseCollection('purchase_orders', { tenantId, enabled: on('purchaseOrders'), mapper: mappers.purchase_orders, orderBy: { column: 'created_at', ascending: false } });
    const quoteRequestsData = useSupabaseCollection('quote_requests', { tenantId, enabled: on('quoteRequests'), mapper: mappers.quote_requests, orderBy: { column: 'created_at', ascending: false } });
    const goodsReceiptsData = useSupabaseCollection('goods_receipts', { tenantId, enabled: on('goodsReceipts'), mapper: mappers.goods_receipts, orderBy: { column: 'created_at', ascending: false } });
    const costCentersData = useSupabaseCollection('cost_centers', { tenantId, enabled: on('costCenters'), mapper: mappers.cost_centers, orderBy: { column: 'created_at', ascending: false } });
    const supplierPaymentsData = useSupabaseCollection('supplier_payments', { tenantId, enabled: on('supplierPayments'), mapper: mappers.supplier_payments, orderBy: { column: 'due_date', ascending: true } });
    const salaryAdvancesData = useSupabaseCollection('salary_advances', { tenantId, enabled: on('salaryAdvances'), mapper: mappers.salary_advances, orderBy: { column: 'requested_at', ascending: false } });
    const attendanceLogsData = useSupabaseCollection('attendance_logs', { tenantId, enabled: on('attendanceLogs'), mapper: mappers.attendance_logs, orderBy: { column: 'timestamp', ascending: false } });
    // Proyección sin evidence_photos (arrays base64): se cargan bajo demanda en
    // el detalle/revisión (useRecordFields). Requiere la migración 20260612000004
    // (que añade template_title/supervisor_id/assigner_id/assigner_name/items). (S6)
    // Evidencia biométrica: la lee el pañol (para saber si hay una excepción ya
    // autorizada) y la bandeja de Autorizaciones (para resolverlas).
    const biometricVerificationsData = useSupabaseCollection('biometric_verifications', { tenantId, enabled: on('biometricVerifications'), mapper: mappers.biometric_verifications, orderBy: { column: 'created_at', ascending: false }, version: refreshVersion });
    const assignedChecklistsData = useSupabaseCollection('assigned_checklists', { tenantId, enabled: on('assignedChecklists'), mapper: mappers.assigned_checklists, orderBy: { column: 'created_at', ascending: false }, columns: 'id, tenant_id, template_id, template_title, supervisor_id, assigner_id, assigner_name, status, area, items, observations, performed_by, completed_at, reviewed_by, rejection_notes, created_at' });
    const safetyInspectionsData = useSupabaseCollection('safety_inspections', { tenantId, enabled: on('safetyInspections'), mapper: mappers.safety_inspections, orderBy: { column: 'created_at', ascending: false } });
    const checklistTemplatesData = useSupabaseCollection('checklist_templates', { tenantId, enabled: on('checklistTemplates'), mapper: mappers.checklist_templates });
    // Proyección sin firmas/foto (base64): se cargan bajo demanda en el detalle
    // (useRecordFields). Requiere la migración 20260612000004 (worker_id/worker_name). (S6)
    const behaviorObservationsData = useSupabaseCollection('behavior_observations', { tenantId, enabled: on('behaviorObservations'), mapper: mappers.behavior_observations, orderBy: { column: 'created_at', ascending: false }, columns: 'id, tenant_id, obra, worker_id, worker_name, worker_rut, observation_date, items, risk_level, feedback, observer_id, observer_name, created_at' });
    const stockMovementsData = useSupabaseCollection('stock_movements', { tenantId, enabled: on('stockMovements'), mapper: mappers.stock_movements, orderBy: { column: 'date', ascending: false } });
    const workProjectsData = useSupabaseCollection('work_projects', { tenantId, enabled: on('workProjects'), mapper: mappers.work_projects, orderBy: { column: 'created_at', ascending: false } });
    const workItemsData = useSupabaseCollection('work_items', { tenantId, enabled: on('workItems'), mapper: mappers.work_items, orderBy: { column: 'path', ascending: true } });
    const progressLogsData = useSupabaseCollection('progress_logs', { tenantId, enabled: on('progressLogs'), mapper: mappers.progress_logs, orderBy: { column: 'date', ascending: false } });
    const paymentStatesData = useSupabaseCollection('payment_states', { tenantId, enabled: on('paymentStates'), mapper: mappers.payment_states, orderBy: { column: 'created_at', ascending: false } });
    // Proyección sin firma/foto (base64 pesado): se cargan bajo demanda en el
    // detalle (useRecordFields). Requiere la migración 20260612000004 (que añade
    // obra/fecha al esquema). (S6)
    const dailyTalksData = useSupabaseCollection('daily_talks', { tenantId, enabled: on('dailyTalks'), mapper: mappers.daily_talks, orderBy: { column: 'created_at', ascending: false }, columns: 'id, tenant_id, obra, fecha, expositor_id, expositor_name, temas, asistentes, created_at' });
    const maintenanceOrdersData = useSupabaseCollection('maintenance_orders', { tenantId, enabled: on('maintenanceOrders'), mapper: mappers.maintenance_orders, orderBy: { column: 'created_at', ascending: false } });
    const maintenanceLogsData = useSupabaseCollection('maintenance_logs', { tenantId, enabled: on('maintenanceLogs'), mapper: mappers.maintenance_logs, orderBy: { column: 'timestamp', ascending: false } });
    const eaDocumentsData = useSupabaseCollection('ea_documents', { tenantId, enabled: on('eaDocuments'), mapper: mappers.ea_documents, orderBy: { column: 'generated_at', ascending: false } });
    const protocolTemplatesData = useSupabaseCollection('protocol_templates', { tenantId, enabled: on('protocolTemplates'), mapper: mappers.protocol_templates, orderBy: { column: 'created_at', ascending: false } });
    const protocolsData = useSupabaseCollection('protocols', { tenantId, enabled: on('protocols'), mapper: mappers.protocols, orderBy: { column: 'created_at', ascending: false } });
    const shiftSchedulesData = useSupabaseCollection('shift_schedules', { tenantId, enabled: on('shiftSchedules'), mapper: mappers.shift_schedules, orderBy: { column: 'created_at', ascending: true } });
    const clientsData = useSupabaseCollection('clients', { tenantId, enabled: on('clients'), mapper: mappers.clients, orderBy: { column: 'name', ascending: true } });
    const contractsData = useSupabaseCollection('contracts', { tenantId, enabled: on('contracts'), mapper: mappers.contracts, orderBy: { column: 'created_at', ascending: false } });
    const contractWorkersData = useSupabaseCollection('contract_workers', { tenantId, enabled: on('contractWorkers'), mapper: mappers.contract_workers });
    const warehousesData = useSupabaseCollection('warehouses', { tenantId, enabled: on('warehouses'), mapper: mappers.warehouses, orderBy: { column: 'name', ascending: true } });
    const warehouseContractsData = useSupabaseCollection('warehouse_contracts', { tenantId, enabled: on('warehouseContracts'), mapper: mappers.warehouse_contracts });
    const materialStocksData = useSupabaseCollection('material_stocks', { tenantId, enabled: on('materialStocks'), mapper: mappers.material_stocks });
    const rentalPartiesData = useSupabaseCollection('rental_parties', { tenantId, enabled: on('rentalParties'), mapper: mappers.rental_parties, orderBy: { column: 'name', ascending: true } });
    const rentalContractsData = useSupabaseCollection('rental_contracts', { tenantId, enabled: on('rentalContracts'), mapper: mappers.rental_contracts, orderBy: { column: 'created_at', ascending: false } });
    const rentalAssetsData = useSupabaseCollection('rental_assets', { tenantId, enabled: on('rentalAssets'), mapper: mappers.rental_assets, orderBy: { column: 'created_at', ascending: false } });
    const rentalPaymentsData = useSupabaseCollection('rental_payments', { tenantId, enabled: on('rentalPayments'), mapper: mappers.rental_payments, orderBy: { column: 'due_date', ascending: true } });
    const rentalRequestsData = useSupabaseCollection('rental_requests', { tenantId, enabled: on('rentalRequests'), mapper: mappers.rental_requests, orderBy: { column: 'created_at', ascending: false } });
    const rentalQuoteRequestsData = useSupabaseCollection('rental_quote_requests', { tenantId, enabled: on('rentalQuoteRequests'), mapper: mappers.rental_quote_requests, orderBy: { column: 'created_at', ascending: false } });
    const rentalCategoriesData = useSupabaseCollection('rental_categories', { tenantId, enabled: on('rentalCategories'), orderBy: { column: 'name', ascending: true } });
    const workReportsData = useSupabaseCollection('work_reports', { tenantId, enabled: on('workReports'), mapper: mappers.work_reports, orderBy: { column: 'created_at', ascending: false } });
    const leaveRequestsData = useSupabaseCollection('hr_leave_requests', { tenantId, enabled: on('leaveRequests'), mapper: mappers.hr_leave_requests, orderBy: { column: 'created_at', ascending: false } });
    const hrDocumentsData = useSupabaseCollection('hr_documents', { tenantId, enabled: on('hrDocuments'), mapper: mappers.hr_documents, orderBy: { column: 'expiry_date', ascending: true } });
    const workReportAreasData = useSupabaseCollection('wr_areas', { tenantId, enabled: on('workReportAreas'), orderBy: { column: 'name', ascending: true } });
    const workReportSpecialtiesData = useSupabaseCollection('wr_specialties', { tenantId, enabled: on('workReportSpecialties'), orderBy: { column: 'name', ascending: true } });
    const workReportMilestonesData = useSupabaseCollection('wr_milestones', { tenantId, enabled: on('workReportMilestones'), orderBy: { column: 'name', ascending: true } });
    const workReportCatalogsData = useSupabaseCollection('wr_catalogs', { tenantId, enabled: on('workReportCatalogs'), orderBy: { column: 'name', ascending: true } });
    const workOrdersData = useSupabaseCollection('work_orders', { tenantId, enabled: on('workOrders'), mapper: mappers.work_orders, orderBy: { column: 'work_date', ascending: false } });
    const workWeeklyReportsData = useSupabaseCollection('work_weekly_reports', { tenantId, enabled: on('workWeeklyReports'), mapper: mappers.work_weekly_reports, orderBy: { column: 'start_date', ascending: false } });

    // Dynamic / specialized data
    const rolesArray = useSupabaseCollection<any>('roles', { tenantId, enabled: !!tenantId });
    const dynamicRolesData = useMemo(() => {
        if (!rolesArray || rolesArray.length === 0) return ROLES_DEFAULT;
        return rolesArray.reduce((acc: any, item: any) => {
            acc[item.id || item.name] = item;
            return acc;
        }, {} as any);
    }, [rolesArray]);

    // Inyecta los permisos por-tenant en AuthProvider para que can() los respete.
    // can() hace merge por-rol contra ROLES_DEFAULT, así que basta con pasar lo cargado.
    useEffect(() => {
        setDynamicRoles(dynamicRolesData);
    }, [dynamicRolesData, setDynamicRoles]);

    const subscriptionPlansData = PLANS; // Local constants as base

    // Nota: no hay siembra de EDT de ejemplo. La hubo (automática primero,
    // opt-in después) y se eliminó: una cuenta nueva no debe nacer con la obra
    // de demostración adentro. La obra de ejemplo vive solo en el tenant demo,
    // sembrada por scripts/seed-demo-obra.ts.

    // Las categorías por defecto ahora las siembra un trigger de Postgres en el
    // INSERT de tenants (migración 20260612000006). Ya no se siembran desde el cliente.

    useEffect(() => {
        // Muestra cargando si la autenticación está en proceso o si no hay usuario aún
        if (authLoading || !user) {
            dispatch({ type: 'SET_LOADING', payload: true });
            return;
        }

        // Si el usuario es super-admin, puede o no tener un tenant seleccionado.
        if (user.role === 'super-admin' && tenantId === null) {
            dispatch({ type: 'SET_LOADING', payload: true });
            return;
        }

        // Para usuarios normales, si no hay tenantId, no bloquear eternamente
        // sino cargar con datos vacíos para que el dashboard sea accesible
        if (user.role !== 'super-admin' && !tenantId) {
            console.warn('[DataProvider] Usuario sin tenant_id asignado. Cargando con datos vacíos. Verifica que el perfil tenga tenant_id en la base de datos.');
            // En vez de bloquear, cargamos con datos vacíos
            dispatch({ type: 'SET_LOADING', payload: false });
            return;
        }

        // Nombre → datos. El nombre importa: con RFC-005 F2 las colecciones
        // inactivas NO se piden, así que su `hasLoaded` queda en false para
        // siempre. Si contaran para `allDataLoaded`, `isLoading` no se apagaría
        // nunca y toda la app viviría en el spinner hasta el safety net de 12 s.
        // Por eso la comprobación mira sólo las que este módulo activó.
        //
        // `dynamicRolesData` y `subscriptionPlansData` no entran: no son arrays
        // del hook (se transforman a objeto) y no tienen `hasLoaded`.
        const collections: Record<CollectionName, any> = {
            users: usersData, materials: materialsData, requests: requestsData,
            returnRequests: returnRequestsData, purchaseRequests: purchaseRequestsData,
            suppliers: suppliersData, materialCategories: materialCategoriesData,
            units: unitsData, purchaseLots: purchaseLotsData,
            purchaseOrders: purchaseOrdersData, quoteRequests: quoteRequestsData,
            goodsReceipts: goodsReceiptsData, costCenters: costCentersData,
            supplierPayments: supplierPaymentsData, salaryAdvances: salaryAdvancesData,
            attendanceLogs: attendanceLogsData, assignedChecklists: assignedChecklistsData,
            biometricVerifications: biometricVerificationsData,
            safetyInspections: safetyInspectionsData, checklistTemplates: checklistTemplatesData,
            behaviorObservations: behaviorObservationsData, stockMovements: stockMovementsData,
            workProjects: workProjectsData,
            workItems: workItemsData, progressLogs: progressLogsData,
            paymentStates: paymentStatesData, dailyTalks: dailyTalksData,
            maintenanceOrders: maintenanceOrdersData, maintenanceLogs: maintenanceLogsData,
            eaDocuments: eaDocumentsData, protocolTemplates: protocolTemplatesData,
            protocols: protocolsData, shiftSchedules: shiftSchedulesData,
            clients: clientsData, contracts: contractsData,
            contractWorkers: contractWorkersData, warehouses: warehousesData,
            warehouseContracts: warehouseContractsData, materialStocks: materialStocksData,
            rentalParties: rentalPartiesData, rentalContracts: rentalContractsData,
            rentalAssets: rentalAssetsData, rentalPayments: rentalPaymentsData,
            rentalRequests: rentalRequestsData, rentalQuoteRequests: rentalQuoteRequestsData,
            rentalCategories: rentalCategoriesData, workReports: workReportsData,
            leaveRequests: leaveRequestsData, hrDocuments: hrDocumentsData,
            workReportAreas: workReportAreasData, workReportSpecialties: workReportSpecialtiesData,
            workReportMilestones: workReportMilestonesData, workReportCatalogs: workReportCatalogsData,
            workOrders: workOrdersData, workWeeklyReports: workWeeklyReportsData,
        };

        const allDataLoaded = (Object.keys(collections) as CollectionName[])
            .filter(name => on(name))
            .every(name => collections[name]?.hasLoaded === true);

        // Antes se hacía `return` aquí mientras faltara UNA sola colección, así que
        // el estado no se publicaba hasta que respondían las 54. Medido en DEMO:
        // `materials` llegaba a 1,4 s y la pantalla la recibía a 2,6 s, esperando a
        // colecciones que devuelven 0 bytes y que esa página no usa nunca.
        // Ahora se publica lo que ya llegó y `isLoading` sigue marcando que falta
        // algo — con eso los estados vacíos siguen mostrando el spinner en vez de
        // afirmar "no hay datos" (ADR-014), que es lo que protege esa bandera.
        const processData = (data: any[] | undefined) => {
            if (!Array.isArray(data)) return [];
            return data; // In Supabase Supabase handles dates as strings or native Date objects if using a library, but here we expect strings
        };

        // NOTA: antes, si `workItemsData` estaba vacío, el estado se rellenaba
        // en memoria con una estructura de ejemplo — el EDT la mostraba como si
        // fuera real aunque nunca se hubiese guardado en la BD (y de hecho el
        // INSERT real estaba roto para tenants nuevos, ver hardening
        // 20260716000000). Ahora `workItems` refleja siempre la BD.
        const processedWorkItems = processData(workItemsData);

        const rolesToUse = dynamicRolesData && Object.keys(dynamicRolesData).length > 0 ? dynamicRolesData : ROLES_DEFAULT;
        const plansToUse = subscriptionPlansData && Object.keys(subscriptionPlansData).length > 0 ? subscriptionPlansData : PLANS;

        // Una sola transición de estado en lugar de 34 dispatches secuenciales.
        // processData devuelve la misma referencia de array para las colecciones sin
        // cambios, por lo que el reducer conserva su identidad y el tracking por
        // propiedad evita re-renderizar consumidores no afectados.
        dispatch({
            type: 'SET_ALL',
            payload: {
                users: processData(usersData),
                materials: processData(materialsData),
                requests: processData(requestsData),
                returnRequests: processData(returnRequestsData),
                purchaseRequests: processData(purchaseRequestsData),
                suppliers: processData(suppliersData),
                materialCategories: processData(materialCategoriesData),
                units: processData(unitsData),
                purchaseLots: processData(purchaseLotsData),
                purchaseOrders: processData(purchaseOrdersData),
                quoteRequests: processData(quoteRequestsData),
                goodsReceipts: processData(goodsReceiptsData),
                costCenters: processData(costCentersData),
                supplierPayments: processData(supplierPaymentsData),
                salaryAdvances: processData(salaryAdvancesData),
                attendanceLogs: processData(attendanceLogsData),
                assignedChecklists: processData(assignedChecklistsData),
                biometricVerifications: processData(biometricVerificationsData),
                safetyInspections: processData(safetyInspectionsData),
                checklistTemplates: processData(checklistTemplatesData),
                behaviorObservations: processData(behaviorObservationsData),
                stockMovements: processData(stockMovementsData),
                workProjects: processData(workProjectsData),
                workItems: processedWorkItems,
                progressLogs: processData(progressLogsData),
                paymentStates: processData(paymentStatesData),
                dailyTalks: processData(dailyTalksData),
                maintenanceOrders: processData(maintenanceOrdersData),
                maintenanceLogs: processData(maintenanceLogsData),
                eaDocuments: processData(eaDocumentsData),
                protocolTemplates: processData(protocolTemplatesData),
                protocols: processData(protocolsData),
                shiftSchedules: processData(shiftSchedulesData),
                clients: processData(clientsData),
                contracts: processData(contractsData),
                contractWorkers: processData(contractWorkersData),
                warehouses: processData(warehousesData),
                warehouseContracts: processData(warehouseContractsData),
                materialStocks: processData(materialStocksData),
                rentalParties: processData(rentalPartiesData),
                rentalContracts: processData(rentalContractsData),
                rentalAssets: processData(rentalAssetsData),
                rentalPayments: processData(rentalPaymentsData),
                rentalRequests: processData(rentalRequestsData),
                rentalQuoteRequests: processData(rentalQuoteRequestsData),
                rentalCategories: processData(rentalCategoriesData),
                workReports: processData(workReportsData),
                leaveRequests: processData(leaveRequestsData),
                hrDocuments: processData(hrDocumentsData),
                workReportAreas: processData(workReportAreasData),
                workReportSpecialties: processData(workReportSpecialtiesData),
                workReportCatalogs: processData(workReportCatalogsData),
                workReportMilestones: processData(workReportMilestonesData),
                workOrders: processData(workOrdersData),
                workWeeklyReports: processData(workWeeklyReportsData),
                roles: rolesToUse,
                subscriptionPlans: plansToUse,
                isLoading: !allDataLoaded,
            },
        });

    }, [
        authLoading, user, usersData, materialsData, requestsData,
        returnRequestsData, purchaseRequestsData, suppliersData, materialCategoriesData,
        unitsData, purchaseLotsData, purchaseOrdersData, quoteRequestsData, supplierPaymentsData,
        salaryAdvancesData, attendanceLogsData, assignedChecklistsData, biometricVerificationsData, safetyInspectionsData,
        checklistTemplatesData, behaviorObservationsData, stockMovementsData,
        subscriptionPlansData, workProjectsData, workItemsData, progressLogsData, tenantId, dynamicRolesData, paymentStatesData,
        dailyTalksData, maintenanceOrdersData, maintenanceLogsData, eaDocumentsData,
        protocolTemplatesData, protocolsData,
        shiftSchedulesData, clientsData, contractsData, contractWorkersData,
        warehousesData, warehouseContractsData, materialStocksData,
        rentalPartiesData, rentalContractsData, rentalAssetsData, rentalPaymentsData, workReportsData,
        rentalRequestsData, rentalQuoteRequestsData, rentalCategoriesData,
        leaveRequestsData, hrDocumentsData,
        workReportAreasData, workReportSpecialtiesData, workReportMilestonesData,
        workOrdersData, workWeeklyReportsData, refreshVersion,
        // `on` cambia cuando se activa una colección nueva (al navegar o cuando
        // la red de seguridad la pide): hay que recalcular `allDataLoaded`, o
        // `isLoading` se quedaría en false ignorando que ahora falta algo más.
        on, goodsReceiptsData, costCentersData, workReportCatalogsData,
    ]);


    // Safety net: if isLoading stays true for more than 12 seconds, force it false.
    // This prevents the UI from being permanently blocked by auth or network delays.
    useEffect(() => {
        if (!state.isLoading) return;
        const timer = setTimeout(() => {
            console.warn('[DataProvider] isLoading timeout — forcing false. Check auth/network.');
            dispatch({ type: 'SET_LOADING', payload: false });
        }, 12000);
        return () => clearTimeout(timer);
    }, [state.isLoading]);

    const notify = useCallback((message: string, variant: "default" | "destructive" | "success" = "default") => {
        toast({
            variant: variant === "success" ? "default" : variant,
            title: variant === "success" ? "Éxito" : variant === "destructive" ? "Error" : "Notificación",
            description: message,
            className: variant === 'success' ? 'border-green-500' : ''
        });
    }, [toast]);

    // Memoizada con las MISMAS dependencias que el `useMemo` de abajo ya declaraba
    // ([user, tenantId], que es todo lo que captura). Sin esto se recreaba en cada
    // render y el React Compiler abandonaba la optimización del provider entero
    // ("existing memoization could not be preserved"), que es el componente más
    // caliente de la app. El comportamiento no cambia.
    const bindContext = useCallback(<T extends any[], R>(fn: (...args: [...T, MutationContext]) => R) => {
        return (...args: T): R => {
            // `can` viaja en el contexto para que las mutaciones validen permisos
            // con la MISMA resolución que la pantalla (incluye los permisos que
            // cada empresa personalizó, que `userCan` no conoce).
            const context: MutationContext = { user, tenantId, can };
            if (context.user === undefined) {
                throw new Error("Context for mutation is not yet available.");
            }
            return fn(...args, context);
        };
    }, [user, tenantId, can]);

    const functions = React.useMemo(() => ({
        // Purchase Requests
        addPurchaseRequest: bindContext(purchaseRequestMutations.addPurchaseRequest),
        authorizePurchaseRequest: bindContext(purchaseRequestMutations.authorizePurchaseRequest),
        updatePurchaseRequestStatus: bindContext(purchaseRequestMutations.updatePurchaseRequestStatus),
        receivePurchaseRequest: bindContext(purchaseRequestMutations.receivePurchaseRequest),
        markClientRequestsSent: bindContext(purchaseRequestMutations.markClientRequestsSent),
        deletePurchaseRequest: bindContext(purchaseRequestMutations.deletePurchaseRequest),
        cancelPurchaseOrder: bindContext(purchaseRequestMutations.cancelPurchaseOrder),
        archiveLot: bindContext(purchaseRequestMutations.archiveLot),
        generatePurchaseOrder: bindContext(purchaseRequestMutations.generatePurchaseOrder),
        createPurchaseOrder: bindContext(purchaseRequestMutations.createPurchaseOrder),
        returnToPool: bindContext(purchaseRequestMutations.returnToPool),

        // Material Requests
        addMaterialRequest: bindContext(materialRequestMutations.addMaterialRequest),
        addAndApproveMaterialRequest: bindContext(materialRequestMutations.addAndApproveMaterialRequest),
        authorizeMaterialRequest: bindContext(materialRequestMutations.authorizeMaterialRequest),
        updateMaterialRequestStatus: bindContext(materialRequestMutations.updateMaterialRequestStatus),
        deliverApprovedMaterialRequest: bindContext(materialRequestMutations.deliverApprovedMaterialRequest),
        addReturnRequest: bindContext(materialRequestMutations.addReturnRequest),
        addAndCompleteReturnRequest: bindContext(materialRequestMutations.addAndCompleteReturnRequest),
        updateReturnRequestStatus: bindContext(materialRequestMutations.updateReturnRequestStatus),
        deleteMaterialRequest: bindContext(materialRequestMutations.deleteMaterialRequest),
        deleteReturnRequest: bindContext(materialRequestMutations.deleteReturnRequest),

        // Generic CRUD
        addTenant: bindContext(genericMutations.addTenant),
        addUser: bindContext(genericMutations.addUser),
        enrollUser: bindContext(genericMutations.enrollUser),
        hrUpdateUser: bindContext(genericMutations.hrUpdateUser),
        updateUser: bindContext(genericMutations.updateUser),
        updateUserPermissions: bindContext(genericMutations.updateUserPermissions),
        deleteUser: bindContext(genericMutations.deleteUser),
        addMaterial: bindContext(genericMutations.addMaterial),
        updateMaterial: bindContext(genericMutations.updateMaterial),
        deleteMaterial: bindContext(genericMutations.deleteMaterial),
        addManualStockEntry: bindContext(genericMutations.addManualStockEntry),
        addMaterialCategory: bindContext(genericMutations.addMaterialCategory),
        updateMaterialCategory: bindContext(genericMutations.updateMaterialCategory),
        deleteMaterialCategory: bindContext(genericMutations.deleteMaterialCategory),
        addUnit: bindContext(genericMutations.addUnit),
        deleteUnit: bindContext(genericMutations.deleteUnit),
        addSupplier: bindContext(genericMutations.addSupplier),
        updateSupplier: bindContext(genericMutations.updateSupplier),
        deleteSupplier: bindContext(genericMutations.deleteSupplier),
        uploadSupplierDocument: bindContext(genericMutations.uploadSupplierDocument),
        deleteSupplierDocumentFile: bindContext(genericMutations.deleteSupplierDocumentFile),
        addQuoteRequest: bindContext(rfqMutations.addQuoteRequest),
        updateQuoteRequest: bindContext(rfqMutations.updateQuoteRequest),
        deleteQuoteRequest: bindContext(rfqMutations.deleteQuoteRequest),
        sendQuoteRequest: bindContext(rfqMutations.sendQuoteRequest),
        closeQuoteRequest: bindContext(rfqMutations.closeQuoteRequest),
        addQuoteResponse: bindContext(rfqMutations.addQuoteResponse),
        updateQuoteResponse: bindContext(rfqMutations.updateQuoteResponse),
        deleteQuoteResponse: bindContext(rfqMutations.deleteQuoteResponse),
        uploadQuoteAttachment: bindContext(rfqMutations.uploadQuoteAttachment),
        awardQuote: bindContext(rfqMutations.awardQuote),
        uploadReceptionPhoto: bindContext(receptionMutations.uploadReceptionPhoto),
        receiveGoodsReceipt: bindContext(receptionMutations.receiveGoodsReceipt),
        deleteGoodsReceipt: bindContext(receptionMutations.deleteGoodsReceipt),
        addCostCenter: bindContext(costCenterMutations.addCostCenter),
        updateCostCenter: bindContext(costCenterMutations.updateCostCenter),
        deleteCostCenter: bindContext(costCenterMutations.deleteCostCenter),
        assignOrderCostCenter: bindContext(costCenterMutations.assignOrderCostCenter),
        createLot: bindContext(genericMutations.createLot),
        addRequestToLot: bindContext(genericMutations.addRequestToLot),
        removeRequestFromLot: bindContext(genericMutations.removeRequestFromLot),
        deleteLot: bindContext(genericMutations.deleteLot),

        // Tenant
        updateTenant: bindContext(genericMutations.updateTenant),

        // Work Items
        addWorkProject: bindContext(workProjectMutations.addWorkProject),
        updateWorkProject: bindContext(workProjectMutations.updateWorkProject),
        deleteWorkProject: bindContext(workProjectMutations.deleteWorkProject),
        addWorkItem: bindContext(genericMutations.addWorkItem),
        updateWorkItem: bindContext(genericMutations.updateWorkItem),
        deleteWorkItem: bindContext(genericMutations.deleteWorkItem),
        addWorkItemProgress: bindContext(genericMutations.addWorkItemProgress),
        submitForQualityReview: bindContext(genericMutations.submitForQualityReview),
        approveWorkItem: bindContext(genericMutations.approveWorkItem),
        rejectWorkItem: bindContext(genericMutations.rejectWorkItem),
        addPaymentState: bindContext(paymentStateMutations.addPaymentState),
        approvePaymentState: bindContext(paymentStateMutations.approvePaymentState),
        markPaymentStatePaid: bindContext(paymentStateMutations.markPaymentStatePaid),
        annulPaymentState: bindContext(paymentStateMutations.annulPaymentState),
        addBudgetEntry: bindContext(budgetMutations.addBudgetEntry),
        addEmploymentContract: bindContext(payrollMutations.addEmploymentContract),
        // Remuneraciones F3 — planilla persistente (ADR-009)
        proposePayrollLines: bindContext(payrollRunMutations.proposePayrollLines),
        createPayrollRun: bindContext(payrollRunMutations.createPayrollRun),
        savePayrollDraft: bindContext(payrollRunMutations.savePayrollDraft),
        closePayrollRun: bindContext(payrollRunMutations.closePayrollRun),
        markPayrollRunPaid: bindContext(payrollRunMutations.markPayrollRunPaid),
        deletePayrollRun: bindContext(payrollRunMutations.deletePayrollRun),
        proposeSeverance: bindContext(severanceMutations.proposeSeverance),
        saveSeveranceDraft: bindContext(severanceMutations.saveSeveranceDraft),
        recalculateSeveranceDraft: bindContext(severanceMutations.recalculateSeveranceDraft),
        closeSeverance: bindContext(severanceMutations.closeSeverance),
        markSeverancePaid: bindContext(severanceMutations.markSeverancePaid),
        deleteSeveranceDraft: bindContext(severanceMutations.deleteSeveranceDraft),
        closePeriod: bindContext(periodMutations.closePeriod),
        reopenPeriod: bindContext(periodMutations.reopenPeriod),

        // Biometría — hechos append-only que respaldan la recepción de activos
        recordBiometricVerification: bindContext(biometricMutations.recordBiometricVerification),
        requestBiometricException: bindContext(biometricMutations.requestBiometricException),
        resolveBiometricException: bindContext(biometricMutations.resolveBiometricException),

        // Safety
        addChecklistTemplate: bindContext(safetyMutations.addChecklistTemplate),
        deleteChecklistTemplate: bindContext(safetyMutations.deleteChecklistTemplate),
        assignChecklistToSupervisors: bindContext(safetyMutations.assignChecklistToSupervisors),
        completeAssignedChecklist: bindContext(safetyMutations.completeAssignedChecklist),
        reviewAssignedChecklist: bindContext(safetyMutations.reviewAssignedChecklist),
        deleteAssignedChecklist: bindContext(safetyMutations.deleteAssignedChecklist),
        addSafetyInspection: bindContext(safetyMutations.addSafetyInspection),
        completeSafetyInspection: bindContext(safetyMutations.completeSafetyInspection),
        reviewSafetyInspection: bindContext(safetyMutations.reviewSafetyInspection),
        addBehaviorObservation: bindContext(safetyMutations.addBehaviorObservation),
        addDailyTalk: bindContext(safetyMutations.addDailyTalk),
        signDailyTalk: bindContext(safetyMutations.signDailyTalk),

        // Attendance
        handleAttendanceScan: bindContext(attendanceMutations.handleAttendanceScan),
        addManualAttendance: bindContext(attendanceMutations.addManualAttendance),
        updateAttendanceLog: bindContext(attendanceMutations.updateAttendanceLog),
        deleteAttendanceLog: bindContext(attendanceMutations.deleteAttendanceLog),

        // Payments
        addSupplierPayment: bindContext(paymentMutations.addSupplierPayment),
        updateSupplierPayment: bindContext(paymentMutations.updateSupplierPayment),
        markPaymentAsPaid: bindContext(paymentMutations.markPaymentAsPaid),
        deleteSupplierPayment: bindContext(paymentMutations.deleteSupplierPayment),
        addSalaryAdvanceRequest: bindContext(paymentMutations.addSalaryAdvanceRequest),
        approveSalaryAdvance: bindContext(paymentMutations.approveSalaryAdvance),
        rejectSalaryAdvance: bindContext(paymentMutations.rejectSalaryAdvance),
        markSalaryAdvancePaid: bindContext(paymentMutations.markSalaryAdvancePaid),

        // Permissions
        updateRolePermissions: bindContext(genericMutations.updateRolePermissions),
        updatePlanPermissions: bindContext(genericMutations.updatePlanPermissions),

        // Maintenance
        addMaintenanceOrder: bindContext(maintenanceMutations.addMaintenanceOrder),
        updateMaintenanceOrder: bindContext(maintenanceMutations.updateMaintenanceOrder),
        closeMaintenanceOrder: bindContext(maintenanceMutations.closeMaintenanceOrder),
        addMaintenanceLog: bindContext(maintenanceMutations.addMaintenanceLog),

        // EA Documents
        generateEADocument: bindContext(eaMutations.generateEADocument),
        confirmEASentToDT: bindContext(eaMutations.confirmEASentToDT),

        // Contratos y Turnos
        addClient: bindContext(contractMutations.addClient),
        updateClient: bindContext(contractMutations.updateClient),
        deleteClient: bindContext(contractMutations.deleteClient),
        addContract: bindContext(contractMutations.addContract),
        updateContract: bindContext(contractMutations.updateContract),
        deleteContract: bindContext(contractMutations.deleteContract),
        addContractWorker: bindContext(contractMutations.addContractWorker),
        removeContractWorker: bindContext(contractMutations.removeContractWorker),
        updateContractWorker: bindContext(contractMutations.updateContractWorker),

        // Pañoles y existencias por contrato
        addWarehouse: bindContext(warehouseMutations.addWarehouse),
        updateWarehouse: bindContext(warehouseMutations.updateWarehouse),
        deleteWarehouse: bindContext(warehouseMutations.deleteWarehouse),
        transferMaterialStock: bindContext(warehouseMutations.transferMaterialStock),
        addShiftSchedule: bindContext(contractMutations.addShiftSchedule),
        updateShiftSchedule: bindContext(contractMutations.updateShiftSchedule),
        deleteShiftSchedule: bindContext(contractMutations.deleteShiftSchedule),

        // Arriendos (Rentals)
        addRentalParty: bindContext(rentalMutations.addRentalParty),
        updateRentalParty: bindContext(rentalMutations.updateRentalParty),
        deleteRentalParty: bindContext(rentalMutations.deleteRentalParty),
        addRentalContract: bindContext(rentalMutations.addRentalContract),
        updateRentalContract: bindContext(rentalMutations.updateRentalContract),
        deleteRentalContract: bindContext(rentalMutations.deleteRentalContract),
        closeRentalContract: bindContext(rentalMutations.closeRentalContract),
        addRentalAsset: bindContext(rentalMutations.addRentalAsset),
        updateRentalAsset: bindContext(rentalMutations.updateRentalAsset),
        deleteRentalAsset: bindContext(rentalMutations.deleteRentalAsset),
        returnRentalAsset: bindContext(rentalMutations.returnRentalAsset),
        addRentalPayment: bindContext(rentalMutations.addRentalPayment),
        generateRentalSchedule: bindContext(rentalMutations.generateRentalSchedule),
        markRentalOcSent: bindContext(rentalMutations.markRentalOcSent),
        confirmRentalOc: bindContext(rentalMutations.confirmRentalOc),
        materializeRentalContractAssets: bindContext(rentalMutations.materializeRentalContractAssets),
        markRentalPaymentPaid: bindContext(rentalMutations.markRentalPaymentPaid),
        updateRentalPayment: bindContext(rentalMutations.updateRentalPayment),
        deleteRentalPayment: bindContext(rentalMutations.deleteRentalPayment),
        // Categorías de Arriendo
        addRentalCategory: bindContext(rentalRequestMutations.addRentalCategory),
        updateRentalCategory: bindContext(rentalRequestMutations.updateRentalCategory),
        deleteRentalCategory: bindContext(rentalRequestMutations.deleteRentalCategory),
        // Solicitudes de Arriendo + RFQ de arriendo
        addRentalRequest: bindContext(rentalRequestMutations.addRentalRequest),
        // RFC-004 F3: el requerimiento de arriendo crea la solicitud del flujo
        // de arriendos y se enlaza a ella, compartiendo un solo código.
        addRentalRequirement: bindContext(purchaseRequestMutations.addRentalRequirement),
        updateRentalRequestStatus: bindContext(rentalRequestMutations.updateRentalRequestStatus),
        authorizeRentalRequest: bindContext(rentalRequestMutations.authorizeRentalRequest),
        deleteRentalRequest: bindContext(rentalRequestMutations.deleteRentalRequest),
        addRentalQuoteRequest: bindContext(rentalRequestMutations.addRentalQuoteRequest),
        updateRentalQuoteRequest: bindContext(rentalRequestMutations.updateRentalQuoteRequest),
        sendRentalQuoteRequest: bindContext(rentalRequestMutations.sendRentalQuoteRequest),
        recordRentalQuoteResponse: bindContext(rentalRequestMutations.recordRentalQuoteResponse),
        awardRentalQuote: bindContext(rentalRequestMutations.awardRentalQuote),
        deleteRentalQuoteRequest: bindContext(rentalRequestMutations.deleteRentalQuoteRequest),

        // Reportes de Trabajo
        createWorkReport: bindContext(workReportMutations.createWorkReport),
        updateWorkReport: bindContext(workReportMutations.updateWorkReport),
        transitionWorkReport: bindContext(workReportMutations.transitionWorkReport),
        signWorkReportApproval: bindContext(workReportMutations.signWorkReportApproval),
        recordWorkReportSent: bindContext(workReportMutations.recordWorkReportSent),
        uploadWorkReportPhoto: bindContext(workReportMutations.uploadWorkReportPhoto),
        deleteWorkReportPhoto: bindContext(workReportMutations.deleteWorkReportPhoto),
        deleteWorkReport: bindContext(workReportMutations.deleteWorkReport),

        addWorkReportArea: bindContext(workReportCatalogMutations.addWorkReportArea),
        updateWorkReportArea: bindContext(workReportCatalogMutations.updateWorkReportArea),
        deleteWorkReportArea: bindContext(workReportCatalogMutations.deleteWorkReportArea),
        addWorkReportSpecialty: bindContext(workReportCatalogMutations.addWorkReportSpecialty),
        updateWorkReportSpecialty: bindContext(workReportCatalogMutations.updateWorkReportSpecialty),
        deleteWorkReportSpecialty: bindContext(workReportCatalogMutations.deleteWorkReportSpecialty),
        addWorkReportMilestone: bindContext(workReportCatalogMutations.addWorkReportMilestone),
        updateWorkReportMilestone: bindContext(workReportCatalogMutations.updateWorkReportMilestone),
        deleteWorkReportMilestone: bindContext(workReportCatalogMutations.deleteWorkReportMilestone),
        addWorkReportCatalog: bindContext(workReportCatalogMutations.addWorkReportCatalog),
        updateWorkReportCatalog: bindContext(workReportCatalogMutations.updateWorkReportCatalog),
        deleteWorkReportCatalog: bindContext(workReportCatalogMutations.deleteWorkReportCatalog),

        createWorkOrder: bindContext(workOrderMutations.createWorkOrder),
        updateWorkOrder: bindContext(workOrderMutations.updateWorkOrder),
        deleteWorkOrder: bindContext(workOrderMutations.deleteWorkOrder),

        createWorkWeeklyReport: bindContext(workWeeklyReportMutations.createWorkWeeklyReport),
        updateWorkWeeklyReport: bindContext(workWeeklyReportMutations.updateWorkWeeklyReport),
        deleteWorkWeeklyReport: bindContext(workWeeklyReportMutations.deleteWorkWeeklyReport),

        // Recursos Humanos
        addLeaveRequest: bindContext(hrMutations.addLeaveRequest),
        updateLeaveRequestStatus: bindContext(hrMutations.updateLeaveRequestStatus),
        deleteLeaveRequest: bindContext(hrMutations.deleteLeaveRequest),
        addHRDocument: bindContext(hrMutations.addHRDocument),
        updateHRDocument: bindContext(hrMutations.updateHRDocument),
        deleteHRDocument: bindContext(hrMutations.deleteHRDocument),

        // Protocols
        addProtocolTemplate: bindContext(protocolMutations.addProtocolTemplate),
        deleteProtocolTemplate: bindContext(protocolMutations.deleteProtocolTemplate),
        createProtocol: bindContext(protocolMutations.createProtocol),
        saveProtocolDraft: bindContext(protocolMutations.saveProtocolDraft),
        submitProtocolForReview: bindContext(protocolMutations.submitProtocolForReview),
        approveProtocol: bindContext(protocolMutations.approveProtocol),
        rejectProtocol: bindContext(protocolMutations.rejectProtocol),
        deleteProtocol: bindContext(protocolMutations.deleteProtocol),
    }), [bindContext]);

    const refreshData = useCallback((_collectionName?: keyof AppDataState) => {
        setRefreshVersion(v => v + 1);
        // Future optimization: allow refreshing specific collections
    }, []);

    const value: AppStateContextType = React.useMemo(() => ({
        ...state,
        isLoading: state.isLoading,
        roles: state.roles,
        subscriptionPlans: state.subscriptionPlans,
        can,
        notify,
        currentTenant,
        refreshData,
        ...functions,
    }), [state, can, notify, currentTenant, refreshData, functions]);

    return [value, dispatch] as const;
}

// react-tracked container: las propiedades del estado se rastrean por acceso
// mediante un Proxy, de modo que cada consumidor de useAppState() solo se
// re-renderiza cuando cambia el slice que realmente lee (no ante cualquier
// cambio de cualquier colección).
const { Provider, useTrackedState } = createContainer(useAppValue);

/**
 * Contexto mínimo con la carga inicial del provider.
 *
 * Existe aparte del estado tracked por dos razones:
 *  1. `useTrackedState` **lanza** si se usa fuera del provider, y esto lo consume
 *     `<EmptyState>`, que también se renderiza fuera del dashboard. `useContext`
 *     sobre un contexto sin provider devuelve su default y no rompe nada.
 *  2. Su valor cambia una sola vez (true → false), así que no arrastra
 *     re-renders como lo haría leer el estado completo.
 *
 * Sirve para que los estados vacíos no afirmen "no hay datos" mientras cargan
 * (ADR-014).
 */
export const AppLoadingContext = React.createContext<boolean | undefined>(undefined);

/** `true` sólo si estamos dentro del provider Y todavía carga. */
export function useAppIsLoading(): boolean {
    return React.useContext(AppLoadingContext) === true;
}

function DataProviderWithLoading({ children }: { children: React.ReactNode }) {
    // El gate va POR FUERA del container de react-tracked: `useAppValue` lo lee
    // para saber qué colecciones pedir, y `useAppState` lo lee para activar al
    // vuelo una colección no declarada (RFC-005 F2).
    return (
        <CollectionGateProvider>
            <Provider><LoadingBridge>{children}</LoadingBridge></Provider>
        </CollectionGateProvider>
    );
}

/** Publica `isLoading` del estado tracked en el contexto ligero. */
function LoadingBridge({ children }: { children: React.ReactNode }) {
    const { isLoading } = useTrackedState();
    return <AppLoadingContext.Provider value={isLoading}>{children}</AppLoadingContext.Provider>;
}

export const DataProvider = DataProviderWithLoading;
export const useAppStateTracked = useTrackedState;
