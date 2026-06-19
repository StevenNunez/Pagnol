import { supabase } from '@/modules/core/lib/supabase';
import type { WorkReportCatalogKind } from '@/modules/core/lib/data';
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

// ── Catálogo genérico (cliente, contrato, ubicación, turno, jornada…) ─────────
// Una sola tabla `wr_catalogs` discriminada por `kind`.
export async function addWorkReportCatalog(kind: WorkReportCatalogKind, name: string, { tenantId }: Context) {
  const value = name.trim();
  if (!tenantId) throw new Error('Inquilino no válido.');
  if (!value) throw new Error('El nombre es obligatorio.');
  const { error } = await supabase.from('wr_catalogs').insert({ kind, name: value, tenant_id: tenantId });
  if (error) throw error;
}
export const updateWorkReportCatalog = (id: string, name: string, _ctx: Context) => updateCatalogItem('wr_catalogs', id, name);
export const deleteWorkReportCatalog = (id: string, _ctx: Context) => deleteCatalogItem('wr_catalogs', id);
