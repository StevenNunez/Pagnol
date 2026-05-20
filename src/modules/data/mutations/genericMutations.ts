

import { supabase } from '@/modules/core/lib/supabase';
import { ROLES as ROLES_DEFAULT, Permission, PLANS } from '@/modules/core/lib/permissions';
import { nanoid } from 'nanoid';
import type { UserRole, Tenant, WorkItem, ProgressLog, PaymentState } from '@/modules/core/lib/data';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';

type Context = {
    user: any;
    tenantId: string | null;
    db: any;
};

// --- Tenant ---
export async function addTenant({ tenantName, tenantId, adminName, adminEmail }: any, { user }: Context) {
    if (user?.role !== 'super-admin') throw new Error("Solo los super-administradores pueden crear inquilinos.");

    const { data, error } = await supabase
        .from('tenants')
        .insert({
            tenant_id: tenantId,
            name: tenantName,
            plan: 'pro'
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateTenant(tenantId: string, data: Partial<Tenant>, { }: Context) {
    const payload: Record<string, any> = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.plan !== undefined) payload.plan = data.plan;
    if (data.criticalitySettings !== undefined) payload.criticality_settings = data.criticalitySettings;
    if (data.rut !== undefined) payload.rut = data.rut;
    if (data.legalRepresentative !== undefined) payload.legal_representative = data.legalRepresentative;
    if (data.legalRepresentativeRut !== undefined) payload.legal_representative_rut = data.legalRepresentativeRut;
    if (data.address !== undefined) payload.address = data.address;
    if (data.faenas !== undefined) payload.faenas = data.faenas;
    const { error } = await supabase.from('tenants').update(payload).eq('id', tenantId);
    if (error) throw error;
}

// --- User ---
export async function addUser(data: any, { user, tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido para crear usuario.");

    const res = await fetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: data.email,
            password: data.password,
            name: data.name,
            role: data.role,
            tenantId,
            internalId: data.internalId,
            rut: data.rut,
            biometric_template: data.biometric_template || null,
            kyc_face_image: data.kyc_face_image || null,
            kyc_id_front: data.kyc_id_front || null,
            kyc_id_back: data.kyc_id_back || null,
            enrolledByName: user?.name || 'System',
        }),
    });

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Error al crear el usuario.');
    return json;
}

export async function updateUserPermissions(userId: string, permissions: string[], { user }: Context) {
    if (user?.role !== 'administrador' && user?.role !== 'super-admin') {
        throw new Error("Solo los administradores pueden otorgar permisos especiales.");
    }

    const { error } = await supabase
        .from('profiles')
        .update({
            granted_permissions: permissions,
            enrolled_by: user.name,
            enrolled_at: new Date().toISOString(),
        })
        .eq('id', userId);

    if (error) throw error;
}

export async function updateUser(userId: string, data: any, { user }: Context) {
    const updatePayload: any = {
        name: data.name,
        email: data.email,
        role: data.role,
        qr_code: data.qrCode,
        tenant_id: data.tenantId,
        rut: data.rut,
        internal_id: data.internalId,
        cargo: data.cargo,
        phone: data.phone,
        fecha_ingreso: data.fechaIngreso,
        base_salary: data.baseSalary,
        afp: data.afp,
        tipo_salud: data.tipoSalud,
        cargas_familiares: data.cargasFamiliares,
        signature: data.signature,
        biometric_template: data.biometric_template,
        kyc_id_front: data.kyc_id_front,
        kyc_id_back: data.kyc_id_back,
        kyc_face_image: data.kyc_face_image,
        enrolled_by: data.biometric_template ? (user?.name || 'System') : undefined,
        enrolled_at: data.biometric_template ? new Date().toISOString() : undefined,
        onboarding_completed: data.biometric_template ? true : undefined,
    };

    // Remove undefined values
    Object.keys(updatePayload).forEach(key => {
        if (updatePayload[key] === undefined) {
            delete updatePayload[key];
        }
    });

    const { error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', userId);

    if (error) throw error;
}

export async function deleteUser(userId: string, { }: Context) {
    const { error } = await supabase
        .from('profiles')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', userId);

    if (error) throw error;
}


// --- Material ---
export async function addMaterial(data: any, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");
    const { justification, ...materialData } = data;

    const assetId = await nextInternalCode(tenantId, 'ACT');

    const { data: newMaterial, error: materialError } = await supabase
        .from('materials')
        .insert({
            name: materialData.name,
            stock: materialData.stock,
            in_use: materialData.inUse || 0,
            unit: materialData.unit,
            category: materialData.category,
            supplier_id: materialData.supplierId,
            archived: materialData.archived || false,
            criticality: materialData.class,
            usage_type: materialData.usageType,
            description: materialData.description,
            unit_cost: materialData.unitCost,
            acquisition_date: materialData.acquisitionDate,
            serial_number: materialData.serialNumber,
            status: materialData.status || 'Disponible',
            is_it_asset: materialData.isITAsset || false,
            internal_code: assetId,
            location: materialData.location,
            brand: materialData.brand,
            ...(materialData.conditionScore !== undefined && { condition_score: materialData.conditionScore }),
            technical_sheet_url: materialData.technicalSheetUrl,
            technical_sheet_name: materialData.technicalSheetName,
            failure_probability: materialData.failureProbability || 1,
            failure_impact: materialData.failureImpact || 1,
            parent_id: materialData.parentId || null,
            tenant_id: tenantId,
        })
        .select()
        .single();

    if (materialError) throw materialError;

    // Create Initial Movement
    if (data.stock > 0) {
        const { error: movementError } = await supabase
            .from('stock_movements')
            .insert({
                material_id: newMaterial.id,
                material_name: data.name,
                quantity_change: data.stock,
                new_stock: data.stock,
                type: 'initial',
                justification: justification || 'Stock inicial',
                user_id: user.id,
                user_name: user.name,
                tenant_id: tenantId,
            });

        if (movementError) throw movementError;
    }
}

export async function addManualStockEntry(materialId: string, quantity: number, justification: string, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

    const { data: material, error: fetchError } = await supabase
        .from('materials')
        .select('stock, name')
        .eq('id', materialId)
        .single();

    if (fetchError || !material) throw new Error("Material no encontrado.");

    const newStock = (material.stock || 0) + quantity;

    const { error: updateError } = await supabase
        .from('materials')
        .update({ stock: newStock })
        .eq('id', materialId);

    if (updateError) throw updateError;

    const { error: movementError } = await supabase
        .from('stock_movements')
        .insert({
            material_id: materialId,
            material_name: material.name,
            quantity_change: quantity,
            new_stock: newStock,
            type: 'manual-entry',
            justification: justification,
            user_id: user.id,
            user_name: user.name,
            tenant_id: tenantId,
        });

    if (movementError) throw movementError;
}

export async function updateMaterial(materialId: string, data: any, { user, tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");

    const { data: currentMaterial, error: fetchError } = await supabase
        .from('materials')
        .select('*')
        .eq('id', materialId)
        .single();

    if (fetchError || !currentMaterial) throw new Error("El material no existe.");

    const { stock, ...otherData } = data;
    let hasStockChange = false;
    let stockDifference = 0;
    let finalStock = currentMaterial.stock;

    const canEditStock = user?.role === 'super-admin' || user?.role === 'administrador';
    if (canEditStock && stock !== undefined && stock !== currentMaterial.stock) {
        stockDifference = stock - currentMaterial.stock;
        finalStock = stock;
        hasStockChange = true;
    }

    let updatePayload: any = {
        name: otherData.name,
        unit: otherData.unit,
        category: otherData.category,
        supplier_id: otherData.supplierId,
        archived: otherData.archived,
        criticality: otherData.class,
        usage_type: otherData.usageType,
        description: otherData.description,
        unit_cost: otherData.unitCost,
        acquisition_date: otherData.acquisitionDate,
        serial_number: otherData.serialNumber,
        status: otherData.status,
        is_it_asset: otherData.isITAsset,
        internal_code: otherData.internalCode,
        location: otherData.location,
        brand: otherData.brand,
        technical_sheet_url: otherData.technicalSheetUrl,
        technical_sheet_name: otherData.technicalSheetName,
        condition_score: otherData.conditionScore,
        ...(otherData.failureProbability !== undefined && { failure_probability: otherData.failureProbability }),
        ...(otherData.failureImpact !== undefined && { failure_impact: otherData.failureImpact }),
        ...(otherData.parentId !== undefined && { parent_id: otherData.parentId || null }),
    };

    // Remove undefined values to avoid overwriting with null unless intended
    Object.keys(updatePayload).forEach(key => {
        if (updatePayload[key] === undefined) delete updatePayload[key];
    });

    if (hasStockChange) {
        updatePayload.stock = finalStock;
    }

    const { error: updateError } = await supabase
        .from('materials')
        .update(updatePayload)
        .eq('id', materialId);

    if (updateError) throw updateError;

    if (hasStockChange) {
        const { error: movementError } = await supabase
            .from('stock_movements')
            .insert({
                material_id: materialId,
                material_name: currentMaterial.name,
                quantity_change: stockDifference,
                new_stock: finalStock,
                type: 'adjustment',
                justification: 'Ajuste desde panel de edición',
                user_id: user.id,
                user_name: user.name,
                tenant_id: tenantId,
            });

        if (movementError) throw movementError;
    }
}

export async function deleteMaterial(materialId: string, { }: Context) {
    const { error } = await supabase
        .from('materials')
        .delete()
        .eq('id', materialId);
    if (error) throw error;
}

// --- Categories & Units ---
export async function addMaterialCategory(name: string, { tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");
    const { error } = await supabase
        .from('material_categories')
        .insert({ name, tenant_id: tenantId });
    if (error) throw error;
}

export async function updateMaterialCategory(id: string, name: string, { }: Context) {
    const { error } = await supabase
        .from('material_categories')
        .update({ name })
        .eq('id', id);
    if (error) throw error;
}

export async function deleteMaterialCategory(id: string, { }: Context) {
    const { error } = await supabase
        .from('material_categories')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

export async function addUnit(name: string, { tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");
    const { error } = await supabase
        .from('units')
        .insert({ name, tenant_id: tenantId });
    if (error) throw error;
}

export async function deleteUnit(id: string, { }: Context) {
    const { error } = await supabase
        .from('units')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

// --- Suppliers ---
export async function addSupplier(data: any, { tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");
    const { error } = await supabase
        .from('suppliers')
        .insert({ ...data, tenant_id: tenantId });
    if (error) throw error;
}

export async function updateSupplier(id: string, data: any, { }: Context) {
    const { error } = await supabase
        .from('suppliers')
        .update(data)
        .eq('id', id);
    if (error) throw error;
}

export async function deleteSupplier(id: string, { }: Context) {
    const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

// --- Lots ---
export async function createLot(name: string, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");
    const { error } = await supabase
        .from('purchase_lots')
        .insert({
            name,
            creator_id: user.id,
            creator_name: user.name,
            status: 'open',
            tenant_id: tenantId,
        });
    if (error) throw error;
}

export async function addRequestToLot(requestId: string, lotId: string, { }: Context) {
    const { error } = await supabase
        .from('purchase_requests')
        .update({ lot_id: lotId, status: 'batched' })
        .eq('id', requestId);
    if (error) throw error;
}

export async function removeRequestFromLot(requestId: string, { }: Context) {
    const { error } = await supabase
        .from('purchase_requests')
        .update({ lot_id: null, status: 'approved' })
        .eq('id', requestId);
    if (error) throw error;
}

export async function deleteLot(lotId: string, { }: Context) {
    // Reset requests in the lot
    const { error: updateError } = await supabase
        .from('purchase_requests')
        .update({ lot_id: null, status: 'approved' })
        .eq('lot_id', lotId);

    if (updateError) throw updateError;

    const { error: deleteError } = await supabase
        .from('purchase_lots')
        .delete()
        .eq('id', lotId);

    if (deleteError) throw deleteError;
}

// --- Permissions ---
export async function updateRolePermissions(role: UserRole, permission: any, checked: any, { tenantId }: Context) {
    // This function will need a roles table in Supabase or we handle it in-app with profiles.
    // For now, let's assume there's a 'roles' table as in the schema (though I might have missed it in my initial schema.sql, let's add it if needed).
    // The previous schema did have 'roles' table.

    const { data: roleData, error: fetchError } = await supabase
        .from('roles')
        .select('*')
        .eq('id', role)
        .single();

    const currentPermissions = roleData?.permissions || ROLES_DEFAULT[role]?.permissions || [];
    let newPermissions;
    if (checked) {
        newPermissions = [...new Set([...currentPermissions, permission])];
    } else {
        newPermissions = currentPermissions.filter((p: string) => p !== permission);
    }

    const { error } = await supabase
        .from('roles')
        .upsert({
            id: role,
            description: ROLES_DEFAULT[role]?.description,
            permissions: newPermissions
        });

    if (error) throw error;
}

export async function updatePlanPermissions(planId: string, permissions: Permission[], { }: Context) {
    const { error } = await supabase
        .from('subscription_plans')
        .update({ allowed_permissions: permissions })
        .eq('id', planId);
    if (error) throw error;
}

// --- Work Items ---
export async function addWorkItem(data: Omit<WorkItem, 'id' | 'tenantId' | 'progress' | 'path'>, { tenantId, user }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");
    if (!user) throw new Error("Usuario no autenticado.");

    let path = '';
    if (data.parentId) {
        const { data: parentDoc } = await supabase
            .from('work_items')
            .select('path')
            .eq('id', data.parentId)
            .single();

        if (!parentDoc) throw new Error("El ítem padre no existe.");

        const { count } = await supabase
            .from('work_items')
            .select('*', { count: 'exact', head: true })
            .eq('parent_id', data.parentId);

        path = `${parentDoc.path}/${String((count || 0) + 1).padStart(2, '0')}`;
    } else {
        const { count } = await supabase
            .from('work_items')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .is('parent_id', null);

        path = String((count || 0) + 1).padStart(2, '0');
    }

    const { error } = await supabase
        .from('work_items')
        .insert({
            name: data.name,
            type: data.type,
            parent_id: data.parentId || null,
            unit: data.unit,
            quantity: data.quantity,
            unit_price: data.unitPrice,
            planned_start_date: data.plannedStartDate || null,
            planned_end_date: data.plannedEndDate || null,
            actual_start_date: data.actualStartDate || null,
            actual_end_date: data.actualEndDate || null,
            assigned_to: data.assignedTo || null,
            status: 'in-progress',
            tenant_id: tenantId,
            project_id: tenantId,
            progress: 0,
            path: path,
            created_by: user.id,
        });

    if (error) throw error;
}

export async function updateWorkItem(id: string, data: Partial<WorkItem>, { }: Context) {
    const snakeData: Record<string, unknown> = {};
    if ('name' in data) snakeData.name = data.name;
    if ('status' in data) snakeData.status = data.status;
    if ('progress' in data) snakeData.progress = data.progress;
    if ('plannedStartDate' in data) snakeData.planned_start_date = data.plannedStartDate;
    if ('plannedEndDate' in data) snakeData.planned_end_date = data.plannedEndDate;
    if ('actualStartDate' in data) snakeData.actual_start_date = data.actualStartDate;
    if ('actualEndDate' in data) snakeData.actual_end_date = data.actualEndDate;
    if ('assignedTo' in data) snakeData.assigned_to = data.assignedTo;
    if ('unitPrice' in data) snakeData.unit_price = data.unitPrice;
    if ('quantity' in data) snakeData.quantity = data.quantity;
    if ('unit' in data) snakeData.unit = data.unit;
    if ('type' in data) snakeData.type = data.type;
    if ('parentId' in data) snakeData.parent_id = data.parentId;

    const { error } = await supabase
        .from('work_items')
        .update(snakeData)
        .eq('id', id);
    if (error) throw error;
}

export async function deleteWorkItem(id: string, { }: Context) {
    const { error } = await supabase
        .from('work_items')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

export async function addWorkItemProgress(workItemId: string, quantity: number, date: Date, observations: string | undefined, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

    const { data: workItem, error: fetchError } = await supabase
        .from('work_items')
        .select('*')
        .eq('id', workItemId)
        .single();

    if (fetchError || !workItem) throw new Error("La partida de trabajo no existe.");

    // Fetch existing progress logs
    const { data: logs } = await supabase
        .from('progress_logs')
        .select('quantity')
        .eq('work_item_id', workItemId);

    const existingQuantity = (logs || []).reduce((sum, log) => sum + log.quantity, 0);
    const totalAdvanced = existingQuantity + quantity;

    if (totalAdvanced > workItem.quantity) {
        throw new Error(`La cantidad total avanzada (${totalAdvanced}) no puede exceder la cantidad total de la partida (${workItem.quantity}).`);
    }

    const newProgress = (totalAdvanced / workItem.quantity) * 100;

    // Create new progress log
    const { error: logError } = await supabase
        .from('progress_logs')
        .insert({
            tenant_id: tenantId,
            work_item_id: workItemId,
            date: date.toISOString(),
            quantity,
            user_id: user.id,
            user_name: user.name,
            observations: observations || '',
        });

    if (logError) throw logError;

    // Update the work item's progress
    const { error: updateError } = await supabase
        .from('work_items')
        .update({ progress: newProgress })
        .eq('id', workItemId);

    if (updateError) throw updateError;
}

export async function submitForQualityReview(workItemId: string, { }: Context) {
    const { error } = await supabase
        .from('work_items')
        .update({
            status: 'pending-quality-review',
            actual_end_date: new Date().toISOString(),
        })
        .eq('id', workItemId);
    if (error) throw error;
}

export async function rejectWorkItem(workItemId: string, reason: string, { user }: Context) {
    const { error } = await supabase
        .from('work_items')
        .update({
            status: 'rejected',
            rejection_reason: reason || 'Rechazado por Control de Calidad.',
            reviewed_by: user?.id ?? null,
            reviewed_at: new Date().toISOString(),
        })
        .eq('id', workItemId);
    if (error) throw error;
}

export async function approveWorkItem(workItemId: string, { user }: Context) {
    const { error } = await supabase
        .from('work_items')
        .update({
            status: 'completed',
            reviewed_by: user?.id ?? null,
            reviewed_at: new Date().toISOString(),
        })
        .eq('id', workItemId);
    if (error) throw error;
}

export async function addPaymentState(
    data: Omit<PaymentState, 'id' | 'tenantId' | 'createdAt' | 'status' | 'contractorId' | 'contractorName'>,
    { user, tenantId }: Context
): Promise<string> {
    if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

    const { data: newPS, error } = await supabase
        .from('payment_states')
        .insert({
            total_value: (data as any).totalValue ?? 0,
            earned_value: (data as any).earnedValue ?? 0,
            items: (data as any).items ?? [],
            contractor_id: user.id,
            contractor_name: user.name,
            status: 'pending',
            tenant_id: tenantId,
        })
        .select()
        .single();

    if (error) throw error;
    return newPS.id;
}

