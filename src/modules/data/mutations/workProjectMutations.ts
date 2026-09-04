import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import type { WorkProject } from '@/modules/core/lib/data';
import { mappers } from '../mappers';

import type { MutationContext as Context } from './context';

// ── Obras (RFC-006 F1) ───────────────────────────────────────────────────────
//
// Crear una Obra crea DOS filas, siempre juntas: la obra en `work_projects` y
// su raíz en la EDT (`work_items` con parent_id = null). La raíz no es
// decorativa: Estado de Pago se apoya en ella (estado-pago/page.tsx:31) y la
// generación de `path` cuenta las raíces del tenant. Separarlas rompería ambas.

type WorkProjectInput = {
    name: string;
    contractId?: string | null;
    location?: string | null;
    status?: WorkProject['status'];
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    managerId?: string | null;
    description?: string | null;
    code?: string | null;
};

const toDateOnly = (v: Date | string | null | undefined): string | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    // Fecha local, no UTC: `toISOString()` recorta un día en Chile (UTC-3/-4).
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function addWorkProject(data: WorkProjectInput, { user, tenantId, can }: Context): Promise<WorkProject> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('construction_control:manage_projects')) {
        throw new Error('No tienes permiso para crear obras.');
    }
    const name = data.name?.trim();
    if (!name) throw new Error('La obra necesita un nombre.');

    const code = data.code?.trim() || (await nextInternalCode(tenantId, 'OBRA'));

    const { data: inserted, error } = await supabase
        .from('work_projects')
        .insert({
            tenant_id: tenantId,
            contract_id: data.contractId || null,
            name,
            code,
            location: data.location || null,
            status: data.status || 'active',
            start_date: toDateOnly(data.startDate),
            end_date: toDateOnly(data.endDate),
            manager_id: data.managerId || null,
            description: data.description || null,
            created_by: user.id,
        })
        .select()
        .single();

    if (error) throw error;

    // Raíz de la EDT. El código sigue a la última obra del inquilino, no a la
    // cantidad de obras: si se eliminó una del medio, contarlas devolvería un
    // código que otra obra ya está usando.
    const { data: raices } = await supabase
        .from('work_items')
        .select('path')
        .eq('tenant_id', tenantId)
        .is('parent_id', null);
    const ultimo = (raices || []).reduce((max, r) => {
        const n = Number(r.path ?? '');
        return Number.isFinite(n) && n > max ? n : max;
    }, 0);

    const { error: rootError } = await supabase
        .from('work_items')
        .insert({
            tenant_id: tenantId,
            work_project_id: inserted.id,
            project_id: tenantId, // columna legacy: se mantiene hasta su migración de borrado
            // Puente WBS↔contratos (ADR-004 §1): vive en la raíz, igual que antes.
            contract_id: data.contractId || null,
            name,
            type: 'project',
            parent_id: null,
            path: String(ultimo + 1).padStart(2, '0'),
            unit: 'global',
            quantity: 1,
            unit_price: 0,
            progress: 0,
            status: 'in-progress',
            planned_start_date: data.startDate || null,
            planned_end_date: data.endDate || null,
            assigned_to: data.managerId || user.id,
            created_by: user.id,
        });

    if (rootError) {
        // Sin raíz, la obra sería invisible en el EDT y en Estado de Pago. Mejor
        // no dejar el registro a medias.
        await supabase.from('work_projects').delete().eq('id', inserted.id);
        throw rootError;
    }

    return mappers.work_projects(inserted);
}

export async function updateWorkProject(id: string, data: Partial<WorkProjectInput>, { user, can }: Context) {
    if (!user) throw new Error('No autenticado.');
    if (!can('construction_control:manage_projects')) {
        throw new Error('No tienes permiso para editar obras.');
    }

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ('name' in data) row.name = data.name?.trim();
    if ('contractId' in data) row.contract_id = data.contractId || null;
    if ('location' in data) row.location = data.location || null;
    if ('status' in data) row.status = data.status;
    if ('startDate' in data) row.start_date = toDateOnly(data.startDate);
    if ('endDate' in data) row.end_date = toDateOnly(data.endDate);
    if ('managerId' in data) row.manager_id = data.managerId || null;
    if ('description' in data) row.description = data.description || null;

    // `.select()` obligatorio: un UPDATE que RLS deja en 0 filas NO lanza error,
    // devuelve éxito silencioso (patrón conocido del proyecto).
    const { data: updated, error } = await supabase
        .from('work_projects')
        .update(row)
        .eq('id', id)
        .select();

    if (error) throw error;
    if (!updated || updated.length === 0) {
        throw new Error('No se pudo actualizar la obra (sin permisos o no existe).');
    }

    // El nombre y el contrato viven duplicados en la raíz de la EDT: mantenerlos
    // sincronizados o las dos pantallas dirán cosas distintas de la misma obra.
    const rootPatch: Record<string, unknown> = {};
    if ('name' in data && data.name) rootPatch.name = data.name.trim();
    if ('contractId' in data) rootPatch.contract_id = data.contractId || null;
    if (Object.keys(rootPatch).length > 0) {
        await supabase
            .from('work_items')
            .update(rootPatch)
            .eq('work_project_id', id)
            .is('parent_id', null);
    }

    return mappers.work_projects(updated[0]);
}

export async function deleteWorkProject(id: string, { user, can }: Context) {
    if (!user) throw new Error('No autenticado.');
    if (!can('construction_control:manage_projects')) {
        throw new Error('No tienes permiso para eliminar obras.');
    }

    // Una obra con partidas cargadas no se borra: se cierra. Borrarla arrastraría
    // avances, protocolos y estados de pago colgados de su EDT.
    const { count, error: countError } = await supabase
        .from('work_items')
        .select('*', { count: 'exact', head: true })
        .eq('work_project_id', id)
        .not('parent_id', 'is', null);

    if (countError) throw countError;
    if ((count || 0) > 0) {
        throw new Error(
            `No se puede eliminar: la obra tiene ${count} partida(s). Ciérrala en vez de borrarla, o elimina primero sus partidas.`,
        );
    }

    // Solo queda la raíz vacía: se borra junto con la obra.
    const { error: rootError } = await supabase
        .from('work_items')
        .delete()
        .eq('work_project_id', id);
    if (rootError) throw rootError;

    const { error } = await supabase.from('work_projects').delete().eq('id', id);
    if (error) throw error;
}
