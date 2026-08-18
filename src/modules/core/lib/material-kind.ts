import type { Material } from './data';

/**
 * Para qué sirve un ítem del catálogo de activos cuando hay que ofrecerlo en una
 * lista: como equipo (se reporta por horas), como insumo (se reporta por
 * cantidad) o como EPP (no se reporta en terreno; se entrega por Pañol).
 */
export type MaterialKind = 'equipment' | 'supply' | 'ppe';

/** Tipos de uso que corresponden a algo que se opera y acumula HM. */
const EQUIPMENT_USAGE = new Set([
  'Activo Fijo',
  'Herramienta Menor',
  'IT Controlado',
  'Reutilizable Controlado',
  // Legacy del constraint viejo de `materials_usage_type_check`.
  'Permanente',
  'Retornable',
]);

/**
 * El EPP no se distingue por `usage_type`: los cascos y arneses viven en
 * "Reutilizable Controlado" junto a los taladros, y los guantes en "Consumible"
 * junto al cable. Lo que sí los separa es la categoría — en los tenants reales
 * es "EPP (Elementos de Protección Personal)" — así que se detecta por ahí.
 */
function isPpe(material: Pick<Material, 'category'>): boolean {
  const category = (material.category || '').toLowerCase();
  return category.includes('epp') || category.includes('protección personal') || category.includes('proteccion personal');
}

export function materialKind(material: Pick<Material, 'category' | 'usageType'>): MaterialKind {
  if (isPpe(material)) return 'ppe';
  return EQUIPMENT_USAGE.has(material.usageType || '') ? 'equipment' : 'supply';
}

interface KindOption {
  id: string;
  name: string;
  /** Categoría del catálogo; agrupa las opciones dentro del desplegable. */
  group?: string;
}

/**
 * Opciones para un combobox, filtradas por tipo y **deduplicadas por nombre**:
 * el mismo activo suele estar repetido una vez por contrato/faena, y esas
 * repeticiones sólo ensucian el desplegable — quien reporta escribe el nombre,
 * no elige la fila. Se conserva la primera aparición de cada nombre.
 */
export function materialOptionsByKind(materials: Material[] | undefined, kind: MaterialKind): KindOption[] {
  const seen = new Set<string>();
  const options: KindOption[] = [];

  for (const material of materials || []) {
    if (material.archived) continue;
    if (materialKind(material) !== kind) continue;
    const key = material.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({ id: material.id, name: material.name, group: material.category || undefined });
  }

  return options.sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name));
}
