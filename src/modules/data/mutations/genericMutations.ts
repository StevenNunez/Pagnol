

import { supabase } from '@/modules/core/lib/supabase';
import { authHeaders } from '@/modules/core/lib/auth-header';
import { ROLES as ROLES_DEFAULT, Permission, PLANS, userCan } from '@/modules/core/lib/permissions';
import { nanoid } from 'nanoid';
import type { UserRole, Tenant, WorkItem, ProgressLog, PaymentState, SupplierDocument, Supplier } from '@/modules/core/lib/data';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { mappers } from '../mappers';
import type { MutationContext as Context } from './context';
import { addToLedger, consumeFromLedger } from './stockLedger';

// --- Tenant ---
export async function addTenant({ tenantName, tenantId, adminName, adminEmail }: any, { user, can }: Context) {
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
    if (data.logoUrl !== undefined) payload.logo_url = data.logoUrl || null;
    if (data.codePrefix !== undefined) payload.code_prefix = data.codePrefix?.trim() || null;
    if (data.codePrefixes !== undefined) payload.code_prefixes = data.codePrefixes ?? {};
    if (data.codeTypes !== undefined) payload.code_types = data.codeTypes ?? {};
    if (data.laborCostFactor !== undefined) payload.labor_cost_factor = data.laborCostFactor;
    // `.select()` para detectar UPDATE silencioso de 0 filas (típico de RLS que no
    // matchea): sin esto Supabase no devuelve error y el cambio no persiste.
    const { data: rows, error } = await supabase
        .from('tenants')
        .update(payload)
        .eq('id', tenantId)
        .select('id');
    if (error) throw error;
    if (!rows || rows.length === 0) {
        throw new Error('No se pudo guardar: no tienes permiso para editar esta empresa (RLS).');
    }
}

// --- User ---
export async function addUser(data: any, { user, tenantId, can }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido para crear usuario.");

    const res = await fetch('/api/users/create', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
            email: data.email,
            password: data.password,
            name: data.name,
            role: data.role,
            tenantId,
            internalId: data.internalId,
            rut: data.rut,
            // `cargo` y `phone` los pide el formulario de alta y el wizard de
            // enrolamiento; antes se quedaban acá y el perfil nacía sin ellos.
            // El cargo además alimenta "Personal en obra" de la OT.
            cargo: data.cargo || null,
            phone: data.phone || null,
            biometric_template: data.biometric_template || null,
            kyc_face_image: data.kyc_face_image || null,
            kyc_id_front: data.kyc_id_front || null,
            kyc_id_back: data.kyc_id_back || null,
            // Enrolamiento por QR: el servidor lee el descriptor y los documentos
            // de la sesión del móvil. Este navegador nunca los tuvo.
            enrollmentToken: data.enrollmentToken || null,
            enrolledByName: user?.name || 'System',
            contractId: data.contractId || null,
            shiftScheduleId: data.shiftScheduleId || null,
            rotationStartDate: data.rotationStartDate || null,
        }),
    });

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Error al crear el usuario.');
    return json;
}

// Enrola biometría + KYC a un usuario existente. Va por service role (/api/users/enroll)
// para que también puedan enrolar roles no-admin (Calidad con pagnol:enroll_personal) y
// para escribir los documentos KYC en la tabla protegida profile_documents.
export async function enrollUser(userId: string, data: any, { user, can }: Context) {
    const res = await fetch('/api/users/enroll', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
            userId,
            internalId: data.internalId ?? data.internal_id,
            biometric_template: data.biometric_template || null,
            kyc_face_image: data.kyc_face_image || null,
            kyc_id_front: data.kyc_id_front || null,
            kyc_id_back: data.kyc_id_back || null,
            enrollmentToken: data.enrollmentToken || null,
            enrolledByName: user?.name || 'System',
        }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Error al enrolar al usuario.');
    return json;
}

// Actualiza SOLO campos de ficha RRHH vía service role (/api/users/hr-update), para que el
// rol recursos-humanos (que no es is_tenant_admin) pueda editar la ficha sin chocar con RLS
// y sin darle acceso a KYC/rol/sueldo.
export async function hrUpdateUser(userId: string, data: any, { }: Context) {
    const res = await fetch('/api/users/hr-update', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
            userId,
            cargo: data.cargo,
            phone: data.phone,
            address: data.address,
            birthDate: data.birthDate ?? null,
            emergencyContactName: data.emergencyContactName,
            emergencyContactPhone: data.emergencyContactPhone,
            employmentStatus: data.employmentStatus,
        }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Error al actualizar la ficha.');
    return json;
}

export async function updateUserPermissions(userId: string, permissions: string[], { user, can }: Context) {
    if (user?.role !== 'administrador' && user?.role !== 'soporte-pagnol' && user?.role !== 'super-admin') {
        throw new Error("Solo los administradores pueden otorgar permisos especiales.");
    }

    // `.select()` para detectar el UPDATE silencioso de 0 filas (RLS que no matchea):
    // sin esto el cambio no persiste y no se lanza error.
    const { data: rows, error } = await supabase
        .from('profiles')
        .update({
            granted_permissions: permissions,
            enrolled_by: user.name,
            enrolled_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('id');

    if (error) throw error;
    if (!rows || rows.length === 0) {
        throw new Error('No se pudo guardar: no tienes permiso para editar a este usuario (RLS).');
    }
}

export async function updateUser(userId: string, data: any, { user, can }: Context) {
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
        address: data.address,
        birth_date: data.birthDate,
        emergency_contact_name: data.emergencyContactName,
        emergency_contact_phone: data.emergencyContactPhone,
        employment_status: data.employmentStatus,
        // Los documentos KYC viven en profile_documents (S4); no se escriben aquí.
        // La biometría tampoco: va a la bóveda por `/api/users/enroll`, que es la
        // única vía. Esta función tenía una rama que escribía `biometric_template`
        // en `profiles` y que ningún llamador usaba —se retiró junto con la
        // columna (migración 20260816010000)—; dejarla habría sido un `UPDATE`
        // contra una columna inexistente esperando a que alguien la despertara.
    };

    // Remove undefined values
    Object.keys(updatePayload).forEach(key => {
        if (updatePayload[key] === undefined) {
            delete updatePayload[key];
        }
    });

    const { data: rows, error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', userId)
        .select('id');

    if (error) throw error;
    if (!rows || rows.length === 0) {
        throw new Error('No se pudo guardar: no tienes permiso para editar a este usuario (RLS).');
    }
}

export async function deleteUser(userId: string, { }: Context) {
    const { error } = await supabase
        .from('profiles')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', userId);

    if (error) throw error;
}


// --- Material ---
export async function addMaterial(data: any, { user, tenantId, can }: Context) {
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
            min_stock: materialData.minStock ?? null,
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
            photos: materialData.photos ?? [],
            requires_maintenance: materialData.requiresMaintenance ?? false,
            next_maintenance_date: materialData.nextMaintenanceDate ?? null,
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
            ownership: materialData.ownership || 'propio',
            rental_contract_id: materialData.rentalContractId || null,
            rental_asset_id: materialData.rentalAssetId || null,
            client_id: materialData.clientId || null,
            tenant_id: tenantId,
        })
        .select()
        .single();

    if (materialError) throw materialError;

    // Create Initial Movement
    if (data.stock > 0) {
        // El stock inicial entra al contrato indicado o al pool central.
        const contractId = materialData.contractId ?? null;
        await addToLedger({ tenantId, materialId: newMaterial.id, contractId, qty: data.stock });

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
                contract_id: contractId,
                contract_name: materialData.contractName ?? null,
                tenant_id: tenantId,
            });

        if (movementError) throw movementError;
    }
}

export async function addManualStockEntry(materialId: string, quantity: number, justification: string, { user, tenantId, can }: Context) {
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

    // Entrada manual: al pool central (se reasigna a contrato con transferencia).
    await addToLedger({ tenantId, materialId, contractId: null, qty: quantity });

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

export async function updateMaterial(materialId: string, data: any, { user, tenantId, can }: Context) {
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
        ...(otherData.minStock !== undefined && { min_stock: otherData.minStock === null ? null : otherData.minStock }),
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
        ...(otherData.photos !== undefined && { photos: otherData.photos }),
        ...(otherData.requiresMaintenance !== undefined && { requires_maintenance: otherData.requiresMaintenance }),
        ...(otherData.nextMaintenanceDate !== undefined && { next_maintenance_date: otherData.nextMaintenanceDate }),
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
        // Ajuste de total: el delta se refleja en el pool central (positivo suma;
        // negativo descuenta en cascada pool → contratos).
        if (stockDifference > 0) {
            await addToLedger({ tenantId, materialId, contractId: null, qty: stockDifference });
        } else if (stockDifference < 0) {
            await consumeFromLedger({ tenantId, materialId, contractId: null, qty: -stockDifference });
        }

        const { error: movementError } = await supabase
            .from('stock_movements')
            .insert({
                material_id: materialId,
                material_name: currentMaterial.name,
                quantity_change: stockDifference,
                new_stock: finalStock,
                type: 'adjustment',
                justification: 'Ajuste desde panel de edición',
                user_id: user?.id ?? 'system',
                user_name: user?.name ?? 'Sistema',
                tenant_id: tenantId,
            });

        if (movementError) throw movementError;
    }
}

/**
 * Eliminación de un activo — DISTINTA de la "baja" (RETIRE en la UI, que solo
 * cambia `status` a 'Para Baja'). Reservada a `materials:delete` (hoy solo
 * administrador/soporte-pagnol vía ADMINISTRADOR_PERMISSIONS).
 *
 * Es un borrado SUAVE (`deleted_at`/`deleted_by`/`deletion_reason`), no un
 * DELETE real: `stock_movements.material_id` tiene FK `ON DELETE CASCADE`
 * hacia `materials`, así que borrar la fila de verdad se llevaría por delante
 * TODO el kardex histórico del activo (entradas/salidas/ajustes previos), no
 * solo el evento de eliminación — lo comprobé en la base real. Con soft-delete
 * el activo desaparece de toda la app (useSupabaseCollection con
 * `softDelete: true` lo filtra, mismo patrón que `profiles`/`deleteUser`) pero
 * la fila y su kardex completo quedan intactos para auditoría.
 *
 * Antes de "eliminar": bloquea si hay componentes hijos, devoluciones/retiros
 * pendientes que la referencian, o si viene de un arriendo (ese ciclo de vida
 * lo maneja el módulo Arriendos).
 */
export async function deleteMaterial(materialId: string, reason: string, { user, tenantId, can }: Context) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('materials:delete')) throw new Error('No tienes permiso para eliminar activos.');
    if (!reason?.trim()) throw new Error('Debes indicar el motivo de la eliminación.');

    const { data: material, error: matErr } = await supabase.from('materials').select('*').eq('id', materialId).single();
    if (matErr || !material) throw new Error('Activo no encontrado.');
    if (material.tenant_id !== tenantId) throw new Error('No tienes permiso.');
    if (material.deleted_at) throw new Error('Este activo ya fue eliminado.');

    if (material.rental_asset_id) {
        throw new Error('Este activo proviene de un contrato de arriendo — gestiona su baja desde el módulo Arriendos, no aquí.');
    }

    const [{ count: childCount }, { count: pendingReturns }, { data: pendingRequests }] = await Promise.all([
        supabase.from('materials').select('*', { count: 'exact', head: true }).eq('parent_id', materialId).is('deleted_at', null),
        supabase.from('return_requests').select('*', { count: 'exact', head: true }).eq('material_id', materialId).eq('status', 'pending'),
        supabase.from('material_requests').select('id, items').eq('tenant_id', tenantId).in('status', ['pending', 'approved']),
    ]);
    if ((childCount || 0) > 0) {
        throw new Error(`No se puede eliminar: tiene ${childCount} componente(s) asociado(s). Elimina o reasigna primero los sub-ítems.`);
    }
    if ((pendingReturns || 0) > 0) {
        throw new Error('No se puede eliminar: tiene devoluciones pendientes de este material. Resuélvelas primero.');
    }
    const referencedInRequest = (pendingRequests || []).some((r: any) =>
        Array.isArray(r.items) && r.items.some((it: any) => it.materialId === materialId)
    );
    if (referencedInRequest) {
        throw new Error('No se puede eliminar: hay solicitudes de retiro pendientes o aprobadas que incluyen este material.');
    }

    const now = new Date().toISOString();
    const movId = await nextInternalCode(tenantId, 'MOV');
    const { error: movErr } = await supabase.from('stock_movements').insert({
        id: movId,
        material_id: materialId,
        material_name: material.name,
        quantity_change: -(material.stock || 0),
        new_stock: 0,
        type: 'deletion',
        date: now,
        justification: reason.trim(),
        user_id: user.id,
        user_name: user.name,
        tenant_id: tenantId,
    });
    if (movErr) throw movErr;

    const { error } = await supabase
        .from('materials')
        .update({ deleted_at: now, deleted_by: user.id, deletion_reason: reason.trim() })
        .eq('id', materialId);
    if (error) throw error;
}

// --- Categories & Units ---
// OJO bindContext: el contexto va SIEMPRE al final, así que parentId es
// posicional obligatorio para los llamadores (pasar null si no aplica).
export async function addMaterialCategory(name: string, parentId: string | null, { tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");
    // parent_id solo si viene: así crear categorías planas sigue funcionando
    // aunque la migración 20260703000000 (jerarquía) no esté aplicada aún.
    const row: Record<string, any> = { name, tenant_id: tenantId };
    if (parentId) row.parent_id = parentId;
    const { error } = await supabase
        .from('material_categories')
        .insert(row);
    if (error) throw error;
}

export async function updateMaterialCategory(id: string, data: { name?: string; parentId?: string | null }, { }: Context) {
    const patch: Record<string, any> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.parentId !== undefined) patch.parent_id = data.parentId;
    const { error } = await supabase
        .from('material_categories')
        .update(patch)
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
// Mapea el modelo camelCase de la app a las columnas snake_case de la tabla.
// Solo incluye las claves presentes en `data` (update parcial seguro).
function toSupplierRow(data: any) {
    const row: any = {};
    if ('name' in data) row.name = data.name;
    if ('categories' in data) row.categories = data.categories;
    if ('rut' in data) row.rut = data.rut || null;
    if ('bank' in data) row.bank = data.bank || null;
    if ('accountType' in data) row.account_type = data.accountType || null;
    if ('accountNumber' in data) row.account_number = data.accountNumber || null;
    if ('email' in data) row.email = data.email || null;
    if ('address' in data) row.address = data.address || null;
    if ('phone' in data) row.phone = data.phone || null;
    if ('contacts' in data) row.contacts = data.contacts;
    if ('documents' in data) row.documents = data.documents;
    if ('evaluations' in data) row.evaluations = data.evaluations;
    if ('costCenterId' in data) row.cost_center_id = data.costCenterId || null;
    if ('notes' in data) row.notes = data.notes || null;
    return row;
}

export async function addSupplier(data: any, { tenantId }: Context): Promise<Supplier> {
    if (!tenantId) throw new Error("Inquilino no válido.");
    const { data: inserted, error } = await supabase
        .from('suppliers')
        .insert({ ...toSupplierRow(data), tenant_id: tenantId })
        .select()
        .single();
    if (error) throw error;
    return mappers.suppliers(inserted);
}

export async function updateSupplier(id: string, data: any, { }: Context) {
    const { error } = await supabase
        .from('suppliers')
        .update(toSupplierRow(data))
        .eq('id', id);
    if (error) throw error;
}

// Sube un documento del proveedor al bucket privado y devuelve el metadato
// (con URL firmada de larga duración) para anexarlo al array `documents`.
export async function uploadSupplierDocument(
    supplierId: string,
    file: File,
    meta: { name: string; type?: string; expiresAt?: string },
    { user, tenantId, can }: Context
): Promise<SupplierDocument> {
    if (!user || !tenantId) throw new Error("No autenticado.");
    const ext = file.name.split('.').pop() || 'bin';
    const docId = nanoid();
    const path = `${tenantId}/${supplierId}/${docId}.${ext}`;
    const { error } = await supabase.storage
        .from('supplier-documents')
        .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;

    // Aquí se firmaba por ~10 años y esa URL quedaba guardada en el array
    // `suppliers.documents`. Una firmada persistida es una llave al portador:
    // abre el archivo sin sesión y sin poder revocarse. Ahora sólo se guarda el
    // `path` y la URL se firma en el clic (`<SecureFileLink>`), por 5 minutos.
    return {
        id: docId,
        name: meta.name || file.name,
        type: meta.type,
        path,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user.name,
        expiresAt: meta.expiresAt,
    };
}

// Borra el archivo físico de un documento del proveedor (el array `documents`
// se actualiza aparte vía updateSupplier).
export async function deleteSupplierDocumentFile(path: string, { user, tenantId, can }: Context) {
    if (!user || !tenantId) throw new Error("No autenticado.");
    const { error } = await supabase.storage.from('supplier-documents').remove([path]);
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
export async function createLot(name: string, { user, tenantId, can }: Context) {
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
    if (!tenantId) throw new Error("Inquilino no válido.");

    // Permisos por-tenant: la fila de configuración es (id rol, tenant_id). Si aún
    // no existe para este tenant, se parte de los permisos por defecto (ROLES_DEFAULT).
    const { data: roleData } = await supabase
        .from('roles')
        .select('*')
        .eq('id', role)
        .eq('tenant_id', tenantId)
        .maybeSingle();

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
            tenant_id: tenantId,
            description: ROLES_DEFAULT[role]?.description,
            permissions: newPermissions
        }, { onConflict: 'id,tenant_id' });

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
/**
 * Verifica que el UPDATE haya tocado al menos una fila.
 *
 * Un UPDATE que RLS deja en 0 filas **no devuelve error**: Supabase responde
 * éxito con una lista vacía. Sin esta guarda, la pantalla decía "Partida
 * Aprobada" y en la base no cambiaba nada.
 */
/**
 * Puerta de permisos de una acción de Control de Obras.
 *
 * `can` viene en el contexto y resuelve igual que la pantalla (incluye los
 * permisos que cada empresa personalizó). Hasta ahora estas mutaciones no
 * validaban nada: la única barrera era que el botón estuviera oculto, y las
 * políticas de la base son ciegas al rol — solo separan empresas. Cualquiera
 * con sesión podía aprobar su propia partida desde la consola del navegador.
 */
function exigir(can: Context['can'], permiso: Parameters<Context['can']>[0], accion: string) {
    if (!can(permiso)) throw new Error(`No tienes permiso para ${accion}.`);
}

/**
 * Siguiente código de EDT dentro de un nivel.
 *
 * Toma el mayor de los códigos existentes y suma uno, en vez de contar los
 * hermanos: si se borró uno del medio, contar devuelve un código que YA está en
 * uso. Los códigos no se reciclan — igual que en una obra real, donde la partida
 * 02 no reaparece con otro contenido.
 */
function siguienteCodigo(hermanos: { path: string | null }[] | null, prefijoPadre: string): string {
    const largoPrefijo = prefijoPadre ? prefijoPadre.length + 1 : 0;
    const mayor = (hermanos || []).reduce((max, h) => {
        const ultimo = Number((h.path ?? '').slice(largoPrefijo));
        return Number.isFinite(ultimo) && ultimo > max ? ultimo : max;
    }, 0);
    return String(mayor + 1).padStart(2, '0');
}

function assertPartidaTocada(rows: { id: string }[] | null, accion: string) {
    if (!rows || rows.length === 0) {
        throw new Error(`No se pudo ${accion}: no existe o no tienes permiso para modificarla.`);
    }
}

export async function addWorkItem(data: Omit<WorkItem, 'id' | 'tenantId' | 'progress' | 'path'>, { tenantId, user, can }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");
    if (!user) throw new Error("Usuario no autenticado.");
    exigir(can, 'construction_control:edit_structure', 'crear partidas');

    let path = '';
    // La obra se HEREDA del padre, nunca se recibe del formulario: una partida
    // pertenece a la misma obra que su padre, siempre (RFC-006 F1).
    let workProjectId: string | null = null;
    if (data.parentId) {
        const { data: parentDoc } = await supabase
            .from('work_items')
            .select('path, work_project_id')
            .eq('id', data.parentId)
            .single();

        if (!parentDoc) throw new Error("El ítem padre no existe.");
        workProjectId = parentDoc.work_project_id ?? null;

        // El código sigue al ÚLTIMO hermano, no a la cantidad de hermanos.
        // Contándolos, borrar el 02 y crear otra partida producía un segundo 03:
        // dos partidas distintas con el mismo código de EDT.
        const { data: hermanos } = await supabase
            .from('work_items')
            .select('path')
            .eq('parent_id', data.parentId);

        path = `${parentDoc.path}/${siguienteCodigo(hermanos, parentDoc.path)}`;
    } else {
        // Desde RFC-006 F1 una raíz sin obra ya no puede existir: sería una
        // partida que ninguna pantalla del módulo muestra (todas filtran por
        // obra). Las raíces las crea addWorkProject junto con su obra.
        throw new Error('Para crear una obra usa "Nueva Obra". Una partida siempre cuelga de una obra existente.');
    }

    const { error } = await supabase
        .from('work_items')
        .insert({
            name: data.name,
            type: data.type,
            work_project_id: workProjectId ?? data.workProjectId ?? null,
            // Puente WBS↔contratos (ADR-004 §1): solo tiene sentido en la raíz.
            contract_id: data.parentId ? null : (data.contractId ?? null),
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

export async function updateWorkItem(id: string, data: Partial<WorkItem>, { can }: Context) {
    exigir(can, 'construction_control:edit_structure', 'editar partidas');
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
    if ('contractId' in data) snakeData.contract_id = data.contractId;

    // `.select()` acá cumple doble función: detecta el UPDATE silencioso de 0
    // filas y devuelve la fila para saber si es la raíz de una obra.
    const { data: rows, error } = await supabase
        .from('work_items')
        .update(snakeData)
        .eq('id', id)
        .select('id, parent_id, work_project_id, name');
    if (error) throw error;
    assertPartidaTocada(rows, 'guardar los cambios de la partida');

    // La raíz de la EDT y la obra comparten nombre (RFC-006 D9). Renombrar la
    // raíz desde el Gantt dejaba el selector de obras diciendo un nombre y el
    // EDT otro; `updateWorkProject` ya sincroniza en el sentido contrario.
    const fila = rows![0] as { parent_id: string | null; work_project_id: string | null; name: string };
    if ('name' in data && fila.parent_id === null && fila.work_project_id) {
        await supabase
            .from('work_projects')
            .update({ name: fila.name, updated_at: new Date().toISOString() })
            .eq('id', fila.work_project_id);
    }
}

export async function deleteWorkItem(id: string, { can }: Context) {
    exigir(can, 'construction_control:edit_structure', 'eliminar partidas');
    // La raíz de una obra no se borra por su cuenta: sin ella la obra queda sin
    // árbol, el EDT no tiene de qué colgar partidas nuevas y la obra se vuelve
    // inservible sin forma de recuperarla desde la pantalla. Una obra recién
    // creada tiene su raíz sin hijos y sin avances, así que los guards de abajo
    // la dejaban pasar.
    const { data: item } = await supabase
        .from('work_items')
        .select('parent_id, work_project_id')
        .eq('id', id)
        .maybeSingle();
    if (item && item.parent_id === null && item.work_project_id) {
        throw new Error('Esta es la obra completa, no una partida. Para eliminarla usa "Editar obra" en Partidas (EDT).');
    }

    const [{ count: childCount }, { count: logCount }] = await Promise.all([
        supabase.from('work_items').select('*', { count: 'exact', head: true }).eq('parent_id', id),
        supabase.from('progress_logs').select('*', { count: 'exact', head: true }).eq('work_item_id', id),
    ]);
    if ((childCount || 0) > 0) {
        throw new Error(`No se puede eliminar: tiene ${childCount} sub-partida(s). Elimina primero las sub-partidas.`);
    }
    if ((logCount || 0) > 0) {
        throw new Error(`No se puede eliminar: tiene ${logCount} registro(s) de avance asociados.`);
    }

    // Una partida que ya viajó en un estado de pago no se borra: el EP la
    // cobró. El documento guarda su propia copia y no se corrompe, pero el
    // avance de la obra —que se recalcula en vivo— dejaría de cuadrar con lo
    // que se facturó, sin rastro de por qué.
    // `contains` recibe el JSON como STRING a propósito: supabase-js, cuando le
    // pasas un array de JavaScript, lo serializa como array de Postgres
    // (`{[object Object]}`) en vez de como JSON, y el filtro no matchea NUNCA —
    // la guarda existiría y jamás se dispararía. Con un string lo manda tal cual.
    const { data: eps, error: epsError } = await supabase
        .from('payment_states')
        .select('internal_code, status')
        .contains('items', JSON.stringify([{ id }]));
    if (epsError) throw epsError;
    const vigentes = (eps || []).filter(ep => ep.status !== 'annulled');
    if (vigentes.length > 0) {
        const codigos = vigentes.map(ep => ep.internal_code).filter(Boolean).join(', ');
        throw new Error(
            `No se puede eliminar: esta partida ya se cobró en ${vigentes.length} estado(s) de pago${codigos ? ` (${codigos})` : ''}.`,
        );
    }

    const { error } = await supabase
        .from('work_items')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

export async function addWorkItemProgress(workItemId: string, quantity: number, date: Date, observations: string | undefined, { user, tenantId, can }: Context) {
    if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");
    exigir(can, 'construction_control:register_progress', 'registrar avance');

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

export async function submitForQualityReview(workItemId: string, { can }: Context) {
    exigir(can, 'module_construction_control:view', 'enviar partidas a revisión');
    const { data: rows, error } = await supabase
        .from('work_items')
        .update({
            status: 'pending-quality-review',
            actual_end_date: new Date().toISOString(),
        })
        .eq('id', workItemId)
        .select('id');
    if (error) throw error;
    assertPartidaTocada(rows, 'enviar la partida a revisión');
}

export async function rejectWorkItem(workItemId: string, reason: string, { user, can }: Context) {
    exigir(can, 'construction_control:review_protocols', 'rechazar partidas');
    const { data: rows, error } = await supabase
        .from('work_items')
        .update({
            status: 'rejected',
            rejection_reason: reason || 'Rechazado por Control de Calidad.',
            reviewed_by: user?.id ?? null,
            reviewed_at: new Date().toISOString(),
        })
        .eq('id', workItemId)
        .select('id');
    if (error) throw error;
    assertPartidaTocada(rows, 'rechazar la partida');
}

export async function approveWorkItem(workItemId: string, { user, can }: Context) {
    exigir(can, 'construction_control:review_protocols', 'aprobar partidas');
    const { data: rows, error } = await supabase
        .from('work_items')
        .update({
            status: 'completed',
            reviewed_by: user?.id ?? null,
            reviewed_at: new Date().toISOString(),
        })
        .eq('id', workItemId)
        .select('id');
    if (error) throw error;
    assertPartidaTocada(rows, 'aprobar la partida');
}

// addPaymentState y la máquina de estados del EP viven en paymentStateMutations.ts (F2).

