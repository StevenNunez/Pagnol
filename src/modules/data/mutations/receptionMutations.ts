import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { nanoid } from 'nanoid';
import type { ReceiptItem, ReceiptPhoto } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

const RECEPTION_BUCKET = 'reception-photos';

// Sube una foto de evidencia de la recepción al bucket privado y devuelve su
// metadata (URL firmada ~10 años). La compresión se hace en el cliente antes.
export async function uploadReceptionPhoto(
    purchaseOrderId: string,
    file: File,
    { user, tenantId }: Context,
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
    { user, tenantId }: Context,
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

    const { error: movErr } = await supabase.from('stock_movements').insert({
        material_id: materialId,
        material_name: existingMat.name || item.name,
        quantity_change: item.receivedQuantity,
        new_stock: (existingMat.stock || 0) + item.receivedQuantity,
        type: 'request-delivery',
        justification: `Recepción de OC ${poCode}`,
        user_id: user!.id,
        user_name: user!.name,
        tenant_id: tenantId,
    });
    if (movErr) throw movErr;

    return materialId!;
}

// Registra un evento de recepción (parcial o total) contra una OC: ingresa el
// stock de cada ítem recibido, guarda la recepción con fotos de evidencia y, si
// con esto queda completa la OC, la marca 'completed' y sus solicitudes 'received'.
export async function receiveGoodsReceipt(
    data: {
        purchaseOrderId: string;
        items: ReceiptItem[];
        photos: ReceiptPhoto[];
        notes?: string;
    },
    { user, tenantId }: Context,
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

    // Ingreso de stock + resolución de materialId definitivo por ítem.
    const ingestedItems: ReceiptItem[] = [];
    for (const it of toReceive) {
        const materialId = await ingestStock(it, poCode, { user, tenantId });
        ingestedItems.push({ ...it, materialId });
    }

    const receiptCode = await nextInternalCode(tenantId, 'REC');
    const { error: insErr } = await supabase.from('goods_receipts').insert({
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
    });
    if (insErr) throw insErr;

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

export async function deleteGoodsReceipt(id: string, { tenantId }: Context): Promise<void> {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const { error } = await supabase.from('goods_receipts').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
}
