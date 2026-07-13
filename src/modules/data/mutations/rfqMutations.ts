import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { nanoid } from 'nanoid';
import type { QuoteItem, QuoteResponse } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

const RFQ_BUCKET = 'rfq-quotes';

// Lee el array de respuestas actual de una RFQ (para mutaciones read-modify-write).
async function getResponses(rfqId: string, tenantId: string): Promise<QuoteResponse[]> {
    const { data, error } = await supabase
        .from('quote_requests')
        .select('responses, tenant_id')
        .eq('id', rfqId)
        .single();
    if (error || !data) throw new Error('RFQ no encontrada.');
    if (data.tenant_id !== tenantId) throw new Error('No tienes permiso.');
    return (data.responses || []) as QuoteResponse[];
}

export async function addQuoteRequest(
    data: { title: string; requestIds: string[]; items: QuoteItem[]; supplierIds: string[]; deadline?: string; notes?: string },
    { user, tenantId }: Context,
) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!data.items?.length) throw new Error('La RFQ necesita al menos un ítem.');
    if (!data.supplierIds?.length) throw new Error('Invita al menos un proveedor.');

    const internalCode = await nextInternalCode(tenantId, 'RFQ');
    const { error } = await supabase.from('quote_requests').insert({
        internal_code: internalCode,
        title: data.title || internalCode,
        status: 'draft',
        request_ids: data.requestIds || [],
        items: data.items,
        supplier_ids: data.supplierIds,
        responses: [],
        deadline: data.deadline || null,
        notes: data.notes || null,
        created_by: user.id,
        created_by_name: user.name,
        tenant_id: tenantId,
    });
    if (error) throw error;
}

export async function updateQuoteRequest(id: string, data: any, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const row: any = {};
    if ('title' in data) row.title = data.title;
    if ('status' in data) row.status = data.status;
    if ('requestIds' in data) row.request_ids = data.requestIds;
    if ('items' in data) row.items = data.items;
    if ('supplierIds' in data) row.supplier_ids = data.supplierIds;
    if ('responses' in data) row.responses = data.responses;
    if ('deadline' in data) row.deadline = data.deadline || null;
    if ('notes' in data) row.notes = data.notes || null;
    const { error } = await supabase.from('quote_requests').update(row).eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function deleteQuoteRequest(id: string, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const { error } = await supabase.from('quote_requests').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function sendQuoteRequest(id: string, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const { error } = await supabase.from('quote_requests').update({ status: 'sent' }).eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function closeQuoteRequest(id: string, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const { error } = await supabase.from('quote_requests').update({ status: 'closed' }).eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function addQuoteResponse(
    rfqId: string,
    response: Omit<QuoteResponse, 'id' | 'createdAt' | 'createdBy'>,
    { user, tenantId }: Context,
) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    const current = await getResponses(rfqId, tenantId);
    const next: QuoteResponse[] = [
        ...current,
        { ...response, id: nanoid(), createdAt: new Date().toISOString(), createdBy: user.id },
    ];
    const { error } = await supabase.from('quote_requests').update({ responses: next }).eq('id', rfqId).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function updateQuoteResponse(rfqId: string, responseId: string, data: Partial<QuoteResponse>, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const current = await getResponses(rfqId, tenantId);
    const next = current.map((r) => (r.id === responseId ? { ...r, ...data, id: r.id } : r));
    const { error } = await supabase.from('quote_requests').update({ responses: next }).eq('id', rfqId).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function deleteQuoteResponse(rfqId: string, responseId: string, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const current = await getResponses(rfqId, tenantId);
    const next = current.filter((r) => r.id !== responseId);
    const { error } = await supabase.from('quote_requests').update({ responses: next }).eq('id', rfqId).eq('tenant_id', tenantId);
    if (error) throw error;
}

// Sube el adjunto del proveedor (respaldo de la cotización) al bucket privado.
export async function uploadQuoteAttachment(
    rfqId: string,
    file: File,
    { user, tenantId }: Context,
): Promise<{ url: string; path: string; name: string }> {
    if (!user || !tenantId) throw new Error('No autenticado.');
    const ext = file.name.split('.').pop() || 'bin';
    const path = `${tenantId}/${rfqId}/${nanoid()}.${ext}`;
    const { error } = await supabase.storage.from(RFQ_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    const { data: signed, error: signError } = await supabase.storage.from(RFQ_BUCKET).createSignedUrl(path, 315360000);
    if (signError) throw signError;
    return { url: signed.signedUrl, path, name: file.name };
}

// Adjudica la RFQ a una cotización ganadora y GENERA la Orden de Compra
// (regla de oro: la OC nace de una RFQ adjudicada). Marca las solicitudes
// incluidas como 'ordered' y deja la RFQ en estado 'awarded'.
export async function awardQuote(rfqId: string, quoteId: string, { user, tenantId }: Context): Promise<string> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const { data: rfq, error: rfqErr } = await supabase
        .from('quote_requests')
        .select('*')
        .eq('id', rfqId)
        .single();
    if (rfqErr || !rfq) throw new Error('RFQ no encontrada.');
    if (rfq.tenant_id !== tenantId) throw new Error('No tienes permiso.');
    if (rfq.status === 'awarded') throw new Error('Esta RFQ ya fue adjudicada.');

    const responses: QuoteResponse[] = rfq.responses || [];
    const winner = responses.find((r) => r.id === quoteId);
    if (!winner) throw new Error('Cotización ganadora no encontrada.');

    const items: QuoteItem[] = rfq.items || [];
    const priceByItem = new Map<string, number>();
    (winner.itemPrices || []).forEach((ip) => priceByItem.set(ip.itemId, ip.unitPrice));

    const orderId = await nextInternalCode(tenantId, 'PUR');
    const { data: order, error: orderErr } = await supabase
        .from('purchase_orders')
        .insert({
            internal_code: orderId,
            supplier_id: winner.supplierId,
            supplier_name: winner.supplierName,
            created_at: new Date().toISOString(),
            creator_id: user.id,
            creator_name: user.name,
            status: 'generated',
            request_ids: rfq.request_ids || [],
            items: items.map((it) => ({
                id: it.id,
                name: it.name,
                unit: it.unit,
                totalQuantity: it.quantity,
                category: it.category,
                price: priceByItem.get(it.id),
            })),
            total_amount: winner.totalPrice,
            tenant_id: tenantId,
        })
        .select()
        .single();
    if (orderErr) throw orderErr;

    // Marca las solicitudes incluidas como ordenadas.
    for (const reqId of (rfq.request_ids || [])) {
        const { error: reqUpdErr } = await supabase
            .from('purchase_requests')
            .update({ status: 'ordered', purchase_order_id: order.id, ordered_at: new Date().toISOString() })
            .eq('id', reqId)
            .eq('tenant_id', tenantId);
        if (reqUpdErr) throw reqUpdErr;
    }

    // Cierra la RFQ como adjudicada.
    const { error: updErr } = await supabase
        .from('quote_requests')
        .update({
            status: 'awarded',
            awarded_supplier_id: winner.supplierId,
            awarded_quote_id: winner.id,
            awarded_at: new Date().toISOString(),
            purchase_order_id: order.id,
        })
        .eq('id', rfqId)
        .eq('tenant_id', tenantId);
    if (updErr) throw updErr;

    return order.id;
}
