import { supabase } from '@/modules/core/lib/supabase';

/**
 * Generates initials from a company name.
 * e.g. "Pagnol Labs" -> "PL"
 * e.g. "Constructora San Jose" -> "CSJ"
 * Kept for UI use (avatars, etc.). ID generation uses the RPC instead.
 */
export function getInitials(name: string): string {
    if (!name) return 'PAG';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
    return words.map(w => w[0]).join('').toUpperCase().substring(0, 4);
}

/**
 * Returns the next sequential internal code for a given entity type and tenant.
 * Calls the `next_internal_code` Postgres RPC which uses an atomic
 * INSERT ... ON CONFLICT DO UPDATE — no race conditions possible.
 *
 * @param tenantId  UUID of the tenant
 * @param entityType  'TX' | 'RET' | 'PRQ' | 'PUR' | 'ACT' | 'MOV' | ...
 * @returns e.g. "PAG-TX-0042", "CSJ-RET-0007"
 */
export async function nextInternalCode(tenantId: string, entityType: string): Promise<string> {
    const { data, error } = await supabase.rpc('next_internal_code', {
        p_tenant_id: tenantId,
        p_entity_type: entityType,
    });

    if (error || !data) {
        console.error('Error en RPC next_internal_code:', error);
        return `ERR-${entityType}-${Date.now().toString().slice(-6)}`;
    }

    return data as string;
}
