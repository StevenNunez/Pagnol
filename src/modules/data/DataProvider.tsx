

"use client";
import React, {
    createContext,
    useReducer,
    useCallback,
    useContext,
    useEffect,
    useState,
    useMemo,
} from 'react';
import { supabase } from '@/modules/core/lib/supabase';
import {
    User,
    UserRole,
    Tenant,
    SubscriptionPlan,
    WorkItem,
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
import * as materialRequestMutations from './mutations/materialRequestMutations';
import * as purchaseRequestMutations from './mutations/purchaseRequestMutations';
import * as genericMutations from './mutations/genericMutations';
import * as toolMutations from './mutations/toolMutations';
import * as safetyMutations from './mutations/safetyMutations';
import * as attendanceMutations from './mutations/attendanceMutations';
import * as paymentMutations from './mutations/paymentMutations';
import * as maintenanceMutations from './mutations/maintenanceMutations';
import * as eaMutations from './mutations/eaMutations';
import * as protocolMutations from './mutations/protocolMutations';
import * as contractMutations from './mutations/contractMutations';
import { WORK_ITEMS_SEED } from '@/lib/work-items-seed';

const initialState: AppDataState = {
    isLoading: true,
    roles: ROLES_DEFAULT,
    subscriptionPlans: PLANS,
    users: [],
    materials: [],
    tools: [],
    toolLogs: [],
    requests: [],
    returnRequests: [],
    purchaseRequests: [],
    suppliers: [],
    materialCategories: [],
    units: [],
    purchaseLots: [],
    purchaseOrders: [],
    supplierPayments: [],
    salaryAdvances: [],
    attendanceLogs: [],
    assignedChecklists: [],
    safetyInspections: [],
    checklistTemplates: [],
    behaviorObservations: [],
    stockMovements: [],
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
    contracts: [],
    contractWorkers: [],
};


const appReducer = (state: AppDataState, action: AppStateAction): AppDataState => {
    switch (action.type) {
        case 'SET_DATA':
            return { ...state, [action.payload.collection]: action.payload.data };
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

// --- Context Definition ---

export const AppStateContext = createContext<AppStateContextType | undefined>(
    undefined
);

export function DataProvider({ children }: { children: React.ReactNode }) {
    const { user, getTenantId, can, authLoading } = useAuth();
    const [state, dispatch] = useReducer(appReducer, initialState);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
    const { toast } = useToast();

    const tenantId = getTenantId();

    useEffect(() => {
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

    const materialsData = useSupabaseCollection('materials', { tenantId, mapper: mappers.materials });
    const toolsData = useSupabaseCollection('tools', { tenantId });
    const usersData = useSupabaseCollection('profiles', { tenantId, mapper: mappers.profiles, softDelete: true });
    const toolLogsData = useSupabaseCollection('tool_logs', { tenantId, mapper: mappers.tool_logs, orderBy: { column: 'checkout_date', ascending: false } });
    const requestsData = useSupabaseCollection('material_requests', { tenantId, mapper: mappers.material_requests, orderBy: { column: 'created_at', ascending: false }, version: refreshVersion });
    const returnRequestsData = useSupabaseCollection('return_requests', { tenantId, mapper: mappers.return_requests, orderBy: { column: 'created_at', ascending: false }, version: refreshVersion });
    const purchaseRequestsData = useSupabaseCollection('purchase_requests', { tenantId, mapper: mappers.purchase_requests, orderBy: { column: 'created_at', ascending: false } });
    const suppliersData = useSupabaseCollection('suppliers', { tenantId });
    const materialCategoriesData = useSupabaseCollection('material_categories', { tenantId });
    const unitsData = useSupabaseCollection('units', { tenantId });
    const purchaseLotsData = useSupabaseCollection('purchase_lots', { tenantId, mapper: mappers.purchase_lots });
    const purchaseOrdersData = useSupabaseCollection('purchase_orders', { tenantId, mapper: mappers.purchase_orders, orderBy: { column: 'created_at', ascending: false } });
    const supplierPaymentsData = useSupabaseCollection('supplier_payments', { tenantId, mapper: mappers.supplier_payments, orderBy: { column: 'due_date', ascending: true } });
    const salaryAdvancesData = useSupabaseCollection('salary_advances', { tenantId, mapper: mappers.salary_advances, orderBy: { column: 'requested_at', ascending: false } });
    const attendanceLogsData = useSupabaseCollection('attendance_logs', { tenantId, mapper: mappers.attendance_logs, orderBy: { column: 'timestamp', ascending: false } });
    const assignedChecklistsData = useSupabaseCollection('assigned_checklists', { tenantId, mapper: mappers.assigned_checklists, orderBy: { column: 'created_at', ascending: false } });
    const safetyInspectionsData = useSupabaseCollection('safety_inspections', { tenantId, mapper: mappers.safety_inspections, orderBy: { column: 'created_at', ascending: false } });
    const checklistTemplatesData = useSupabaseCollection('checklist_templates', { tenantId, mapper: mappers.checklist_templates });
    const behaviorObservationsData = useSupabaseCollection('behavior_observations', { tenantId, mapper: mappers.behavior_observations, orderBy: { column: 'created_at', ascending: false } });
    const stockMovementsData = useSupabaseCollection('stock_movements', { tenantId, mapper: mappers.stock_movements, orderBy: { column: 'date', ascending: false } });
    const workItemsData = useSupabaseCollection('work_items', { tenantId, mapper: mappers.work_items, orderBy: { column: 'path', ascending: true } });
    const progressLogsData = useSupabaseCollection('progress_logs', { tenantId, mapper: mappers.progress_logs, orderBy: { column: 'date', ascending: false } });
    const paymentStatesData = useSupabaseCollection('payment_states', { tenantId, mapper: mappers.payment_states, orderBy: { column: 'created_at', ascending: false } });
    const dailyTalksData = useSupabaseCollection('daily_talks', { tenantId, mapper: mappers.daily_talks, orderBy: { column: 'created_at', ascending: false } });
    const maintenanceOrdersData = useSupabaseCollection('maintenance_orders', { tenantId, mapper: mappers.maintenance_orders, orderBy: { column: 'created_at', ascending: false } });
    const maintenanceLogsData = useSupabaseCollection('maintenance_logs', { tenantId, mapper: mappers.maintenance_logs, orderBy: { column: 'timestamp', ascending: false } });
    const eaDocumentsData = useSupabaseCollection('ea_documents', { tenantId, mapper: mappers.ea_documents, orderBy: { column: 'generated_at', ascending: false } });
    const protocolTemplatesData = useSupabaseCollection('protocol_templates', { tenantId, mapper: mappers.protocol_templates, orderBy: { column: 'created_at', ascending: false } });
    const protocolsData = useSupabaseCollection('protocols', { tenantId, mapper: mappers.protocols, orderBy: { column: 'created_at', ascending: false } });
    const shiftSchedulesData = useSupabaseCollection('shift_schedules', { tenantId, mapper: mappers.shift_schedules, orderBy: { column: 'created_at', ascending: true } });
    const contractsData = useSupabaseCollection('contracts', { tenantId, mapper: mappers.contracts, orderBy: { column: 'created_at', ascending: false } });
    const contractWorkersData = useSupabaseCollection('contract_workers', { tenantId, mapper: mappers.contract_workers });

    // Dynamic / specialized data
    const rolesArray = useSupabaseCollection<any>('roles', { enabled: !!tenantId });
    const dynamicRolesData = useMemo(() => {
        if (!rolesArray || rolesArray.length === 0) return ROLES_DEFAULT;
        return rolesArray.reduce((acc: any, item: any) => {
            acc[item.id || item.name] = item;
            return acc;
        }, {} as any);
    }, [rolesArray]);

    const subscriptionPlansData = PLANS; // Local constants as base


    // Seed data effect
    useEffect(() => {
        const seedWorkItems = async () => {
            const seedFlag = `seeded_workitems_${tenantId}`;
            if (tenantId && user && workItemsData.length === 0 && can('construction_control:edit_structure') && !sessionStorage.getItem(seedFlag)) {
                // Set flag BEFORE starting to avoid race conditions with quick re-renders
                sessionStorage.setItem(seedFlag, 'true');

                console.log(`Seeding work items for tenant ${tenantId}...`);
                try {
                    const dataToInsert = WORK_ITEMS_SEED.map((item: any) => ({
                        id: item.id,
                        project_id: item.projectId || '1',
                        name: item.name,
                        type: item.type,
                        parent_id: item.parentId || null,
                        path: item.path,
                        unit: item.unit,
                        quantity: item.quantity,
                        unit_price: item.unitPrice,
                        created_by: user.id,
                        tenant_id: tenantId,
                        progress: 0,
                        status: 'in-progress'
                    }));

                    // Use upsert to handle conflicts (409) gracefully if items already exist
                    const { error } = await supabase.from('work_items').upsert(dataToInsert, { onConflict: 'id' });
                    if (error) throw error;

                    console.log("Work items seeded successfully.");
                } catch (error: any) {
                    console.warn("Work items seed skipped or failed:", error?.message || error);
                    // DON'T remove flag — keep it set to prevent infinite retry loop
                }
            }
        };

        if (tenantId && user) {
            seedWorkItems();
        }
    }, [tenantId, workItemsData.length, can, user]);

    // Seed default categories if the collection is empty for the tenant
    useEffect(() => {
        const seedCategories = async () => {
            // Check if data is loaded, is an empty array, and user has permission
            if (tenantId && Array.isArray(materialCategoriesData) && materialCategoriesData.length === 0 && can('categories:create')) {
                console.log(`Seeding material categories for tenant ${tenantId}...`);

                // Use a session flag to prevent re-seeding during hot-reloads in development
                const seedFlag = `seeded_categories_${tenantId}`;
                if (sessionStorage.getItem(seedFlag)) {
                    return;
                }

                try {
                    const defaultCategories = [
                        'EPP (Elementos de Protección Personal)',
                        'Herramientas Manuales',
                        'Herramientas Eléctricas / Neumáticas',
                        'Equipos de Medición y Control',
                        'Activos TI',
                        'Activos Mayores (Maquinaria)',
                        'Materiales e Insumos',
                        'Otros Activos'
                    ];

                    const dataToInsert = defaultCategories.map(name => ({
                        name,
                        tenant_id: tenantId
                    }));

                    const { error } = await supabase.from('material_categories').insert(dataToInsert);
                    if (error) throw error;

                    sessionStorage.setItem(seedFlag, 'true'); // Set flag after successful seeding
                    console.log("Material categories seeded successfully.");
                    toast({
                        title: 'Categorías Creadas',
                        description: 'Se han añadido las categorías por defecto para organizar tus activos.'
                    });
                } catch (error: any) {
                    console.error("Error seeding material categories:", error?.message, error?.code, error?.details);
                    toast({
                        variant: 'destructive',
                        title: 'Error al Crear Categorías',
                        description: 'No se pudieron crear las categorías por defecto.'
                    });
                }
            }
        };

        // Ensure tenantId is available and data has been fetched
        if (tenantId && materialCategoriesData !== undefined) {
            seedCategories();
        }
    }, [tenantId, materialCategoriesData, can, toast]);


    useEffect(() => {
        // Muestra cargando si la autenticación está en proceso o si no hay usuario aún
        if (authLoading || !user) {
            dispatch({ type: 'SET_LOADING', payload: true });
            return;
        }

        // DEBUG: Log para diagnóstico
        console.log('[DataProvider] User:', user?.name, '| Role:', user?.role, '| TenantId:', tenantId, '| AuthLoading:', authLoading);

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

        const allDataLoaded = [
            usersData, materialsData, toolsData, toolLogsData, requestsData,
            returnRequestsData, purchaseRequestsData, suppliersData, materialCategoriesData,
            unitsData, purchaseLotsData, purchaseOrdersData, supplierPaymentsData,
            salaryAdvancesData, attendanceLogsData, assignedChecklistsData, safetyInspectionsData,
            checklistTemplatesData, behaviorObservationsData, stockMovementsData,
            subscriptionPlansData, workItemsData, progressLogsData, dynamicRolesData, paymentStatesData,
            dailyTalksData, maintenanceOrdersData, maintenanceLogsData, eaDocumentsData,
            protocolTemplatesData, protocolsData,
            shiftSchedulesData, contractsData, contractWorkersData,
        ].every(data => data !== undefined);

        if (!allDataLoaded) {
            dispatch({ type: 'SET_LOADING', payload: true });
            return;
        }

        const processData = (data: any[] | undefined) => {
            if (!Array.isArray(data)) return [];
            return data; // In Supabase Supabase handles dates as strings or native Date objects if using a library, but here we expect strings
        };

        let processedWorkItems = processData(workItemsData);
        if (tenantId && processedWorkItems.length === 0) {
            processedWorkItems = WORK_ITEMS_SEED.map(item => ({
                ...item,
                tenantId: tenantId,
                status: 'in-progress',
                progress: 0,
            } as WorkItem));
        }

        dispatch({ type: 'SET_DATA', payload: { collection: "users", data: processData(usersData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "materials", data: processData(materialsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "tools", data: processData(toolsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "toolLogs", data: processData(toolLogsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "requests", data: processData(requestsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "returnRequests", data: processData(returnRequestsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "purchaseRequests", data: processData(purchaseRequestsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "suppliers", data: processData(suppliersData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "materialCategories", data: processData(materialCategoriesData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "units", data: processData(unitsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "purchaseLots", data: processData(purchaseLotsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "purchaseOrders", data: processData(purchaseOrdersData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "supplierPayments", data: processData(supplierPaymentsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "salaryAdvances", data: processData(salaryAdvancesData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "attendanceLogs", data: processData(attendanceLogsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "assignedChecklists", data: processData(assignedChecklistsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "safetyInspections", data: processData(safetyInspectionsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "checklistTemplates", data: processData(checklistTemplatesData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "behaviorObservations", data: processData(behaviorObservationsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "stockMovements", data: processData(stockMovementsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "workItems", data: processedWorkItems } });
        dispatch({ type: 'SET_DATA', payload: { collection: "progressLogs", data: processData(progressLogsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "paymentStates", data: processData(paymentStatesData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "dailyTalks", data: processData(dailyTalksData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "maintenanceOrders", data: processData(maintenanceOrdersData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "maintenanceLogs", data: processData(maintenanceLogsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "eaDocuments", data: processData(eaDocumentsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "protocolTemplates", data: processData(protocolTemplatesData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "protocols", data: processData(protocolsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "shiftSchedules", data: processData(shiftSchedulesData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "contracts", data: processData(contractsData) } });
        dispatch({ type: 'SET_DATA', payload: { collection: "contractWorkers", data: processData(contractWorkersData) } });

        const rolesToUse = dynamicRolesData && Object.keys(dynamicRolesData).length > 0 ? dynamicRolesData : ROLES_DEFAULT;
        dispatch({ type: "SET_ROLES", payload: rolesToUse });

        const plansToUse = subscriptionPlansData && Object.keys(subscriptionPlansData).length > 0 ? subscriptionPlansData : PLANS;
        dispatch({ type: "SET_PLANS", payload: plansToUse });

        dispatch({ type: "SET_LOADING", payload: false });

    }, [
        authLoading, user, usersData, materialsData, toolsData, toolLogsData, requestsData,
        returnRequestsData, purchaseRequestsData, suppliersData, materialCategoriesData,
        unitsData, purchaseLotsData, purchaseOrdersData, supplierPaymentsData,
        salaryAdvancesData, attendanceLogsData, assignedChecklistsData, safetyInspectionsData,
        checklistTemplatesData, behaviorObservationsData, stockMovementsData,
        subscriptionPlansData, workItemsData, progressLogsData, tenantId, dynamicRolesData, paymentStatesData,
        dailyTalksData, maintenanceOrdersData, maintenanceLogsData, eaDocumentsData,
        protocolTemplatesData, protocolsData,
        shiftSchedulesData, contractsData, contractWorkersData, refreshVersion
    ]);


    const notify = useCallback((message: string, variant: "default" | "destructive" | "success" = "default") => {
        toast({
            variant: variant === "success" ? "default" : variant,
            title: variant === "success" ? "Éxito" : variant === "destructive" ? "Error" : "Notificación",
            description: message,
            className: variant === 'success' ? 'border-green-500' : ''
        });
    }, [toast]);

    const bindContext = <T extends any[], R>(fn: (...args: [...T, { user: any; tenantId: string | null; db: any }]) => R) => {
        return (...args: T): R => {
            const context = { user, tenantId, db: null }; // Passing null for db as it's not needed by our new migrations
            if (context.user === undefined) {
                throw new Error("Context for mutation is not yet available.");
            }
            return fn(...args, context);
        };
    };

    const functions = React.useMemo(() => ({
        // Purchase Requests
        addPurchaseRequest: bindContext(purchaseRequestMutations.addPurchaseRequest),
        updatePurchaseRequestStatus: bindContext(purchaseRequestMutations.updatePurchaseRequestStatus),
        receivePurchaseRequest: bindContext(purchaseRequestMutations.receivePurchaseRequest),
        deletePurchaseRequest: bindContext(purchaseRequestMutations.deletePurchaseRequest),
        cancelPurchaseOrder: bindContext(purchaseRequestMutations.cancelPurchaseOrder),
        archiveLot: bindContext(purchaseRequestMutations.archiveLot),
        generatePurchaseOrder: bindContext(purchaseRequestMutations.generatePurchaseOrder),
        createPurchaseOrder: bindContext(purchaseRequestMutations.createPurchaseOrder),
        returnToPool: bindContext(purchaseRequestMutations.returnToPool),

        // Material Requests
        addMaterialRequest: bindContext(materialRequestMutations.addMaterialRequest),
        addAndApproveMaterialRequest: bindContext(materialRequestMutations.addAndApproveMaterialRequest),
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
        createLot: bindContext(genericMutations.createLot),
        addRequestToLot: bindContext(genericMutations.addRequestToLot),
        removeRequestFromLot: bindContext(genericMutations.removeRequestFromLot),
        deleteLot: bindContext(genericMutations.deleteLot),

        // Tenant
        updateTenant: bindContext(genericMutations.updateTenant),

        // Work Items
        addWorkItem: bindContext(genericMutations.addWorkItem),
        updateWorkItem: bindContext(genericMutations.updateWorkItem),
        deleteWorkItem: bindContext(genericMutations.deleteWorkItem),
        addWorkItemProgress: bindContext(genericMutations.addWorkItemProgress),
        submitForQualityReview: bindContext(genericMutations.submitForQualityReview),
        approveWorkItem: bindContext(genericMutations.approveWorkItem),
        rejectWorkItem: bindContext(genericMutations.rejectWorkItem),
        addPaymentState: bindContext(genericMutations.addPaymentState),

        // Tools
        addTool: bindContext(toolMutations.addTool),
        updateTool: bindContext(toolMutations.updateTool),
        deleteTool: bindContext(toolMutations.deleteTool),
        checkoutTool: bindContext(toolMutations.checkoutTool),
        returnTool: bindContext(toolMutations.returnTool),
        findActiveLogForTool: bindContext(toolMutations.findActiveLogForTool),

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
        addContract: bindContext(contractMutations.addContract),
        updateContract: bindContext(contractMutations.updateContract),
        deleteContract: bindContext(contractMutations.deleteContract),
        addContractWorker: bindContext(contractMutations.addContractWorker),
        removeContractWorker: bindContext(contractMutations.removeContractWorker),
        updateContractWorker: bindContext(contractMutations.updateContractWorker),
        addShiftSchedule: bindContext(contractMutations.addShiftSchedule),
        updateShiftSchedule: bindContext(contractMutations.updateShiftSchedule),
        deleteShiftSchedule: bindContext(contractMutations.deleteShiftSchedule),

        // Protocols
        addProtocolTemplate: bindContext(protocolMutations.addProtocolTemplate),
        deleteProtocolTemplate: bindContext(protocolMutations.deleteProtocolTemplate),
        createProtocol: bindContext(protocolMutations.createProtocol),
        saveProtocolDraft: bindContext(protocolMutations.saveProtocolDraft),
        submitProtocolForReview: bindContext(protocolMutations.submitProtocolForReview),
        approveProtocol: bindContext(protocolMutations.approveProtocol),
        rejectProtocol: bindContext(protocolMutations.rejectProtocol),
        deleteProtocol: bindContext(protocolMutations.deleteProtocol),
    }), [user, tenantId]);

    const value: AppStateContextType = React.useMemo(() => ({
        ...state,
        isLoading: state.isLoading,
        roles: state.roles,
        subscriptionPlans: state.subscriptionPlans,
        can,
        notify,
        currentTenant,
        refreshData: (collectionName?: keyof AppDataState) => {
            setRefreshVersion(v => v + 1);
            if (collectionName) {
                // Future optimization: allow refreshing specific collections
            }
        },
        ...functions,
    }), [state, can, notify, currentTenant, functions]);

    return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
