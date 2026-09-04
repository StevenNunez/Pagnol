import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { nanoid } from 'nanoid';
import type { ReceiptItem, ReceiptPhoto } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';
import { addToLedger, consumeFromLedger } from './stockLedger';
import { emitFinanceEntries, reverseEntriesForSource, type FinanceEntryInput } from './financeLedger';

const RECEPTION_BUCKET = 'reception-photos';

// Sube una foto de evidencia de la recepción al bucket privado y devuelve su
// metadata (URL firmada ~10 años). La compresión se hace en el cliente antes.
export async function uploadReceptionPhoto(
    purchaseOrderId: string,
    file: File,
    { user, tenantId, can }: Context,
): Promise<ReceiptPhoto> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    const ext = file.name.split('.').pop() || 'jpg';
    const photoId = nanoid();
    const path = `${tenantId}/${purchaseOrderId}/${photoId}.${ext}`;
    const { error } = await supabase.storage
        .from(RECEPTION_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    const { data: signed, error: signError } = await supabase.storage
        .from(RECEPTION_BUCKET)
        .createSignedUrl(path, 315360000);
    if (signError) throw signError;
    return { id: photoId, url: signed.signedUrl, path, name: file.name, date: new Date().toISOString() };
}

// Suma lo ya recibido por ítem en recepciones previas de una OC.
async function getAlreadyReceived(purchaseOrderId: string, tenantId: string): Promise<Map<string, number>> {
    const { data, error } = await supabase
        .from('goods_receipts')
        .select('items')
        .eq('purchase_order_id', purchaseOrderId)
        .eq('tenant_id', tenantId);
    if (error) throw error;
    const acc = new Map<string, number>();
    for (const row of data || []) {
        for (const it of (row.items || []) as ReceiptItem[]) {
            acc.set(it.itemId, (acc.get(it.itemId) || 0) + (it.receivedQuantity || 0));
        }
    }
    return acc;
}

// Ingresa al stock la cantidad recibida de un ítem: actualiza/crea el material
// y registra el movimiento. Si no se indicó materialId, intenta calzar por
// nombre y si no existe crea el material (patrón de receivePurchaseRequest).
async function ingestStock(
    item: ReceiptItem,
    poCode: string,
    contract: { contractId: string | null; contractName: string | null },
    { user, tenantId, can }: Context,
): Promise<string> {
    let materialId = item.materialId;
    let existingMat: any = null;

    if (materialId) {
        const { data } = await supabase.from('materials').select('stock, name').eq('id', materialId).single();
        existingMat = data;
    }

    if (!existingMat) {
        const newMatCode = await nextInternalCode(tenantId!, 'ACT');
        const { data: newMat, error: newMatErr } = await supabase.from('materials').insert({
            internal_code: newMatCode,
            name: item.name,
            stock: item.receivedQuantity,
            unit: item.unit,
            category: 'Recepción',
            tenant_id: tenantId,
            archived: false,
        }).select().single();
        if (newMatErr) throw newMatErr;
        materialId = newMat.id;
        existingMat = { stock: 0, name: item.name };
    } else {
        const { error: updErr } = await supabase
            .from('materials')
            .update({ stock: (existingMat.stock || 0) + item.receivedQuantity })
            .eq('id', materialId);
        if (updErr) throw updErr;
    }

    // El stock recibido entra al desglose del contrato de la solicitud de compra.
    await addToLedger({
        tenantId: tenantId!,
        materialId: materialId!,
        contractId: contract.contractId,
        qty: item.receivedQuantity,
    });

    const { error: movErr } = await supabase.from('stock_movements').insert({
        material_id: materialId,
        material_name: existingMat.name || item.name,
        quantity_change: item.receivedQuantity,
        new_stock: (existingMat.stock || 0) + item.receivedQuantity,
        type: 'request-delivery',
        justification: `Recepción de OC ${poCode}`,
        user_id: user!.id,
        user_name: user!.name,
        contract_id: contract.contractId,
        contract_name: contract.contractName,
        tenant_id: tenantId,
    });
    if (movErr) throw movErr;

    return materialId!;
}

type ContractRef = { contractId: string | null; contractName: string | null };

// Contrato de origen por ítem de una OC. Dos formas de calzar ítem → solicitud
// de compra (que lleva contract_id): por id (OC de createPurchaseOrder, donde
// item.id = requestId) y, si no, por nombre de material (OC de
// generatePurchaseOrder, que agrupa por nombre sin id). Sin match ⇒ pool central.
// Compartida por recepción y su reverso: misma data ⇒ misma resolución.
async function resolveContractRefs(po: any): Promise<{
    contractByRequest: Map<string, ContractRef>;
    contractByName: Map<string, ContractRef>;
}> {
    const contractByRequest = new Map<string, ContractRef>();
    const contractByName = new Map<string, ContractRef>();
    if ((po.request_ids || []).length) {
        const { data: reqs } = await supabase
            .from('purchase_requests')
            .select('id, material_name, contract_id, contract_name')
            .in('id', po.request_ids);
        for (const r of reqs || []) {
            const ref: ContractRef = { contractId: r.contract_id || null, contractName: r.contract_name || null };
            contractByRequest.set(r.id, ref);
            const nameKey = (r.material_name || '').trim().toLowerCase();
            if (!nameKey) continue;
            const prev = contractByName.get(nameKey);
            // Nombre repetido con contratos distintos ⇒ ambiguo, va al pool central.
            if (prev && prev.contractId !== ref.contractId) contractByName.set(nameKey, { contractId: null, contractName: null });
            else if (!prev) contractByName.set(nameKey, ref);
        }
    }
    return { contractByRequest, contractByName };
}

const itemContract = (
    maps: { contractByRequest: Map<string, ContractRef>; contractByName: Map<string, ContractRef> },
    it: { itemId: string; name: string },
): ContractRef =>
    maps.contractByRequest.get(it.itemId) ||
    maps.contractByName.get((it.name || '').trim().toLowerCase()) ||
    { contractId: null, contractName: null };

// Precio unitario neto por ítem de la OC: por id (requestId) y por nombre.
function priceMaps(po: any): { byId: Map<string, number>; byName: Map<string, number> } {
    const byId = new Map<string, number>();
    const byName = new Map<string, number>();
    for (const pi of (po.items || []) as { id?: string; name?: string; price?: number }[]) {
        const price = Number(pi.price) || 0;
        if (price <= 0) continue;
        if (pi.id) byId.set(pi.id, price);
        const nameKey = (pi.name || '').trim().toLowerCase();
        if (nameKey && !byName.has(nameKey)) byName.set(nameKey, price);
    }
    return { byId, byName };
}

// Registra un evento de recepción (parcial o total) contra una OC: ingresa el
// stock de cada ítem recibido, guarda la recepción con fotos de evidencia y, si
// con esto queda completa la OC, la marca 'completed' y sus solicitudes 'received'.
// Emite el hecho financiero "devengado" por ítem y retroalimenta el precio del
// catálogo (materials.unit_cost) con el precio real de compra.
export async function receiveGoodsReceipt(
    data: {
        purchaseOrderId: string;
        items: ReceiptItem[];
        photos: ReceiptPhoto[];
        notes?: string;
    },
    { user, tenantId, can }: Context,
): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const toReceive = (data.items || []).filter((it) => (it.receivedQuantity || 0) > 0);
    if (!toReceive.length) throw new Error('Indica al menos una cantidad recibida.');

    const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('id', data.purchaseOrderId)
        .single();
    if (poErr || !po) throw new Error('Orden de Compra no encontrada.');
    if (po.tenant_id !== tenantId) throw new Error('No tienes permiso.');
    if (po.status === 'cancelled') throw new Error('La OC está cancelada.');
    if (po.status === 'completed') throw new Error('La OC ya fue recibida en su totalidad.');

    const poCode = po.internal_code || po.official_oc_id || po.id;
    const contractMaps = await resolveContractRefs(po);
    const prices = priceMaps(po);

    // RFC-004 F2: una OC de servicio se RECIBE como conformidad de ejecución.
    // No hay nada que guardar en el pañol, así que no se crea material, no se
    // suma stock, no se escribe kardex y no se retroalimenta el catálogo. Si
    // se hiciera, quedaría un activo fantasma ("mantención de compresor",
    // stock 1) que además entraría en la valorización del inventario.
    const isServiceOrder = po.order_type === 'servicio';

    // Ingreso de stock + resolución de materialId definitivo por ítem.
    const ingestedItems: ReceiptItem[] = [];
    for (const it of toReceive) {
        if (isServiceOrder) {
            // Sin materialId: el reverso de la recepción también salta estos
            // ítems, así que un servicio nunca devuelve stock que nunca entró.
            ingestedItems.push({ ...it, materialId: undefined });
            continue;
        }
        const contract = itemContract(contractMaps, it);
        const materialId = await ingestStock(it, poCode, contract, { user, tenantId, can });
        ingestedItems.push({ ...it, materialId });

        // Retroalimentación de precios (decisión F0): el precio real de compra
        // pasa a ser el precio actual del catálogo para ese material.
        const price = prices.byId.get(it.itemId) ?? prices.byName.get((it.name || '').trim().toLowerCase());
        if (price && materialId) {
            await supabase.from('materials').update({ unit_cost: price }).eq('id', materialId).eq('tenant_id', tenantId);
        }
    }

    const receiptCode = await nextInternalCode(tenantId, 'REC');
    const { data: receipt, error: insErr } = await supabase.from('goods_receipts').insert({
        internal_code: receiptCode,
        purchase_order_id: po.id,
        purchase_order_code: poCode,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name || '',
        items: ingestedItems,
        photos: data.photos || [],
        notes: data.notes || null,
        received_by: user.id,
        received_by_name: user.name,
        received_at: new Date().toISOString(),
        tenant_id: tenantId,
    }).select('id').single();
    if (insErr) throw insErr;

    // Emisor financiero: devengado por ítem recibido. Precio de la OC; si la OC
    // es legacy sin valorizar, cae al costo de catálogo del material (y el hecho
    // lo declara en sus notas — dato estimado, no precio de compra real).
    const financeEntries: FinanceEntryInput[] = [];
    for (const it of ingestedItems) {
        const contract = itemContract(contractMaps, it);
        const ocPrice = prices.byId.get(it.itemId) ?? prices.byName.get((it.name || '').trim().toLowerCase());
        let price = ocPrice ?? 0;
        let priceNote = '';
        if (!price && it.materialId) {
            const { data: mat } = await supabase.from('materials').select('unit_cost').eq('id', it.materialId).single();
            price = Number(mat?.unit_cost) || 0;
            priceNote = ' — precio de catálogo (OC sin valorizar)';
        }
        // Un producto sin precio conocible no inventa un hecho: queda en el
        // stock igual y el costo se puede corregir después. Un SERVICIO sin
        // precio no deja rastro de ninguna clase —no hay stock que lo
        // evidencie—, así que desaparecería del margen del contrato en
        // silencio. Por eso ahí se corta en vez de continuar.
        if (!price && isServiceOrder) {
            throw new Error(
                `El servicio "${it.name}" no tiene precio en la OC ${poCode}. Sin monto no queda registrado el gasto: valoriza la orden antes de dar la conformidad.`,
            );
        }
        if (!price) continue;
        financeEntries.push({
            nature: 'cost',
            stage: 'accrued',
            category: isServiceOrder ? 'services' : 'materials',
            amountNet: price * (it.receivedQuantity || 0),
            contractId: contract.contractId,
            contractName: contract.contractName,
            sourceType: 'goods_receipt',
            sourceId: receipt.id,
            sourceCode: receiptCode,
            counterpartyType: 'supplier',
            counterpartyId: po.supplier_id,
            counterpartyName: po.supplier_name || null,
            notes: isServiceOrder
                ? `Conformidad de servicio — OC ${poCode} — ${it.name}${priceNote}`
                : `Recepción OC ${poCode} — ${it.name} × ${it.receivedQuantity}${priceNote}`,
        });
    }
    await emitFinanceEntries(financeEntries, { user, tenantId, can });

    // ¿Quedó completa la OC? Sumamos lo recibido históricamente (ya incluye esta
    // recepción) y comparamos con lo ordenado de cada ítem.
    const received = await getAlreadyReceived(po.id, tenantId);
    const poItems: { id?: string; name: string; totalQuantity: number }[] = po.items || [];
    const isComplete = poItems.every((pi, idx) => {
        const key = pi.id || `${pi.name}#${idx}`;
        return (received.get(key) || 0) >= (pi.totalQuantity || 0);
    });

    if (isComplete) {
        await supabase
            .from('purchase_orders')
            .update({ status: 'completed', processed_at: new Date().toISOString(), processed_by: user.id })
            .eq('id', po.id)
            .eq('tenant_id', tenantId);

        for (const reqId of (po.request_ids || [])) {
            await supabase
                .from('purchase_requests')
                .update({ status: 'received', received_at: new Date().toISOString() })
                .eq('id', reqId)
                .eq('tenant_id', tenantId);
        }
    }
}

// Elimina una recepción REVERSANDO todo lo que produjo. Fix F0: antes borraba
// solo la fila de goods_receipts y el stock ingresado quedaba inflado para
// siempre (violaba el espíritu del Art. 3 — los ledgers cuadran).
export async function deleteGoodsReceipt(id: string, { user, tenantId, can }: Context): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const { data: receipt, error: rErr } = await supabase
        .from('goods_receipts')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();
    if (rErr || !receipt) throw new Error('Recepción no encontrada.');

    const { data: po } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('id', receipt.purchase_order_id)
        .single();
    const contractMaps = po
        ? await resolveContractRefs(po)
        : { contractByRequest: new Map<string, ContractRef>(), contractByName: new Map<string, ContractRef>() };

    // 1. Reverso de stock por ítem: total del material, desglose por contrato
    //    (misma resolución que usó la recepción) y kardex negativo.
    for (const it of (receipt.items || []) as ReceiptItem[]) {
        const qty = it.receivedQuantity || 0;
        if (!qty || !it.materialId) continue;

        const { data: mat } = await supabase
            .from('materials')
            .select('stock, name')
            .eq('id', it.materialId)
            .single();
        if (!mat) continue;

        const newStock = Math.max(0, (mat.stock || 0) - qty);
        const { data: updRows, error: updErr } = await supabase
            .from('materials')
            .update({ stock: newStock })
            .eq('id', it.materialId)
            .eq('tenant_id', tenantId)
            .select('id');
        if (updErr) throw updErr;
        if (!updRows || updRows.length === 0) throw new Error('No se pudo revertir el stock (RLS).');

        const contract = itemContract(contractMaps, it);
        await consumeFromLedger({
            tenantId,
            materialId: it.materialId,
            contractId: contract.contractId,
            qty,
        });

        await supabase.from('stock_movements').insert({
            material_id: it.materialId,
            material_name: mat.name || it.name,
            quantity_change: -qty,
            new_stock: newStock,
            type: 'adjustment',
            justification: `Reverso de recepción ${receipt.internal_code || id}`,
            user_id: user.id,
            user_name: user.name,
            contract_id: contract.contractId,
            contract_name: contract.contractName,
            tenant_id: tenantId,
        });
    }

    // 2. Si la recepción había completado la OC, ésta vuelve a estar abierta.
    if (po && po.status === 'completed') {
        await supabase
            .from('purchase_orders')
            .update({ status: po.official_oc_id ? 'issued' : 'generated' })
            .eq('id', po.id)
            .eq('tenant_id', tenantId);
        for (const reqId of (po.request_ids || [])) {
            await supabase
                .from('purchase_requests')
                .update({ status: 'ordered', received_at: null })
                .eq('id', reqId)
                .eq('tenant_id', tenantId);
        }
    }

    // 3. Reverso de los hechos financieros devengados por esta recepción.
    await reverseEntriesForSource('goods_receipt', id, `Recepción eliminada por ${user.name}`, { user, tenantId, can });

    const { error } = await supabase.from('goods_receipts').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
}
