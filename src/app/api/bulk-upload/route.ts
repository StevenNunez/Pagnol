import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/modules/core/lib/admin";
import { getInitials } from "@/modules/core/lib/sequence-utils";
import { randomUUID } from 'node:crypto';

export const maxDuration = 300; // 5 min — para lotes grandes en Vercel

// Valores que acepta el constraint materials_usage_type_check en Supabase
const VALID_USAGE_TYPES = [
    'Consumible',
    'Reutilizable Controlado',
    'Herramienta Menor',
    'Repuesto Crítico',
    'Activo Fijo',
    'IT Controlado',
] as const;
type UsageType = typeof VALID_USAGE_TYPES[number];

// Mapea variantes/errores comunes → valor canónico (incluyendo valores legacy de la DB)
const USAGE_TYPE_ALIASES: Record<string, UsageType> = {
    // Valores legacy del constraint original
    'retornable': 'Reutilizable Controlado',
    'permanente': 'Activo Fijo',
    // Variantes parciales
    'reutilizable': 'Reutilizable Controlado',
    'herramienta': 'Herramienta Menor',
    'activo': 'Activo Fijo',
    'fijo': 'Activo Fijo',
    'repuesto': 'Repuesto Crítico',
    'critico': 'Repuesto Crítico',
    'crítico': 'Repuesto Crítico',
    'it': 'IT Controlado',
};

function sanitizeUsageType(raw: string | undefined | null): UsageType {
    const trimmed = (raw || '').trim();
    if ((VALID_USAGE_TYPES as readonly string[]).includes(trimmed)) return trimmed as UsageType;
    const lower = trimmed.toLowerCase();
    return USAGE_TYPE_ALIASES[lower] ?? 'Consumible';
}

const VALID_STATUS = ['Disponible', 'En Mantenimiento', 'Para Baja', 'Extraviado', 'En Uso'] as const;
type AssetStatus = typeof VALID_STATUS[number];
function sanitizeStatus(raw: string | undefined | null): AssetStatus {
    const trimmed = (raw || '').trim();
    return (VALID_STATUS as readonly string[]).includes(trimmed) ? (trimmed as AssetStatus) : 'Disponible';
}

const VALID_CLASS = ['A', 'B', 'C'] as const;
function sanitizeClass(raw: string | undefined | null): 'A' | 'B' | 'C' {
    const trimmed = (raw || '').trim().toUpperCase();
    return (['A', 'B', 'C'] as string[]).includes(trimmed) ? (trimmed as 'A' | 'B' | 'C') : 'B';
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { assets, tenantId, user, customUsageTypeMap = {} } = body;

        if (!tenantId || !assets || !Array.isArray(assets)) {
            return NextResponse.json(
                { success: false, error: "Missing required fields: tenantId, assets" },
                { status: 400 }
            );
        }

        // 1. Fetch Tenant Name and existing Categories
        const [tenantRes, categoriesRes] = await Promise.all([
            supabaseAdmin.from('tenants').select('name').eq('id', tenantId).single(),
            supabaseAdmin.from('material_categories').select('name').eq('tenant_id', tenantId)
        ]);

        const tenantName = tenantRes.data?.name || "PAG";
        const prefix = getInitials(tenantName);
        const existingCategoryNames = new Set((categoriesRes.data || []).map(c => c.name));

        // 2. Detect missing categories and create them
        const uniqueCategoriesInBatch = Array.from(new Set(assets.map(a => a.category)));
        const missingCategories = uniqueCategoriesInBatch.filter(cat => !existingCategoryNames.has(cat));

        if (missingCategories.length > 0) {
            const categoriesToInsert = missingCategories.map(name => ({
                name,
                tenant_id: tenantId
            }));
            const { error: catError } = await supabaseAdmin.from('material_categories').insert(categoriesToInsert);
            if (catError) throw catError;
        }

        // 3. Fetch all existing materials to detect duplicates (High Volume Support)
        const fetchAllExisting = async () => {
            let all: any[] = [];
            let from = 0;
            const step = 1000;
            let hasMore = true;
            while (hasMore) {
                const { data, error } = await supabaseAdmin
                    .from('materials')
                    .select('id, name, serial_number')
                    .eq('tenant_id', tenantId)
                    .range(from, from + step - 1);
                if (error) throw error;
                if (data && data.length > 0) {
                    all = [...all, ...data];
                    from += data.length;
                    if (data.length < step) hasMore = false;
                } else {
                    hasMore = false;
                }
            }
            return all;
        };

        const existingMaterials = await fetchAllExisting();
        // Map nameKey → existing material id for targeted updates
        const existingMap = new Map<string, string>(
            existingMaterials?.map(m => [
                `${m.name?.trim().toLowerCase()}_${m.serial_number?.trim().toLowerCase() || ''}`,
                m.id
            ])
        );

        // 4. Leer contadores (mismas claves que usa el RPC: _ACT y _MOV)
        const materialCounterId = `${tenantId}_ACT`;
        const movementCounterId = `${tenantId}_MOV`;

        const { data: counters } = await supabaseAdmin
            .from('counters')
            .select('id, last_sequence')
            .in('id', [materialCounterId, movementCounterId]);

        let materialCounter = counters?.find(c => c.id === materialCounterId)?.last_sequence || 0;
        let movementCounter = counters?.find(c => c.id === movementCounterId)?.last_sequence || 0;

        const startAssetSeq = materialCounter + 1;

        const materialsToInsert: any[] = [];
        const movementsToInsert: any[] = [];
        const materialsToUpdate: Array<{ id: string; patch: any }> = [];
        let duplicatesFound = 0;

        for (const asset of assets) {
            const { validationErrors, validationStatus, action, isDuplicate, duplicateId, tempId, category, usageType, ...materialData } = asset;

            const nameKey = `${materialData.name?.trim().toLowerCase()}_${materialData.serialNumber?.trim().toLowerCase() || ''}`;
            const existingId = existingMap.get(nameKey);

            if (existingId) {
                if (action === 'update') {
                    const customUsageType = customUsageTypeMap[category];
                    materialsToUpdate.push({
                        id: existingId,
                        patch: {
                            name: materialData.name,
                            category: category,
                            description: materialData.description,
                            serial_number: materialData.serialNumber,
                            is_it_asset: materialData.isITAsset,
                            stock: materialData.stock || 0,
                            unit: materialData.unit || 'und',
                            unit_cost: materialData.unitCost || 0,
                            criticality: sanitizeClass(materialData.class),
                            usage_type: sanitizeUsageType(customUsageType || usageType),
                            status: sanitizeStatus(materialData.status),
                            updated_at: new Date().toISOString(),
                        }
                    });
                } else {
                    duplicatesFound++;
                }
                continue;
            }

            const customUsageType = customUsageTypeMap[category];
            const hasStock = (materialData.stock || 0) > 0;

            materialCounter++;
            const assetId = `${prefix}-ACT-${String(materialCounter).padStart(4, '0')}`;

            const materialUuid = randomUUID();
            materialsToInsert.push({
                id: materialUuid,
                internal_code: assetId,
                name: materialData.name,
                category: category,
                description: materialData.description,
                serial_number: materialData.serialNumber,
                is_it_asset: materialData.isITAsset,
                stock: materialData.stock || 0,
                unit: materialData.unit || 'und',
                unit_cost: materialData.unitCost || 0,
                criticality: sanitizeClass(materialData.class),
                usage_type: sanitizeUsageType(customUsageType || usageType),
                status: sanitizeStatus(materialData.status),
                tenant_id: tenantId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            });

            if (hasStock) {
                movementCounter++;
                const movementId = `${prefix}-MOV-${String(movementCounter).padStart(5, '0')}`;
                movementsToInsert.push({
                    id: movementId,
                    material_id: materialUuid,
                    material_name: materialData.name,
                    quantity_change: materialData.stock,
                    new_stock: materialData.stock,
                    type: 'initial',
                    date: new Date().toISOString(),
                    justification: 'Stock inicial desde carga masiva',
                    user_id: user?.id || 'system',
                    user_name: user?.name || 'Administrador',
                    tenant_id: tenantId,
                });
            }
        }

        // 5. Execute Inserts and Updates in safe batches (prevents Supabase payload overflow)
        const BATCH = 500;

        for (let i = 0; i < materialsToInsert.length; i += BATCH) {
            const { error } = await supabaseAdmin
                .from('materials')
                .insert(materialsToInsert.slice(i, i + BATCH));
            if (error) throw error;
        }

        // Updates run in parallel groups of 50 to avoid connection saturation
        const UPDATE_CHUNK = 50;
        for (let i = 0; i < materialsToUpdate.length; i += UPDATE_CHUNK) {
            await Promise.all(
                materialsToUpdate.slice(i, i + UPDATE_CHUNK).map(({ id, patch }) =>
                    supabaseAdmin.from('materials').update(patch).eq('id', id)
                        .then(({ error }) => { if (error) throw error; })
                )
            );
        }

        for (let i = 0; i < movementsToInsert.length; i += BATCH) {
            const { error } = await supabaseAdmin
                .from('stock_movements')
                .insert(movementsToInsert.slice(i, i + BATCH));
            if (error) throw error;
        }

        // 6. Update Counters
        const countersToUpsert = [
            { id: materialCounterId, tenant_id: tenantId, entity_type: 'ACT', last_sequence: materialCounter, last_updated: new Date().toISOString() },
            { id: movementCounterId, tenant_id: tenantId, entity_type: 'MOV', last_sequence: movementCounter, last_updated: new Date().toISOString() }
        ];
        const { error: countError } = await supabaseAdmin.from('counters').upsert(countersToUpsert);
        if (countError) throw countError;

        return NextResponse.json({
            success: true,
            inserted: materialsToInsert.length,
            updated: materialsToUpdate.length,
            duplicates: duplicatesFound,
            idRange: materialsToInsert.length > 0 ? `${prefix}-AST-${String(startAssetSeq).padStart(4, '0')} to -${String(materialCounter).padStart(4, '0')}` : 'N/A'
        });

    } catch (error: any) {
        console.error("Error en bulk upload:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
