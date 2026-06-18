import { supabase } from '@/modules/core/lib/supabase';
import type { MutationContext as Context } from './context';

// CRUD de los catálogos de precarga de Reportes de Trabajo (áreas, especialidades,
// hitos). Tablas name-only tenant-scoped; mismo patrón que addMaterialCategory.

async function addCatalogItem(table: string, name: string, tenantId: string | null) {
  const value = name.trim();
  if (!tenantId) throw new Error('Inquilino no válido.');
  if (!value) throw new Error('El nombre es obligatorio.');
  const { error } = await supabase.from(table).insert({ name: value, tenant_id: tenantId });
  if (error) throw error;
}

async function updateCatalogItem(table: string, id: string, name: string) {
  const value = name.trim();
  if (!value) throw new Error('El nombre es obligatorio.');
  const { error } = await supabase.from(table).update({ name: value }).eq('id', id);
  if (error) throw error;
}

async function deleteCatalogItem(table: string, id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

// ── Áreas ──────────────────────────────────────────────────────────────────
export const addWorkReportArea = (name: string, { tenantId }: Context) => addCatalogItem('wr_areas', name, tenantId);
export const updateWorkReportArea = (id: string, name: string, _ctx: Context) => updateCatalogItem('wr_areas', id, name);
export const deleteWorkReportArea = (id: string, _ctx: Context) => deleteCatalogItem('wr_areas', id);

// ── Especialidades ─────────────────────────────────────────────────────────
export const addWorkReportSpecialty = (name: string, { tenantId }: Context) => addCatalogItem('wr_specialties', name, tenantId);
export const updateWorkReportSpecialty = (id: string, name: string, _ctx: Context) => updateCatalogItem('wr_specialties', id, name);
export const deleteWorkReportSpecialty = (id: string, _ctx: Context) => deleteCatalogItem('wr_specialties', id);

// ── Hitos del contrato ──────────────────────────────────────────────────────
export const addWorkReportMilestone = (name: string, { tenantId }: Context) => addCatalogItem('wr_milestones', name, tenantId);
export const updateWorkReportMilestone = (id: string, name: string, _ctx: Context) => updateCatalogItem('wr_milestones', id, name);
export const deleteWorkReportMilestone = (id: string, _ctx: Context) => deleteCatalogItem('wr_milestones', id);
