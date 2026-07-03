-- ─────────────────────────────────────────────────────────────────────────────
-- Jerarquía de categorías de materiales (2 niveles: Familia → Subcategoría).
-- Caso de uso: Familia "Herramientas" con subcategorías "Herramientas
-- Eléctricas", "Herramientas Manuales", etc., para filtrar activos por la
-- familia completa o por subcategoría. parent_id NULL = categoría de nivel
-- superior (familia). Si se elimina una familia, sus hijas quedan como
-- familias (SET NULL) — no se pierden datos.
-- RLS: sin cambios (mismas policies por tenant de la tabla).
-- ─────────────────────────────────────────────────────────────────────────────

-- 0) Saneo previo: el catálogo acumuló duplicados exactos (mismo tenant y
--    nombre, p.ej. DEMO tenía 183 filas con decenas de repetidas). Los
--    materiales referencian la categoría por NOMBRE, así que borrar las filas
--    sobrantes es seguro. Se conserva una por (tenant_id, name).
DELETE FROM public.material_categories a
USING public.material_categories b
WHERE a.tenant_id = b.tenant_id
  AND a.name = b.name
  AND a.ctid > b.ctid;

-- Y que no vuelva a pasar (la carga masiva ya compara contra existentes).
CREATE UNIQUE INDEX IF NOT EXISTS material_categories_tenant_name_key
  ON public.material_categories (tenant_id, name);

ALTER TABLE public.material_categories
  ADD COLUMN IF NOT EXISTS parent_id uuid NULL
    REFERENCES public.material_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS material_categories_parent_id_idx
  ON public.material_categories (parent_id);

-- Evitar auto-referencias (una categoría no puede ser su propio padre).
ALTER TABLE public.material_categories
  DROP CONSTRAINT IF EXISTS material_categories_no_self_parent;
ALTER TABLE public.material_categories
  ADD CONSTRAINT material_categories_no_self_parent
  CHECK (parent_id IS NULL OR parent_id <> id);
